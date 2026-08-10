"""The access boundary, proven.

These tests connect as each department's actual Postgres role and assert the
boundary holds IN THE DATABASE — not in a route handler. This file is the
demo's proof: a bug in application code cannot leak finance data, because
Postgres refuses before any application code matters.
"""
from __future__ import annotations

import os

import psycopg
import pytest
from psycopg import errors

HOST = os.environ.get("PGHOST", "localhost")
PORT = os.environ.get("PGPORT", "5433")
DB = os.environ.get("PGDATABASE", "platform")

ROLES = {
    "dept_finance": "finance_dev",
    "dept_ops": "ops_dev",
    "dept_sales": "sales_dev",
}

FINANCE_VIEWS = [
    "vw_finance_site_pnl", "vw_finance_aged_debt", "vw_finance_budget_variance",
    "vw_finance_lease_exposure", "vw_finance_operated_brand_pnl",
    "vw_finance_revenue_assurance", "vw_finance_leakage_summary",
]
OPS_VIEWS = [
    "vw_ops_site_occupancy", "vw_ops_maintenance_load", "vw_ops_utility_intensity",
    "vw_ops_compliance_expiry", "vw_ops_asset_replacement",
]
SALES_VIEWS = ["vw_sales_pipeline", "vw_sales_conversion", "vw_sales_churn_risk"]

ALLOWED = {
    "dept_finance": set(FINANCE_VIEWS) | {"vw_scorecard", "vw_data_exceptions"},
    "dept_ops": set(OPS_VIEWS) | {"vw_scorecard", "vw_data_exceptions"},
    "dept_sales": set(SALES_VIEWS) | {"vw_scorecard"},
}
ALL_VIEWS = set(FINANCE_VIEWS) | set(OPS_VIEWS) | set(SALES_VIEWS) \
    | {"vw_scorecard", "vw_data_exceptions"}

CORE_TABLES = [
    "invoice", "payment", "licence_agreement", "brand_partner", "expense",
    "site", "kitchen_unit", "budget_line", "audit_log", "app_user",
]


def connect(role: str):
    return psycopg.connect(
        host=HOST, port=PORT, dbname=DB, user=role, password=ROLES[role]
    )


# ---------------------------------------------------------------- the headline
def test_ops_cannot_read_finance_aged_debt():
    """THE demo assertion: Ops selecting a finance view is refused by Postgres."""
    with connect("dept_ops") as conn:
        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute("select * from reporting.vw_finance_aged_debt limit 1")


@pytest.mark.parametrize("role", ROLES)
def test_role_reads_only_its_own_views(role):
    """Each role can read exactly its granted views; every other view refuses."""
    for view in sorted(ALL_VIEWS):
        with connect(role) as conn:
            if view in ALLOWED[role]:
                conn.execute(f"select * from reporting.{view} limit 1")
            else:
                with pytest.raises(errors.InsufficientPrivilege):
                    conn.execute(f"select * from reporting.{view} limit 1")


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("table", CORE_TABLES)
def test_core_is_unreachable(role, table):
    """Nobody touches core. Ever. Not even to count rows."""
    with connect(role) as conn:
        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute(f"select count(*) from core.{table}")


@pytest.mark.parametrize("role", ROLES)
def test_roles_cannot_write_reporting(role):
    """The reporting surface is read-only for every department role."""
    with connect(role) as conn:
        with pytest.raises((errors.InsufficientPrivilege, errors.ObjectNotInPrerequisiteState)):
            conn.execute("create table reporting.smuggle (x int)")


# ------------------------------------------------------------------------- RLS
ADMIN_DSN = os.environ.get(
    "DATABASE_URL",
    f"postgresql://platform_admin:platform_admin_dev@{HOST}:{PORT}/{DB}",
)


def _london_site_scope() -> str:
    """Fetch the London site ids as the admin — the same lookup the API does
    from app_user.site_scope when it authenticates a scoped user."""
    with psycopg.connect(ADMIN_DSN) as conn:
        cur = conn.execute(
            "select string_agg(site_id::text, ',') from core.site where region = 'London'"
        )
        return cur.fetchone()[0]


def _london_and_total_site_counts(conn):
    cur = conn.execute("""
        select count(*) filter (where region = 'London'), count(*)
        from (select distinct site_code, region
              from reporting.vw_ops_site_occupancy) s
    """)
    return cur.fetchone()


def test_site_scope_rls_filters_rows():
    """A regional manager scoped to London sites sees only London sites,
    enforced by the RLS policy on core.site (FORCE RLS + non-owner view owner,
    so the policy is real for queries arriving through the views)."""
    with connect("dept_ops") as conn:
        london, total = _london_and_total_site_counts(conn)
        assert 0 < london < total, "seed should contain London and non-London sites"

    scope = _london_site_scope()
    with connect("dept_ops") as conn:
        with conn.transaction():
            # The API sets this per request from app_user.site_scope. Simulate
            # a manager scoped to London sites only.
            conn.execute("select set_config('app.site_scope', %s, true)", (scope,))
            scoped_london, scoped_total = _london_and_total_site_counts(conn)
        assert scoped_total == scoped_london == london, (
            f"scoped connection should see only the {london} London sites, "
            f"saw {scoped_total}"
        )


def test_scope_resets_between_transactions():
    """set_config(..., is_local=true) dies with its transaction, so a pooled
    connection cannot leak one user's scope into the next request."""
    scope = _london_site_scope()
    with connect("dept_ops") as conn:
        # autocommit means each transaction() block below is a real transaction
        # boundary, exactly like two pooled requests on the same connection.
        conn.autocommit = True
        with conn.transaction():
            _, unscoped_total = _london_and_total_site_counts(conn)
        with conn.transaction():
            conn.execute("select set_config('app.site_scope', %s, true)", (scope,))
        with conn.transaction():
            _, after_total = _london_and_total_site_counts(conn)
        assert after_total == unscoped_total, "scope leaked past its transaction"
