#!/usr/bin/env python3
"""Provision Metabase against the platform — one connection per department role.

The design decision worth defending: Metabase does NOT connect as an admin.
It gets one database connection per department role, so its schema sync only
ever discovers the views that role has been granted. The BI tool's data model
therefore *is* the grant matrix — and if someone misconfigures a Metabase
permission, Postgres still refuses. Defence in depth, with the database as the
backstop rather than the BI tool's own permission model.

(Metabase's row-level *data sandboxing* is a paid feature. It is not needed
here: row scoping already happens underneath the connection, via RLS on
core.site. Do not claim sandboxing on the open-source edition.)

Idempotent: re-running updates connections and skips anything that exists.

  exit 0 — Metabase configured (permission-graph step may soft-warn)
  exit 1 — could not reach Metabase / Postgres, or a hard step failed

Usage:
  docker compose --profile bi up -d metabase
  python tools/bi/setup_metabase.py
  python tools/bi/setup_metabase.py --skip-permissions --skip-content
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import httpx
import psycopg

MB_URL = os.environ.get("METABASE_URL", "http://localhost:3002")
ADMIN_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://platform_admin:platform_admin_dev@localhost:5433/platform",
)
APP_DB = "metabase_app"

ADMIN_EMAIL = os.environ.get("METABASE_ADMIN_EMAIL", "admin@bi.local")
ADMIN_PASSWORD = os.environ.get("METABASE_ADMIN_PASSWORD", "MetabaseDemo123!")

# The department roles, their Postgres credentials, and the Metabase group and
# demo user that go with each. Credentials mirror api/main.py ROLE_PASSWORDS.
DEPARTMENTS = [
    {"name": "Platform — Finance", "role": "dept_finance", "password": "finance_dev",
     "group": "Finance", "user": "finance@bi.local", "first": "Fran", "last": "Finance"},
    {"name": "Platform — Operations", "role": "dept_ops", "password": "ops_dev",
     "group": "Operations", "user": "ops@bi.local", "first": "Omar", "last": "Ops"},
    {"name": "Platform — Sales", "role": "dept_sales", "password": "sales_dev",
     "group": "Sales", "user": "sales@bi.local", "first": "Sam", "last": "Sales"},
]
USER_PASSWORD = os.environ.get("METABASE_USER_PASSWORD", "PlatformDemo123!")

# Starter questions, one per department, written as native SQL so they do not
# depend on Metabase's internal field ids (which differ per install).
STARTER_CARDS = [
    {"dept": "Platform — Finance", "name": "Annualised leakage by exception class",
     "display": "bar",
     "sql": "select exception_type, annualised_gap_gbp\n"
            "from reporting.vw_finance_leakage_summary\n"
            "order by annualised_gap_gbp desc",
     "viz": {"graph.dimensions": ["exception_type"],
             "graph.metrics": ["annualised_gap_gbp"]}},
    {"dept": "Platform — Finance", "name": "Aged debt by ageing bucket",
     "display": "bar",
     "sql": "select ageing_bucket, sum(outstanding_gbp) as outstanding_gbp\n"
            "from reporting.vw_finance_aged_debt\n"
            "group by ageing_bucket order by 2 desc",
     "viz": {"graph.dimensions": ["ageing_bucket"],
             "graph.metrics": ["outstanding_gbp"]}},
    {"dept": "Platform — Operations", "name": "Occupancy by site",
     "display": "bar",
     "sql": "select site_code, occupancy_pct\n"
            "from reporting.vw_ops_site_occupancy\n"
            "order by occupancy_pct",
     "viz": {"graph.dimensions": ["site_code"], "graph.metrics": ["occupancy_pct"]}},
    {"dept": "Platform — Sales", "name": "Open pipeline value by stage",
     "display": "bar",
     "sql": "select stage, sum(pipeline_value_monthly_gbp) as pipeline_value_monthly_gbp\n"
            "from reporting.vw_sales_pipeline group by stage order by 2 desc",
     "viz": {"graph.dimensions": ["stage"],
             "graph.metrics": ["pipeline_value_monthly_gbp"]}},
]


class Metabase:
    """Thin API client. Raises on unexpected status so failures are loud."""

    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.client = httpx.Client(base_url=self.base, timeout=60.0)
        self.session: str | None = None

    def _headers(self) -> dict:
        return {"X-Metabase-Session": self.session} if self.session else {}

    def get(self, path: str, **kw):
        r = self.client.get(path, headers=self._headers(), **kw)
        r.raise_for_status()
        return r.json()

    def post(self, path: str, json: dict):
        r = self.client.post(path, json=json, headers=self._headers())
        r.raise_for_status()
        return r.json() if r.content else {}

    def put(self, path: str, json: dict):
        r = self.client.put(path, json=json, headers=self._headers())
        r.raise_for_status()
        return r.json() if r.content else {}

    # ------------------------------------------------------------------ auth
    def wait_healthy(self, timeout: float = 300) -> None:
        deadline = time.monotonic() + timeout
        last = ""
        while time.monotonic() < deadline:
            try:
                r = self.client.get("/api/health")
                if r.status_code == 200:
                    return
                last = f"HTTP {r.status_code}"
            except httpx.HTTPError as exc:
                last = type(exc).__name__
            time.sleep(3)
        raise RuntimeError(f"Metabase not healthy within {timeout:.0f}s ({last}). "
                           "Is `docker compose --profile bi up -d metabase` running?")

    def login_or_setup(self) -> str:
        props = self.get("/api/session/properties")
        token = props.get("setup-token")
        if token:
            body = {
                "token": token,
                "user": {"first_name": "Platform", "last_name": "Admin",
                         "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD,
                         "site_name": "Unified Data Platform BI"},
                "prefs": {"site_name": "Unified Data Platform BI",
                          "site_locale": "en", "allow_tracking": False},
                "database": None,
            }
            self.session = self.post("/api/setup", body)["id"]
            return "first-run setup completed"
        self.session = self.post(
            "/api/session", {"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD})["id"]
        return "logged in to existing instance"


def _as_list(payload) -> list:
    """Metabase list endpoints return either a bare list or {"data": [...]}."""
    return payload["data"] if isinstance(payload, dict) and "data" in payload else payload


def provision_app_db(dsn: str) -> str:
    """Metabase cannot create its own application database. `create database`
    can't run inside a transaction, hence autocommit."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        exists = conn.execute("select 1 from pg_database where datname = %s",
                              (APP_DB,)).fetchone()
        if exists:
            return f"application database {APP_DB} already present"
        conn.execute(f'create database "{APP_DB}"')
        return f"created application database {APP_DB}"


