"""Unified data platform API.

Ordinary app structure (not WAT — this is a product, not an agent harness).

The security model worth noticing: every request executes SQL on a connection
pool opened as the requesting user's DEPARTMENT ROLE. The API adds convenience;
Postgres enforces the boundary. A bug in a route handler cannot leak a finance
view to an ops user, because the ops pool's role has no grant to read it.
"""
from __future__ import annotations

import os
import re
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

PGHOST = os.environ.get("PGHOST", "localhost")
PGPORT = os.environ.get("PGPORT", "5433")
PGDATABASE = os.environ.get("PGDATABASE", "platform")

# Demo auth stub: bearer token -> app_user email. A real deployment swaps this
# for an identity provider; everything downstream (role pools, site scope,
# grants) stays exactly the same.
TOKENS = {
    "demo-finance": "fd@demo.local",
    "demo-ops": "ops.head@demo.local",
    "demo-ops-london": "ops.london@demo.local",
    "demo-sales": "sales@demo.local",
}

ROLE_BY_DEPT = {
    "FINANCE": "dept_finance",
    "OPS": "dept_ops",
    "SALES": "dept_sales",
}
ROLE_PASSWORDS = {
    "dept_finance": "finance_dev",
    "dept_ops": "ops_dev",
    "dept_sales": "sales_dev",
}

ADMIN_DSN = os.environ.get(
    "DATABASE_URL",
    f"postgresql://platform_admin:platform_admin_dev@{PGHOST}:{PGPORT}/{PGDATABASE}",
)

POOLS: dict[str, ConnectionPool] = {}
VIEW_NAME = re.compile(r"^vw_[a-z0-9_]+$")


@asynccontextmanager
async def lifespan(app: FastAPI):
    POOLS["admin"] = ConnectionPool(ADMIN_DSN, min_size=1, max_size=3, open=True)
    for role, pw in ROLE_PASSWORDS.items():
        POOLS[role] = ConnectionPool(
            f"postgresql://{role}:{pw}@{PGHOST}:{PGPORT}/{PGDATABASE}",
            min_size=1, max_size=4, open=True)
    yield
    for pool in POOLS.values():
        pool.close()


