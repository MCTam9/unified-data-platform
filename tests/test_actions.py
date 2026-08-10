"""The write action: authorisation, attribution, idempotence.

Reporting roles hold SELECT only, deliberately, so a write cannot ride in on a
department connection. The action authorises against the caller's own role
first — if their grants do not let them see the exception, they cannot act on
it — then writes through the admin pool with app.user_email set, so the
append-only audit log names the person rather than the service.
"""
from __future__ import annotations

import os

import httpx
import psycopg
import pytest

API = os.environ.get("API_URL", "http://localhost:8000")
ADMIN_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://platform_admin:platform_admin_dev@localhost:5433/platform",
)


def _reachable() -> bool:
    try:
        return httpx.get(f"{API}/health", timeout=3).status_code == 200
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(not _reachable(), reason=f"API not running at {API}")


def call(token: str, site_code: str, unit_code: str) -> httpx.Response:
    return httpx.post(f"{API}/api/action/bill-licence",
                      headers={"Authorization": f"Bearer {token}"},
                      json={"site_code": site_code, "unit_code": unit_code},
                      timeout=30)


def unbilled_unit() -> tuple[str, str] | None:
    """An exception the finance role can currently see."""
    rows = httpx.get(f"{API}/api/view/vw_finance_revenue_assurance",
                     headers={"Authorization": "Bearer demo-finance"},
                     timeout=30).json()["rows"]
    for r in rows:
        if r["exception_type"] == "licence_not_invoiced":
            return r["site_code"], r["unit_code"]
    return None


@pytest.fixture()
def target() -> tuple[str, str]:
    unit = unbilled_unit()
    if not unit:
        pytest.skip("no unbilled licence left to act on — re-run tools/db/seed.py")
    return unit


def test_ops_cannot_bill(target):
    """Ops cannot even read revenue assurance, so it cannot act on it."""
    assert call("demo-ops", *target).status_code == 403


def test_sales_cannot_bill(target):
    assert call("demo-sales", *target).status_code == 403


def test_unknown_unit_is_not_found():
    assert call("demo-finance", "NO-SUCH-SITE", "K-999").status_code == 404


def test_finance_bills_and_the_exception_clears(target):
    site_code, unit_code = target
    before = len(httpx.get(f"{API}/api/view/vw_finance_revenue_assurance",
                           headers={"Authorization": "Bearer demo-finance"},
                           timeout=30).json()["rows"])

    body = call("demo-finance", site_code, unit_code).json()
    assert body["billed"] is True
    assert body["net_gbp"] > 0
    assert body["invoice_no"].startswith("INV-")

    after = httpx.get(f"{API}/api/view/vw_finance_revenue_assurance",
                      headers={"Authorization": "Bearer demo-finance"},
                      timeout=30).json()["rows"]
    assert len(after) == before - 1, "the exception should have cleared"
    assert not any(r["exception_type"] == "licence_not_invoiced"
                   and r["site_code"] == site_code and r["unit_code"] == unit_code
                   for r in after)

    # The write is attributed to the person, not the service.
    with psycopg.connect(ADMIN_DSN) as conn:
        changed_by = conn.execute("""
            select changed_by from core.audit_log
            where table_name = 'invoice' and action = 'insert'
              and new_values->>'invoice_no' = %s
        """, (body["invoice_no"],)).fetchone()
    assert changed_by and changed_by[0] == "fd@demo.local"


def test_billing_twice_does_not_duplicate(target):
    site_code, unit_code = target
    first = call("demo-finance", site_code, unit_code)
    assert first.status_code == 200
    second = call("demo-finance", site_code, unit_code)
    assert second.status_code == 404, "a second click must not raise a second invoice"

    with psycopg.connect(ADMIN_DSN) as conn:
        count = conn.execute("""
            select count(*) from core.invoice i
            join core.licence_agreement l on l.licence_id = i.licence_id
            join core.kitchen_unit u on u.unit_id = l.unit_id
            join core.site s on s.site_id = u.site_id
            where s.site_code = %s and u.unit_code = %s
              and i.period_start = date_trunc('month', current_date)::date
        """, (site_code, unit_code)).fetchone()[0]
    assert count == 1, f"expected exactly one invoice this period, found {count}"
