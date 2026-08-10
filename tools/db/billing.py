"""Raise the missing invoice for an active licence — one implementation.

Used by two callers that must not drift: the demo activity simulator, which
does it at random, and the "Bill this now" action in the app, which does it
because a person clicked the exception.

Everything about the guarantees comes from the database, not from here:
  * the period-lock trigger refuses anything outside the open period;
  * the audit triggers attribute the write to `app.user_email`;
  * the `where not exists` makes a second click a no-op rather than a
    duplicate invoice.
"""
from __future__ import annotations

from decimal import Decimal

VAT_RATE = Decimal("0.20")

# An active licence that has no invoice covering the current period — exactly
# the population reporting.vw_finance_revenue_assurance reports as
# 'licence_not_invoiced'.
_UNBILLED = """
    select l.licence_id
    from core.licence_agreement l
    join core.kitchen_unit u on u.unit_id = l.unit_id
    join core.site s        on s.site_id  = u.site_id
    where l.status = 'active'
      and l.start_date <= date_trunc('month', current_date)
      and (l.end_date is null or l.end_date >= current_date)
      and not exists (
          select 1 from core.invoice i
          where i.licence_id = l.licence_id
            and i.period_start = date_trunc('month', current_date)::date)
"""


def find_unbilled_licence(cur, site_code: str | None = None,
                          unit_code: str | None = None) -> str | None:
    """The licence behind an unbilled unit. With no arguments, any one of them
    (the simulator); with a site and unit, that specific one (the action)."""
    if site_code and unit_code:
        cur.execute(_UNBILLED + " and s.site_code = %s and u.unit_code = %s limit 1",
                    (site_code, unit_code))
    else:
        cur.execute(_UNBILLED + " order by random() limit 1")
    row = cur.fetchone()
    return row[0] if row else None


def bill_licence(cur, licence_id: str) -> dict | None:
    """Invoice one licence for the current period. Returns the invoice, or
    None if it was already billed — so calling twice is safe."""
    cur.execute("""
        insert into core.invoice (
            invoice_no, licence_id, partner_id, period_start, period_end,
            issued_on, due_on, net_gbp, vat_gbp, vat_code,
            recognition_start, recognition_end, status)
        select 'INV-CATCHUP-' || substr(gen_random_uuid()::text, 1, 8),
               l.licence_id, l.partner_id,
               date_trunc('month', current_date)::date,
               (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
               current_date, current_date + 14,
               l.monthly_fee_gbp, round(l.monthly_fee_gbp * %s, 2), 'S',
               date_trunc('month', current_date)::date,
               (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
               'issued'
        from core.licence_agreement l
        where l.licence_id = %s
          and not exists (
              select 1 from core.invoice i
              where i.licence_id = l.licence_id
                and i.period_start = date_trunc('month', current_date)::date)
        returning invoice_no, net_gbp, vat_gbp
    """, (VAT_RATE, licence_id))
    row = cur.fetchone()
    if not row:
        return None
    invoice_no, net, vat = row

    cur.execute("""
        select bp.trading_name, s.site_code, u.unit_code
        from core.licence_agreement l
        join core.brand_partner bp on bp.partner_id = l.partner_id
        join core.kitchen_unit  u  on u.unit_id     = l.unit_id
        join core.site          s  on s.site_id     = u.site_id
        where l.licence_id = %s
    """, (licence_id,))
    partner, site_code, unit_code = cur.fetchone()
    return {"invoice_no": invoice_no, "net_gbp": float(net), "vat_gbp": float(vat),
            "partner": partner, "site_code": site_code, "unit_code": unit_code}