def drop_sample_database(mb: Metabase) -> None:
    """Remove Metabase's bundled Sample Database so every connection on the
    instance is one of ours — otherwise the demo opens on someone else's data."""
    for db in _as_list(mb.get("/api/database")):
        if db.get("is_sample") or db["name"] == "Sample Database":
            mb.client.delete(f"/api/database/{db['id']}", headers=mb._headers())
            print("  removed the bundled Sample Database")


def upsert_databases(mb: Metabase, host: str, port: int, dbname: str) -> dict[str, int]:
    """One connection per department role — the whole point of this setup."""
    existing = {d["name"]: d for d in _as_list(mb.get("/api/database"))}
    ids: dict[str, int] = {}
    for dept in DEPARTMENTS:
        details = {
            "host": host, "port": port, "dbname": dbname,
            "user": dept["role"], "password": dept["password"],
            "ssl": False,
            # Only the reporting schema is of interest; core is unreadable to
            # these roles anyway, so this is tidiness rather than security.
            "schema-filters-type": "inclusion",
            "schema-filters-patterns": "reporting",
        }
        if dept["name"] in existing:
            db_id = existing[dept["name"]]["id"]
            mb.put(f"/api/database/{db_id}",
                   {"name": dept["name"], "engine": "postgres", "details": details})
            ids[dept["name"]] = db_id
            print(f"  updated connection  {dept['name']:<24} as {dept['role']}")
        else:
            created = mb.post("/api/database", {
                "name": dept["name"], "engine": "postgres",
                "details": details, "is_full_sync": True,
            })
            ids[dept["name"]] = created["id"]
            print(f"  created connection  {dept['name']:<24} as {dept['role']}")
    return ids


