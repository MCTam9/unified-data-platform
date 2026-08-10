"""The access boundary, proven one layer up — through the BI tool.

tests/test_permissions.py proves Postgres refuses. These prove the same thing
where a business user actually sits: Metabase connects once per department
role, so its schema sync can only ever discover the views that role is
granted. The BI tool's data model *is* the grant matrix.

Skipped when Metabase isn't running, so the core suite needs no BI stack:
    docker compose --profile bi up -d metabase
    python tools/bi/setup_metabase.py
"""
from __future__ import annotations

import os

import httpx
import pytest

MB_URL = os.environ.get("METABASE_URL", "http://localhost:3002")
ADMIN = (os.environ.get("METABASE_ADMIN_EMAIL", "admin@bi.local"),
         os.environ.get("METABASE_ADMIN_PASSWORD", "MetabaseDemo123!"))
USER_PASSWORD = os.environ.get("METABASE_USER_PASSWORD", "PlatformDemo123!")

CONNECTIONS = {
    "Platform — Finance": {
        "user": "finance@bi.local",
        "views": {"vw_data_exceptions", "vw_finance_aged_debt",
                  "vw_finance_budget_variance", "vw_finance_leakage_summary",
                  "vw_finance_lease_exposure", "vw_finance_operated_brand_pnl",
                  "vw_finance_revenue_assurance", "vw_finance_site_pnl",
                  "vw_scorecard"},
    },
    "Platform — Operations": {
        "user": "ops@bi.local",
        "views": {"vw_data_exceptions", "vw_ops_asset_replacement",
                  "vw_ops_compliance_expiry", "vw_ops_maintenance_load",
                  "vw_ops_site_occupancy", "vw_ops_utility_intensity",
                  "vw_scorecard"},
    },
    "Platform — Sales": {
        "user": "sales@bi.local",
        "views": {"vw_sales_churn_risk", "vw_sales_conversion",
                  "vw_sales_pipeline", "vw_scorecard"},
    },
}


def _reachable() -> bool:
    try:
        return httpx.get(f"{MB_URL}/api/health", timeout=3).status_code == 200
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(
    not _reachable(), reason=f"Metabase not running at {MB_URL}")


def session(email: str, password: str) -> httpx.Client:
    c = httpx.Client(base_url=MB_URL, timeout=60.0)
    token = c.post("/api/session",
                   json={"username": email, "password": password}).json()["id"]
    c.headers["X-Metabase-Session"] = token
    return c


def as_list(payload):
    return payload["data"] if isinstance(payload, dict) and "data" in payload else payload


@pytest.fixture(scope="module")
def admin() -> httpx.Client:
    c = session(*ADMIN)
    yield c
    c.close()


@pytest.fixture(scope="module")
def db_ids(admin) -> dict[str, int]:
    return {d["name"]: d["id"] for d in as_list(admin.get("/api/database").json())}


@pytest.mark.parametrize("name", list(CONNECTIONS))
def test_connection_syncs_only_its_own_grants(admin, db_ids, name):
    """THE assertion: the sync discovered exactly the granted views — no more."""
    meta = admin.get(f"/api/database/{db_ids[name]}/metadata").json()
    synced = {t["name"] for t in meta.get("tables", [])}
    assert synced == CONNECTIONS[name]["views"], (
        f"{name} synced {sorted(synced)}, expected {sorted(CONNECTIONS[name]['views'])}")


def test_no_connection_can_see_core(admin, db_ids):
    """core holds the truth and no BI connection reaches it at all."""
    for name, db_id in db_ids.items():
        meta = admin.get(f"/api/database/{db_id}/metadata").json()
        schemas = {t.get("schema") for t in meta.get("tables", [])}
        assert schemas <= {"reporting"}, f"{name} can see {schemas}"


@pytest.mark.parametrize("name", list(CONNECTIONS))
def test_department_user_sees_only_their_own_connection(name, db_ids):
    """A department user browsing Metabase finds one connection: theirs."""
    c = session(CONNECTIONS[name]["user"], USER_PASSWORD)
    try:
        visible = {d["name"] for d in as_list(c.get("/api/database").json())}
    finally:
        c.close()
    assert visible == {name}, f"{CONNECTIONS[name]['user']} sees {visible}"


def test_department_user_cannot_query_another_connection_by_id(db_ids):
    """Even addressing another department's connection directly by id is
    refused — Metabase's group permissions, the first of the two layers."""
    c = session(CONNECTIONS["Platform — Finance"]["user"], USER_PASSWORD)
    try:
        r = c.post("/api/dataset", json={
            "type": "native",
            "database": db_ids["Platform — Operations"],
            "native": {"query": "select 1"},
        })
    finally:
        c.close()
    assert r.status_code in (401, 403), f"expected a refusal, got {r.status_code}"


def test_postgres_is_the_backstop(admin, db_ids):
    """The layer that matters: even as the Metabase ADMIN, running SQL through
    the Finance connection cannot read an ops view — the connection is bound to
    dept_finance, and Postgres refuses regardless of any BI permission."""
    r = admin.post("/api/dataset", json={
        "type": "native",
        "database": db_ids["Platform — Finance"],
        "native": {"query": "select * from reporting.vw_ops_site_occupancy limit 1"},
    })
    body = r.json()
    assert body.get("status") == "failed", "the finance connection read an ops view"
    assert "permission denied" in str(body.get("error", "")).lower(), body.get("error")
