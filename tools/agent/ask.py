#!/usr/bin/env python3
"""The AI query agent — natural language over the reporting views.

The one idea that makes it safe: the agent never writes SQL against `core`,
and it never runs SQL as a superuser. Every query executes on a connection
opened as the ASKING USER'S OWN POSTGRES ROLE. The grants in the access model
are the security boundary, not the prompt — even a perfect prompt injection
cannot make dept_ops read a finance view, because Postgres refuses before
the model's intent matters.

WAT layer split: the model decides WHICH deterministic query to run and how to
phrase the result; deterministic code executes it. No LLM anywhere else in the
system — not in ETL, not in a P&L calculation.

CLI usage (also importable by the API):
  python tools/agent/ask.py --role dept_finance \
      --question "Which sites were over budget on utilities last quarter?"
"""
from __future__ import annotations

import argparse
import atexit
import json
import os
import sys
import time
from decimal import Decimal
from datetime import date, datetime

from psycopg_pool import ConnectionPool

from tools.agent.catalogue import build_view_catalogue

MODEL = "claude-opus-5"

PGHOST = os.environ.get("PGHOST", "localhost")
PGPORT = os.environ.get("PGPORT", "5433")
PGDATABASE = os.environ.get("PGDATABASE", "platform")

ROLE_PASSWORDS = {
    "dept_finance": "finance_dev",
    "dept_ops": "ops_dev",
    "dept_sales": "sales_dev",
}

ADMIN_DSN = os.environ.get(
    "DATABASE_URL",
    f"postgresql://platform_admin:platform_admin_dev@{PGHOST}:{PGPORT}/{PGDATABASE}",
)

_own_pools: dict[str, ConnectionPool] = {}
_catalogue_cache: dict[str, str] = {}
atexit.register(lambda: [p.close() for p in _own_pools.values()])


def _pool_for(role: str, pools: dict | None) -> ConnectionPool:
    """Use the API's per-role pools when provided; else lazily open our own."""
    if pools and role in pools:
        return pools[role]
    if role not in _own_pools:
        _own_pools[role] = ConnectionPool(
            f"postgresql://{role}:{ROLE_PASSWORDS[role]}@{PGHOST}:{PGPORT}/{PGDATABASE}",
            min_size=1, max_size=2, open=True)
    return _own_pools[role]


def _jsonable(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def run_query(sql: str, role: str, site_scope: str | None,
              pools: dict | None = None) -> list[dict]:
    """Execute read-only, as the USER'S role, with a hard timeout and row cap."""
    with _pool_for(role, pools).connection() as conn:
        with conn.transaction():
            conn.execute("set local transaction read only")
            conn.execute("set local statement_timeout = '10s'")
            if site_scope:
                conn.execute("select set_config('app.site_scope', %s, true)",
                             (site_scope,))
            cur = conn.execute(sql)
            cols = [c.name for c in cur.description]
            return [{c: _jsonable(v) for c, v in zip(cols, row)}
                    for row in cur.fetchmany(500)]


def _log(role: str, question: str, sql: str | None, row_count: int | None,
         outcome: str, duration_ms: int, user_email: str | None = None) -> None:
    """Every question, generated SQL, row count and role — the audit trail
    for 'why did the machine say that' three months from now."""
    try:
        import psycopg
        with psycopg.connect(ADMIN_DSN) as conn:
            conn.execute(
                "insert into core.agent_query_log "
                "(role_name, user_email, question, generated_sql, row_count, outcome, duration_ms) "
                "values (%s,%s,%s,%s,%s,%s,%s)",
                (role, user_email, question, sql, row_count, outcome, duration_ms))
            conn.commit()
    except Exception:
        pass  # logging must never break the answer path


def answer_question(question: str, role: str, site_scope: str | None = None,
                    pools: dict | None = None, effort: str = "medium") -> dict:
    """Ask the agent. Returns {answer, queries: [{sql, purpose, rows}], role}."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is not set — the query agent is unavailable")

    from anthropic import Anthropic, beta_tool

    client = Anthropic()
    started = time.monotonic()
    executed: list[dict] = []

    @beta_tool
    def query_reporting(sql: str, purpose: str) -> str:
        """Run a read-only SQL SELECT against the reporting views and return rows
        as JSON. Call this whenever the answer depends on business data — never
        answer a data question from memory. Only the views listed in the system
        prompt exist; querying anything else will error.

        Args:
            sql: A single SELECT statement against reporting.* views only.
            purpose: One line describing what this query answers.
        """
        try:
            rows = run_query(sql, role=role, site_scope=site_scope, pools=pools)
        except Exception as exc:
            executed.append({"sql": sql, "purpose": purpose, "error": str(exc), "rows": []})
            return json.dumps({"error": str(exc)})
        executed.append({"sql": sql, "purpose": purpose, "rows": rows})
        return json.dumps({"row_count": len(rows), "rows": rows})

    if role not in _catalogue_cache:
        _catalogue_cache[role] = build_view_catalogue(role, ADMIN_DSN)

    runner = client.beta.messages.tool_runner(
        model=MODEL,
        max_tokens=8000,
        output_config={"effort": effort},
        system=[{
            "type": "text",
            "text": _catalogue_cache[role],
            # Static per role — cache it; the catalogue dominates every request.
            "cache_control": {"type": "ephemeral"},
        }],
        tools=[query_reporting],
        messages=[{"role": "user", "content": question}],
    )
    final = runner.until_done()

    answer = "".join(b.text for b in final.content if b.type == "text")
    duration_ms = int((time.monotonic() - started) * 1000)

    if executed and not any("error" in q for q in executed):
        outcome = "answered"
    elif executed:
        outcome = "errored" if not answer else "answered"
    else:
        outcome = "refused"
    _log(role, question, executed[-1]["sql"] if executed else None,
         len(executed[-1]["rows"]) if executed else None, outcome, duration_ms)

    return {"answer": answer, "queries": executed, "role": role, "outcome": outcome}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--role", required=True, choices=list(ROLE_PASSWORDS))
    parser.add_argument("--question", required=True)
    parser.add_argument("--site-scope", default=None,
                        help="Comma-separated site UUIDs to scope via RLS")
    parser.add_argument("--effort", default="medium",
                        choices=["low", "medium", "high"])
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    args = parser.parse_args()

    try:
        result = answer_question(args.question, args.role, args.site_scope,
                                 effort=args.effort)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for q in result["queries"]:
            print(f"-- {q['purpose']}\n{q['sql']}\n")
        print(result["answer"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