def sync_and_report(mb: Metabase, db_ids: dict[str, int]) -> dict[str, list[str]]:
    """Trigger a schema sync, then read back what each role could actually see.
    This is the assertion: the sync IS the grant matrix."""
    for db_id in db_ids.values():
        mb.post(f"/api/database/{db_id}/sync_schema", {})

    found: dict[str, list[str]] = {}
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        found = {}
        for name, db_id in db_ids.items():
            meta = mb.get(f"/api/database/{db_id}/metadata")
            found[name] = sorted(t["name"] for t in meta.get("tables", []))
        if all(len(v) > 0 for v in found.values()):
            break
        time.sleep(3)
    return found


def upsert_groups(mb: Metabase) -> dict[str, int]:
    existing = {g["name"]: g["id"] for g in _as_list(mb.get("/api/permissions/group"))}
    ids = {}
    for dept in DEPARTMENTS:
        name = dept["group"]
        if name in existing:
            ids[name] = existing[name]
        else:
            ids[name] = mb.post("/api/permissions/group", {"name": name})["id"]
            print(f"  created group       {name}")
    return ids


def upsert_users(mb: Metabase, group_ids: dict[str, int]) -> None:
    existing = {u["email"] for u in _as_list(mb.get("/api/user"))}
    for dept in DEPARTMENTS:
        if dept["user"] in existing:
            continue
        mb.post("/api/user", {
            "first_name": dept["first"], "last_name": dept["last"],
            "email": dept["user"], "password": USER_PASSWORD,
            "user_group_memberships": [{"id": 1}, {"id": group_ids[dept["group"]]}],
        })
        print(f"  created user        {dept['user']} in {dept['group']}")


def apply_permissions(mb: Metabase, db_ids: dict[str, int],
                      group_ids: dict[str, int]) -> None:
    """Give each group its own connection and nothing else.

    The graph's shape has changed across Metabase versions, so read the current
    graph and mutate it rather than constructing one from assumptions. This is
    belt-and-braces on top of the Postgres grants, so a failure here warns and
    carries on — the boundary does not depend on it.
    """
    graph = mb.get("/api/permissions/graph")
    groups = graph["groups"]

    # Learn the vocabulary from an entry that already exists rather than
    # assuming it — the graph's shape changed at Metabase 0.50.
    sample = next((v for entries in groups.values() for v in entries.values()
                   if isinstance(v, dict)), None)
    if sample is None:
        raise RuntimeError("could not read the permission-graph shape")

    if "view-data" in sample:
        allow = {"view-data": "unrestricted",
                 "create-queries": "query-builder-and-native"}
        # "blocked" is the natural denial here, but it is a PAID feature —
        # the API answers 402 "the blocked permissions functionality is only
        # enabled if you have a premium token". This pair is the open-source
        # equivalent and is what actually keeps a group out of a connection.
        deny = {"view-data": "legacy-no-self-service", "create-queries": "no"}
    elif "data" in sample:                       # pre-0.50 shape
        allow = {"data": {"schemas": "all", "native": "write"}}
        deny = {"data": {"schemas": "none", "native": "none"}}
    else:
        raise RuntimeError(f"unrecognised permission-graph shape: {sorted(sample)}")

    def apply(entries: dict, db_id: int, value: dict) -> None:
        # Merge, so sibling keys such as "download" survive untouched.
        entries.setdefault(str(db_id), {}).update(value)

    all_db_ids = list(db_ids.values())
    for dept in DEPARTMENTS:
        entries = groups.setdefault(str(group_ids[dept["group"]]), {})
        for db_id in all_db_ids:
            apply(entries, db_id, allow if db_id == db_ids[dept["name"]] else deny)

    # Every user is also in "All Users" (group 1), and Metabase takes the union
    # of a user's groups — so All Users must be denied all three, or the
    # department grants above mean nothing.
    for db_id in all_db_ids:
        apply(groups.setdefault("1", {}), db_id, deny)

    mb.put("/api/permissions/graph", {"revision": graph["revision"], "groups": groups})


