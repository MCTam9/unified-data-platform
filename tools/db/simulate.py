#!/usr/bin/env python3
"""Demo activity simulator — makes the dashboard visibly live.

Writes plausible business events into the OPEN accounting period only: the
period-lock trigger rejects anything historical, which is exactly the
guarantee the demo should show off. Every write also lands in core.audit_log
via the triggers — point at it when someone asks "who changed that number?".

Events per tick (1–3 chosen at random):
  payment          a partner pays an outstanding invoice (full or partial)
  food_order       a fulfilled operated-food order right now
  ticket           a maintenance ticket is raised, or an open one resolved
  enquiry          a new enquiry arrives, or one advances a pipeline stage
  billing_catchup  (rare) an unbilled licence gets invoiced for this period —
                   the revenue-assurance leakage headline visibly drops

Layer 3 contract:
  exit 0 — ran to completion (--once) or stopped cleanly (SIGINT)
  exit 1 — could not connect / no open period

Usage:
  python tools/db/simulate.py --interval 5        # loop until Ctrl-C
  python tools/db/simulate.py --once              # single tick (CI-friendly)
"""
from __future__ import annotations

import argparse
import os
import random
import signal
import sys
import time
from pathlib import Path
from datetime import date, datetime, timezone
from decimal import Decimal

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.db.billing import bill_licence, find_unbilled_licence

DEFAULT_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://platform_admin:platform_admin_dev@localhost:5433/platform",
)

