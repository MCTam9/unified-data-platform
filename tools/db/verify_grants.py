#!/usr/bin/env python3
"""Print the effective grant matrix: which role can read which reporting view.

Demoable in ten seconds: the boundary is visible, and it lives in Postgres.
  exit 0 — matrix printed and every expectation holds
  exit 1 — a grant is missing or a role can see something it should not

Usage:
  python tools/db/verify_grants.py [--dsn DSN]
"""
from __future__ import annotations

import argparse
import os
import sys

import psycopg

DEFAULT_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://platform_admin:platform_admin_dev@localhost:5433/platform",
)

ROLES = ["dept_finance", "dept_ops", "dept_sales"]

EXPECTED = {
    "vw_finance_site_pnl":           {"dept_finance"},
    "vw_finance_aged_debt":          {"dept_finance"},
    "vw_finance_budget_variance":    {"dept_finance"},
    "vw_finance_lease_exposure":     {"dept_finance"},
    "vw_finance_operated_brand_pnl": {"dept_finance"},
    "vw_finance_revenue_assurance":  {"dept_finance"},
    "vw_finance_leakage_summary":    {"dept_finance"},
    "vw_ops_site_occupancy":         {"dept_ops"},
    "vw_ops_maintenance_load":       {"dept_ops"},
    "vw_ops_utility_intensity":      {"dept_ops"},
    "vw_ops_compliance_expiry":      {"dept_ops"},
    "vw_ops_asset_replacement":      {"dept_ops"},
    "vw_sales_pipeline":             {"dept_sales"},
    "vw_sales_conversion":           {"dept_sales"},
    "vw_sales_churn_risk":           {"dept_sales"},
    "vw_scorecard":                  {"dept_finance", "dept_ops", "dept_sales"},
    "vw_data_exceptions":            {"dept_finance", "dept_ops"},
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", default=DEFAULT_DSN)
    args = parser.parse_args()

    ok = True
    with psycopg.connect(args.dsn) as conn:
        cur = conn.cursor()
        width = max(len(v) for v in EXPECTED) + 2
        print(f"{'view'.ljust(width)}  " + "  ".join(r.replace('dept_', '') for r in ROLES))
        for view in sorted(EXPECTED):
            cells = []
            for role in ROLES:
                cur.execute(
                    "select has_table_privilege(%s, %s, 'select')",
                    (role, f"reporting.{view}"))
                granted = cur.fetchone()[0]
                expected = role in EXPECTED[view]
                if granted != expected:
                    ok = False
                    cells.append("!! " if granted else "MISS")
                else:
                    cells.append("  ✓  " if granted else "  ·  ")
            print(f"{view.ljust(width)}{''.join(c.ljust(9) for c in cells)}")

        # core must be dark for all three roles
        cur.execute("""
            select table_name from information_schema.tables
            where table_schema = 'core' and table_type = 'BASE TABLE'
        """)
        leaks = []
        for (table,) in cur.fetchall():
            for role in ROLES:
                cur.execute("select has_table_privilege(%s, %s, 'select')",
                            (role, f"core.{table}"))
                if cur.fetchone()[0]:
                    leaks.append(f"{role} can read core.{table}")
        if leaks:
            ok = False
            for leak in leaks:
                print(f"LEAK: {leak}", file=sys.stderr)
        else:
            print(f"\ncore schema: dark for all {len(ROLES)} department roles ✓")

    if not ok:
        print("verify_grants: FAILED", file=sys.stderr)
        return 1
    print("verify_grants: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
