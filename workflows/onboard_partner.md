# SOP — Onboard a partner into a unit

The enquiry → viewing → licence → unit-occupied → first-invoice chain crosses
Sales, Ops and Finance. This is where every downstream record originates, and
where a missed step becomes the unbilled unit the revenue-assurance view
catches a month later. Each step has an owning department and a due date; a
missed `billing_activated` lights up `vw_finance_revenue_assurance` — capture
creates the record, reporting catches the gap, the gap has a named owner.

1. **Open the case.** Insert `core.onboarding_case` linked to the won
   `core.enquiry` and the target `core.kitchen_unit`. Steps are created from
   the standard list with due dates.
2. **credit_check** (FINANCE) — set `core.brand_partner.credit_band`.
3. **licence_signed** (SALES) — insert `core.licence_agreement`. The
   `licence_no_overlap` constraint makes double-letting impossible; if the
   insert fails, the unit already has an overlapping licence — investigate,
   don't force.
4. **deposit_received** (FINANCE) — record against the licence.
5. **id_verified** (OPS) — identity documents are personal data: store the
   document reference in `core.document`, never the content in free text.
6. **keys_issued** (OPS) — set the unit's status to `occupied` and insert the
   `core.unit_status_history` row (`valid_from` = move-in date).
7. **food_registration** (OPS) — record the registration certificate in
   `core.compliance_certificate` with its expiry.
8. **billing_activated** (FINANCE) — the licence joins the next billing run.
   THIS is the step that, when missed, becomes silent revenue leakage.
9. **Complete the case.** All steps done → `status = 'completed'`,
   `completed_on` set. Overdue open steps appear in
   `reporting.vw_data_exceptions` (`onboarding_step_overdue`).