CUISINES = ["Ramen", "Wings", "Tacos", "Sushi", "Pizza", "Bao", "Curry", "Salads"]
FIRST = ["Ada", "Marco", "Priya", "Tom", "Yuki", "Sofia", "Leo", "Nadia"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def ev_payment(cur) -> str | None:
    """A partner pays an outstanding invoice in the open period."""
    cur.execute("""
        select i.invoice_id, i.net_gbp + i.vat_gbp - coalesce(p.paid, 0) as due
        from core.invoice i
        join core.accounting_period ap
          on i.period_start >= ap.period_start and i.period_start <= ap.period_end
        left join lateral (select sum(amount_gbp) paid from core.payment
                           where invoice_id = i.invoice_id) p on true
        where ap.status = 'open' and i.status in ('issued','part_paid','overdue')
          and i.net_gbp + i.vat_gbp - coalesce(p.paid, 0) > 0
        order by random() limit 1
    """)
    row = cur.fetchone()
    if not row:
        return None
    invoice_id, due = row
    partial = random.random() < 0.3
    amount = (due * Decimal("0.5")).quantize(Decimal("0.01")) if partial else due
    cur.execute(
        "insert into core.payment (invoice_id, received_on, amount_gbp, method) "
        "values (%s, current_date, %s, %s)",
        (invoice_id, amount, random.choice(["bacs", "direct_debit", "card"])))
    cur.execute("update core.invoice set status = %s where invoice_id = %s",
                ("part_paid" if partial else "paid", invoice_id))
    return f"payment £{amount:,.2f} ({'partial' if partial else 'settled'})"


def ev_food_order(cur) -> str | None:
    cur.execute("""
        select ob.brand_id, s.site_id from core.operated_brand ob
        join core.sales_order so on so.brand_id = ob.brand_id
        join core.site s on s.site_id = so.site_id
        order by random() limit 1
    """)
    row = cur.fetchone()
    if not row:
        return None
    brand_id, site_id = row
    gross = Decimal(str(round(random.uniform(12, 90), 2)))
    channel = random.choice(["deliveroo", "ubereats", "direct_web", "corporate"])
    comm = (gross * Decimal({"deliveroo": "0.32", "ubereats": "0.30",
                             "direct_web": "0.03", "corporate": "0"}[channel]))
    cur.execute("""
        insert into core.sales_order (brand_id, site_id, channel, placed_at, gross_gbp,
            platform_commission_gbp, discount_gbp, net_gbp, items, status)
        values (%s,%s,%s,%s,%s,%s,0,%s,%s,'fulfilled')
    """, (brand_id, site_id, channel, _now(), gross,
          comm.quantize(Decimal("0.01")),
          (gross - comm).quantize(Decimal("0.01")), random.randint(1, 5)))
    return f"food order £{gross} via {channel}"


def ev_ticket(cur) -> str | None:
    if random.random() < 0.5:
        cur.execute("""
            update core.maintenance_ticket
            set status = 'resolved', resolved_on = %s, cost_gbp = %s
            where ticket_id = (select ticket_id from core.maintenance_ticket
                               where status in ('open','in_progress')
                               order by random() limit 1)
            returning category
        """, (_now(), Decimal(random.randint(90, 1800))))
        row = cur.fetchone()
        if row:
            return f"ticket resolved ({row[0]})"
    cur.execute("""
        insert into core.maintenance_ticket (site_id, unit_id, raised_on, category,
            priority, status)
        select site_id, unit_id, %s, %s, %s, 'open'
        from core.kitchen_unit order by random() limit 1
        returning category
    """, (_now(), random.choice(["extraction", "refrigeration", "plumbing",
                                 "electrical", "fabric"]),
          random.choices(["P1", "P2", "P3"], weights=[1, 3, 6])[0]))
    return f"ticket raised ({cur.fetchone()[0]})"


def ev_enquiry(cur) -> str | None:
    if random.random() < 0.5:
        cur.execute("""
            update core.enquiry set stage = case stage
                when 'new' then 'qualified' when 'qualified' then 'viewing'
                when 'viewing' then 'proposal' else 'won' end,
                closed_on = case when stage = 'proposal' then current_date end
            where enquiry_id = (select enquiry_id from core.enquiry
                                where stage in ('new','qualified','viewing','proposal')
                                order by random() limit 1)
            returning brand_name, stage
        """)
        row = cur.fetchone()
        if row:
            return f"enquiry advanced: {row[0]} → {row[1]}"
    name = f"{random.choice(FIRST)}'s {random.choice(CUISINES)}"
    cur.execute("""
        insert into core.enquiry (brand_name, line_code, source, received_on,
            target_site_id, units_requested, stage, expected_monthly_fee_gbp)
        select %s, 'CORE', %s, current_date, site_id, 1, 'new', %s
        from core.site where closed_on is null order by random() limit 1
    """, (name, random.choice(["website", "referral", "broker"]),
          Decimal(random.randint(1800, 2600))))
    return f"new enquiry: {name}"


def ev_billing_catchup(cur) -> str | None:
    """Invoice one unbilled active licence for the current period — the
    leakage headline drops in front of the audience. Shares its implementation
    with the app's "Bill this now" action so the two cannot drift."""
    licence_id = find_unbilled_licence(cur)
    if not licence_id:
        return None
    invoice = bill_licence(cur, licence_id)
    if not invoice:
        return None
    return (f"BILLING CATCH-UP: {invoice['partner']} at {invoice['site_code']} "
            f"{invoice['unit_code']} invoiced £{invoice['net_gbp']:,.0f} — leakage drops")


EVENTS = [ev_payment, ev_food_order, ev_ticket, ev_enquiry]


def tick(conn) -> list[str]:
    done = []
    with conn.cursor() as cur:
        cur.execute("select set_config('app.user_email', 'simulator@demo.local', false)")
        for fn in random.sample(EVENTS, k=random.randint(1, 3)):
            msg = fn(cur)
            if msg:
                done.append(msg)
        if random.random() < 1 / 15:
            msg = ev_billing_catchup(cur)
            if msg:
                done.append(msg)
    conn.commit()
    return done


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", default=DEFAULT_DSN)
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    stop = {"flag": False}
    signal.signal(signal.SIGINT, lambda *_: stop.update(flag=True))
    signal.signal(signal.SIGTERM, lambda *_: stop.update(flag=True))

    try:
        conn = psycopg.connect(args.dsn)
    except psycopg.OperationalError as exc:
        print(f"error: cannot connect: {exc}", file=sys.stderr)
        return 1

    with conn:
        cur = conn.execute(
            "select count(*) from core.accounting_period where status = 'open'")
        if cur.fetchone()[0] == 0:
            print("error: no open accounting period — nothing can be written",
                  file=sys.stderr)
            return 1

        while True:
            for msg in tick(conn):
                print(f"[{datetime.now():%H:%M:%S}] {msg}")
            if args.once or stop["flag"]:
                break
            time.sleep(args.interval)
            if stop["flag"]:
                break
    print("simulator: stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
