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
    with POOLS[user.role].connection() as conn:
        conn.row_factory = dict_row
        with conn.transaction():
            conn.execute("set local transaction read only")
            conn.execute("set local statement_timeout = '10s'")
            if user.site_scope:
                conn.execute("select set_config('app.site_scope', %s, true)",
                             (",".join(user.site_scope),))
            cur = conn.execute(sql, params)
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
