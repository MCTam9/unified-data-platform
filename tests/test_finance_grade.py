"""Finance-grade guarantees from 07d: period locking and the audit trail.

An FD who ran a board pack in July and gets a different July number in August
stops trusting the system permanently. These tests prove history is frozen.
"""
from __future__ import annotations

import os
from datetime import date, timedelta

import psycopg
import pytest

ADMIN_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://platform_admin:platform_admin_dev@localhost:5433/platform",
)


@pytest.fixture()
def conn():
    with psycopg.connect(ADMIN_DSN) as c:
        yield c
        c.rollback()


def _locked_invoice(conn):
    cur = conn.execute("""
        select i.invoice_id, i.period_start from core.invoice i
        join core.accounting_period ap
          on i.period_start >= ap.period_start and i.period_start <= ap.period_end
        where ap.status in ('closed','locked')
        limit 1
    """)
    row = cur.fetchone()
    assert row, "seed should contain invoices in closed periods"
    return row


def test_cannot_edit_invoice_in_closed_period(conn):
    invoice_id, _ = _locked_invoice(conn)
    with pytest.raises(psycopg.errors.RaiseException, match="closed"):
        conn.execute(
            "update core.invoice set net_gbp = net_gbp + 100 where invoice_id = %s",
            (invoice_id,))


def test_cannot_insert_into_closed_period(conn):
    cur = conn.execute("""
        select ap.period_start, ap.period_end, l.licence_id, l.partner_id
        from core.accounting_period ap, core.licence_agreement l
        where ap.status = 'locked' and l.status = 'active'
        limit 1
    """)
    period_start, period_end, licence_id, partner_id = cur.fetchone()
    with pytest.raises(psycopg.errors.RaiseException, match="closed"):
        conn.execute("""
            insert into core.invoice (invoice_no, licence_id, partner_id, period_start,
                period_end, issued_on, due_on, net_gbp, vat_gbp, status)
            values ('INV-SMUGGLED-1', %s, %s, %s, %s, %s, %s, 100, 20, 'issued')
        """, (licence_id, partner_id, period_start, period_end,
              period_start, period_start + timedelta(days=14)))


def test_cannot_delete_from_closed_period(conn):
    invoice_id, _ = _locked_invoice(conn)
    with pytest.raises(psycopg.errors.RaiseException, match="closed"):
        conn.execute("delete from core.payment where invoice_id = %s", (invoice_id,))
        conn.execute("delete from core.invoice where invoice_id = %s", (invoice_id,))


def test_open_period_writes_are_audited(conn):
    """A change in the open period succeeds and lands in the audit log with
    the acting user, the old values and the new values."""
    cur = conn.execute("""
        select i.invoice_id, i.net_gbp from core.invoice i
        join core.accounting_period ap
          on i.period_start >= ap.period_start and i.period_start <= ap.period_end
        where ap.status = 'open'
        limit 1
    """)
    invoice_id, old_net = cur.fetchone()
    conn.execute("select set_config('app.user_email', 'fd@demo.local', true)")
    conn.execute(
        "update core.invoice set net_gbp = net_gbp + 1 where invoice_id = %s",
        (invoice_id,))
    cur = conn.execute("""
        select changed_by, (old_values->>'net_gbp')::numeric, (new_values->>'net_gbp')::numeric
        from core.audit_log
        where table_name = 'invoice' and row_id = %s and action = 'update'
        order by changed_at desc limit 1
    """, (invoice_id,))
    changed_by, logged_old, logged_new = cur.fetchone()
    assert changed_by == "fd@demo.local"
    assert logged_old == old_net
    assert logged_new == old_net + 1
    # rollback in fixture: the seed data is left untouched


def test_double_letting_is_impossible(conn):
    """The GiST exclusion constraint: a unit cannot hold two overlapping
    active licences. Not discouraged — impossible."""
    cur = conn.execute("""
        select l.unit_id, l.partner_id from core.licence_agreement l
        where l.status = 'active' and l.end_date is null limit 1
    """)
    unit_id, partner_id = cur.fetchone()
    with pytest.raises(psycopg.errors.ExclusionViolation):
        conn.execute("""
            insert into core.licence_agreement (unit_id, partner_id, line_code,
                start_date, monthly_fee_gbp, status)
            values (%s, %s, 'CORE', current_date, 2000, 'active')
        """, (unit_id, partner_id))
