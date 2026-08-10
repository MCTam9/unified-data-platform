# SOP — Month-end close

Layer 1 workflow. A human (or an agent) follows these steps in order; every
step names the deterministic tool it calls. Close is a query, not a rebuild —
because the data was captured as it happened, not re-collated at month end.

## Pre-close (working day 1)

1. **Reconcile.** `python tools/quality/reconcile.py` — must exit 0.
   If it drifts, stop: nothing downstream is trustworthy until the numbers tie.
2. **Data-quality exceptions.** Query `reporting.vw_data_exceptions` (as
   finance or ops). Every non-zero class routes to its named domain owner —
   a person, never a shared inbox.
3. **Revenue assurance.** Query `reporting.vw_finance_revenue_assurance`.
   Every `licence_not_invoiced` and `underbilled` exception is resolved or
   explained before close — this is the leak-finding step.

## Close (working day 2)

4. **Verify the boundary still holds.** `python tools/db/verify_grants.py`
   and `python -m pytest tests/` — both must pass. A grant that drifted during
   the month is a finding, not a nuisance.
5. **Mark the period closed.** As the admin role:
   `update core.accounting_period set status = 'closed', closed_on = now(),
   closed_by = '<email>' where period_start = '<period>';`
   From this moment the period-lock trigger rejects any write into the period.
6. **Corrections after close** go in as `core.period_adjustment` rows booked
   in the CURRENT period — never as edits to history. The audit log records
   who raised them.

## Report (working day 3)

7. P&L vs budget from `reporting.vw_finance_site_pnl` and
   `reporting.vw_finance_budget_variance`; aged debt from
   `reporting.vw_finance_aged_debt`. The numbers are frozen: re-running the
   pack next month returns the same figures for this period.