def upsert_content(mb: Metabase, db_ids: dict[str, int]) -> None:
    """Starter questions so the install isn't empty, plus a Finance dashboard.
    The live demo still builds one question from scratch — that is the part
    that actually sells self-service to a non-technical audience."""
    existing = {c["name"]: c["id"] for c in _as_list(mb.get("/api/card"))}
    card_ids: dict[str, int] = {}
    for card in STARTER_CARDS:
        if card["name"] in existing:
            card_ids[card["name"]] = existing[card["name"]]
            continue
        created = mb.post("/api/card", {
            "name": card["name"],
            "display": card["display"],
            "visualization_settings": card["viz"],
            "dataset_query": {
                "type": "native",
                "database": db_ids[card["dept"]],
                "native": {"query": card["sql"]},
            },
        })
        card_ids[card["name"]] = created["id"]
        print(f"  created question    {card['name']}")

    dash_name = "Finance overview"
    dashboards = {d["name"]: d["id"] for d in _as_list(mb.get("/api/dashboard"))}
    if dash_name in dashboards:
        return
    dash = mb.post("/api/dashboard", {"name": dash_name})
    finance_cards = [c for c in STARTER_CARDS if c["dept"] == "Platform — Finance"]
    try:
        mb.put(f"/api/dashboard/{dash['id']}", {"dashcards": [
            {"id": -(i + 1), "card_id": card_ids[c["name"]],
             "row": 0, "col": i * 12, "size_x": 12, "size_y": 8,
             "parameter_mappings": []}
            for i, c in enumerate(finance_cards)
        ]})
        print(f"  created dashboard   {dash_name}")
    except httpx.HTTPError as exc:
        print(f"  warning: dashboard created but cards not attached ({exc}); "
              f"drag them on in the UI")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=MB_URL, help="Metabase base URL")
    parser.add_argument("--dsn", default=ADMIN_DSN, help="admin DSN (app db creation)")
    parser.add_argument("--db-host", default="db",
                        help="Postgres host AS SEEN BY THE METABASE CONTAINER")
    parser.add_argument("--db-port", type=int, default=5432)
    parser.add_argument("--db-name", default="platform")
    parser.add_argument("--keep-sample", action="store_true",
                        help="keep Metabase's bundled Sample Database")
    parser.add_argument("--skip-permissions", action="store_true")
    parser.add_argument("--skip-content", action="store_true")
    parser.add_argument("--provision-only", action="store_true",
                        help="create the application database and exit")
    args = parser.parse_args()

    try:
        print(f"  {provision_app_db(args.dsn)}")
    except psycopg.OperationalError as exc:
        print(f"error: cannot reach Postgres: {exc}", file=sys.stderr)
        return 1
    if args.provision_only:
        return 0

    mb = Metabase(args.url)
    try:
        mb.wait_healthy()
        print(f"  {mb.login_or_setup()} at {args.url}")
        if not args.keep_sample:
            drop_sample_database(mb)
        db_ids = upsert_databases(mb, args.db_host, args.db_port, args.db_name)
        found = sync_and_report(mb, db_ids)
    except (RuntimeError, httpx.HTTPError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print("\n  Each connection syncs only what its role is granted:")
    for name, tables in found.items():
        print(f"    {name:<24} {len(tables):>2} views  "
              f"{', '.join(t.replace('vw_', '') for t in tables[:3])}"
              f"{' …' if len(tables) > 3 else ''}")

    if not args.skip_permissions:
        try:
            group_ids = upsert_groups(mb)
            upsert_users(mb, group_ids)
            apply_permissions(mb, db_ids, group_ids)
            print("  applied group permissions (each group sees only its own connection)")
        except (RuntimeError, httpx.HTTPError) as exc:
            # Soft failure by design: Postgres is the boundary, this is extra.
            print(f"\n  warning: could not set the permission graph ({exc}).\n"
                  f"  Set it by hand: Admin → Permissions → Data, give each group\n"
                  f"  access to its own connection only. The Postgres grants hold\n"
                  f"  regardless — this step is defence in depth.", file=sys.stderr)

    if not args.skip_content:
        try:
            upsert_content(mb, db_ids)
        except httpx.HTTPError as exc:
            print(f"  warning: starter content not created ({exc})", file=sys.stderr)

    print(f"\nsetup_metabase: ok — {args.url}  "
          f"admin {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
