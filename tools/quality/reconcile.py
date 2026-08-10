#!/usr/bin/env python3
"""Reconciliation checks: do the reported numbers tie?

If site contribution + central overhead does not equal the total P&L, Finance
will never trust the system. This tool asserts the ties that make the numbers
signable, and exits non-zero on drift — runnable in CI on every schema change.

Checks:
  1. Sum of vw_finance_site_pnl revenue == sum of core.invoice net (non-written-off).
  2. Sum of vw_finance_site_pnl expenses + central overhead == sum of core.expense.
  3. Collected revenue in the P&L == sum of core.payment (excluding payments
     against written-off invoices).
  4. Aged-debt outstanding == invoice totals minus payments for unpaid invoices.

  exit 0 — everything ties
  exit 1 — a check drifted (details on stderr)
"""
from __future__ import annotations

import argparse
import os
import sys
from decimal import Decimal

import psycopg

DEFAULT_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://platform_admin:platform_admin_dev@localhost:5433/platform",
)

TOLERANCE = Decimal("0.01")


def check(cur, name: str, sql_a: str, sql_b: str) -> bool:
    cur.execute(sql_a)
    a = cur.fetchone()[0] or Decimal("0")
    cur.execute(sql_b)
    b = cur.fetchone()[0] or Decimal("0")
    ok = abs(a - b) <= TOLERANCE
    marker = "ok " if ok else "FAIL"
    stream = sys.stdout if ok else sys.stderr
    print(f"  [{marker}] {name}: {a:,.2f} vs {b:,.2f} (diff {a - b:,.2f})", file=stream)
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", default=DEFAULT_DSN)
    args = parser.parse_args()

    with psycopg.connect(args.dsn) as conn:
        cur = conn.cursor()
        results = [
            check(cur, "invoiced revenue ties to ledger",
                  "select sum(revenue_invoiced_gbp) from reporting.vw_finance_site_pnl",
                  "select sum(net_gbp) from core.invoice where status <> 'written_off'"),
            check(cur, "site expenses + central overhead tie to expense ledger",
                  "select (select sum(total_expense_gbp) from reporting.vw_finance_site_pnl)"
                  " + (select coalesce(sum(amount_gbp),0) from core.expense where site_id is null)",
                  "select sum(amount_gbp) from core.expense"),
            check(cur, "collected revenue ties to payments",
                  "select sum(revenue_collected_gbp) from reporting.vw_finance_site_pnl",
                  "select coalesce(sum(p.amount_gbp),0) from core.payment p"
                  " join core.invoice i on i.invoice_id = p.invoice_id"
                  " where i.status <> 'written_off'"),
            check(cur, "aged debt ties to unpaid invoices minus payments",
                  "select sum(outstanding_gbp) from reporting.vw_finance_aged_debt",
                  "select sum(i.net_gbp + i.vat_gbp - coalesce(p.paid,0))"
                  " from core.invoice i"
                  " left join lateral (select sum(amount_gbp) paid from core.payment"
                  "   where invoice_id = i.invoice_id) p on true"
                  " where i.status not in ('paid','written_off')"
                  "   and i.net_gbp + i.vat_gbp - coalesce(p.paid,0) > 0"),
        ]

    if all(results):
        print("reconcile: ok — the numbers tie")
        return 0
    print("reconcile: DRIFT — do not ship reporting until this ties", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