app = FastAPI(title="Unified Data Platform (demo — all data synthetic)",
              lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class User(BaseModel):
    email: str
    full_name: str
    dept_code: str
    role: str
    site_scope: list[str] | None


def current_user(request: Request) -> User:
    auth = request.headers.get("authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    email = TOKENS.get(token)
    if not email:
        raise HTTPException(401, "unknown or missing bearer token")
    with POOLS["admin"].connection() as conn:
        row = conn.execute(
            "select email, full_name, dept_code, site_scope from core.app_user "
            "where email = %s and is_active", (email,)).fetchone()
    if not row:
        raise HTTPException(401, "user not found or inactive")
    return User(email=row[0], full_name=row[1], dept_code=row[2],
                role=ROLE_BY_DEPT[row[2]],
                site_scope=[str(s) for s in row[3]] if row[3] else None)


def run_view_query(user: User, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    """Execute read-only as the user's role, site scope set inside the
    transaction so it cannot leak between pooled requests."""
    # row_factory goes on the CURSOR, never on the pooled connection: setting
    # it on the connection persists after the connection returns to the pool
    # and silently changes row shape for the next borrower. Same class of bug
    # as leaking app.site_scope across pooled requests — which is why the
    # scope below is set with is_local=true inside the transaction.
    with POOLS[user.role].connection() as conn:
        with conn.transaction():
            conn.execute("set local transaction read only")
            conn.execute("set local statement_timeout = '10s'")
            if user.site_scope:
                conn.execute("select set_config('app.site_scope', %s, true)",
                             (",".join(user.site_scope),))
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(sql, params)
                return cur.fetchmany(2000)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return user


@app.get("/api/views")
def list_views(user: User = Depends(current_user)):
    """The views this role can actually read — asked of Postgres, not config."""
    with POOLS["admin"].connection() as conn:
        # Materialized CTE: without it the planner may evaluate
        # has_table_privilege against non-reporting rows first and error.
        rows = conn.execute("""
            with v as materialized (
                select viewname from pg_views where schemaname = 'reporting'
            )
            select viewname from v
            where has_table_privilege(%s, 'reporting.' || viewname, 'select')
            order by viewname
        """, (user.role,)).fetchall()
    return {"role": user.role, "views": [r[0] for r in rows]}


@app.get("/api/view/{view_name}")
def read_view(view_name: str, user: User = Depends(current_user), limit: int = 500):
    if not VIEW_NAME.match(view_name):
        raise HTTPException(400, "invalid view name")
    limit = max(1, min(limit, 2000))
    try:
        rows = run_view_query(
            user, f"select * from reporting.{view_name} limit %s", (limit,))
    except Exception as exc:
        # InsufficientPrivilege arrives here if the role has no grant —
        # the database said no, which is the design.
        if "permission denied" in str(exc):
            raise HTTPException(403, f"{user.role} has no access to {view_name}")
        raise HTTPException(500, str(exc))
    return {"view": view_name, "role": user.role, "rows": rows}


# ------------------------------------------------------- demo transparency
# Read-only panels that show the enforcement rather than asserting it: the
# live grant matrix, the audit trail, and the agent's query log. They read
# via the admin pool because they inspect the system itself; in a real
# deployment they would sit behind an admin role, not a department one.

@app.get("/api/system/grants")
def system_grants(user: User = Depends(current_user)):
    """The role x view grant matrix, asked of Postgres at request time."""
    with POOLS["admin"].connection() as conn:
        views = [r[0] for r in conn.execute(
            "select viewname from pg_views where schemaname = 'reporting' "
            "order by viewname").fetchall()]
        roles = list(ROLE_BY_DEPT.values())
        matrix = []
        for view in views:
            granted = {}
            for role in roles:
                cur = conn.execute("select has_table_privilege(%s, %s, 'select')",
                                   (role, f"reporting.{view}"))
                granted[role] = bool(cur.fetchone()[0])
            matrix.append({"view": view, **granted})
        # Prove core is dark for every department role, too.
        core_tables = [r[0] for r in conn.execute(
            "select tablename from pg_tables where schemaname = 'core' "
            "order by tablename").fetchall()]
        core_readable = 0
        for table in core_tables:
            for role in roles:
                cur = conn.execute("select has_table_privilege(%s, %s, 'select')",
                                   (role, f"core.{table}"))
                core_readable += 1 if cur.fetchone()[0] else 0
    return {"roles": roles, "matrix": matrix,
            "core_tables": len(core_tables), "core_readable_by_roles": core_readable}


@app.get("/api/system/audit")
def system_audit(limit: int = 15, user: User = Depends(current_user)):
    """Tail of the append-only audit log — who changed what, when."""
    with POOLS["admin"].connection() as conn, \
            conn.cursor(row_factory=dict_row) as cur:
        rows = cur.execute("""
            select table_name, action, changed_by,
                   to_char(changed_at, 'HH24:MI:SS') as changed_at,
                   coalesce(new_values->>'invoice_no', new_values->>'amount_gbp',
                            new_values->>'status', '') as detail
            from core.audit_log order by changed_at desc, audit_id desc limit %s
        """, (max(1, min(limit, 50)),)).fetchall()
    return {"rows": rows}


@app.get("/api/system/agent-log")
def system_agent_log(limit: int = 10, user: User = Depends(current_user)):
    """Every question the model was ever asked, with the SQL it chose."""
    with POOLS["admin"].connection() as conn, \
            conn.cursor(row_factory=dict_row) as cur:
        rows = cur.execute("""
            select to_char(asked_at, 'HH24:MI:SS') as asked_at, role_name,
                   question, outcome, row_count, duration_ms
            from core.agent_query_log order by asked_at desc limit %s
        """, (max(1, min(limit, 50)),)).fetchall()
    return {"rows": rows}


class AskRequest(BaseModel):
    question: str


@app.post("/api/agent/ask")
def agent_ask(body: AskRequest, user: User = Depends(current_user)):
    """Natural-language question -> role-constrained SQL -> grounded answer.
    The agent runs on the SAME per-role pools as every other endpoint, so the
    grants remain the security boundary — the model is untrusted input."""
    from tools.agent.ask import answer_question  # lazy: needs ANTHROPIC_API_KEY

    started = time.monotonic()
    try:
        result = answer_question(
            question=body.question,
            role=user.role,
            site_scope=",".join(user.site_scope) if user.site_scope else None,
            pools=POOLS,
        )
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    result["duration_ms"] = int((time.monotonic() - started) * 1000)
    return result
