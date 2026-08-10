# SOP — Monthly billing run (draft → approve → post)

The flagship digitisation deliverable: invoices generated deterministically
from active licences instead of by hand. This removes days of monthly work and
stops the leakage classes the revenue-assurance view exists to catch — found
once, then prevented, rather than re-found every month.

1. **Draft.** Insert a `core.billing_run` with `status = 'draft'` for the
   period. Generate one invoice per active licence whose `start_date` covers
   the period: `net_gbp = monthly_fee_gbp`, VAT from `core.vat_rate`,
   `recognition_start/end` = the period (billed in advance ≠ earned).
   Invoices reference `run_id`; a null `run_id` means manually raised — itself
   a signal worth watching.
2. **Recharges.** For licences with `utilities_included = false`, add the
   utility recharge line per `recharge_basis` (submeter reading or floor-area
   apportionment from `core.utility_reading`).
3. **Review.** Compare the draft run's `invoice_count` and `total_net_gbp`
   against last period. Every difference has a reason: a new licence, an
   ended one, a fee change. Unexplained differences stop the run.
4. **Approve.** `status = 'approved'` by someone other than the generator.
5. **Post.** `status = 'posted'`. The partial unique index
   `billing_run_one_posted_per_period` makes a second posted run for the same
   period impossible — enforced by the database, not by care.
6. **Verify.** `reporting.vw_finance_revenue_assurance` should show zero
   `licence_not_invoiced` and zero `underbilled` exceptions for the period.
   If it doesn't, the run missed something — fix and re-check before issuing.
