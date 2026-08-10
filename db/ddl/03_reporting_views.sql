-- ============================================================================
-- UNIFIED DATA PLATFORM — REPORTING VIEWS (section 08 + 07e scorecard)
-- One view set per department. These are the only objects users touch.
-- ============================================================================

-- ============================== 1. FINANCE ==================================

create or replace view reporting.vw_finance_site_pnl as
with revenue as (
    select u.site_id,
           l.line_code,
           date_trunc('month', i.period_start)::date as period,
           sum(i.net_gbp)                            as revenue_invoiced_gbp,
           sum(coalesce(paid.amount, 0))             as revenue_collected_gbp
    from core.invoice i
    join core.licence_agreement l on l.licence_id = i.licence_id
    join core.kitchen_unit      u on u.unit_id    = l.unit_id
    left join lateral (
        select sum(p.amount_gbp) as amount
        from core.payment p
        where p.invoice_id = i.invoice_id
    ) paid on true
    where i.status <> 'written_off'
    group by 1, 2, 3
),
cost as (
    select e.site_id,
           e.line_code,
           date_trunc('month', e.period_start)::date as period,
           sum(e.amount_gbp) filter (where e.category = 'rent')           as rent_gbp,
           sum(e.amount_gbp) filter (where e.category = 'business_rates') as rates_gbp,
           sum(e.amount_gbp) filter (where e.category = 'utilities')      as utilities_gbp,
           sum(e.amount_gbp) filter (where e.category = 'site_labour')    as labour_gbp,
           sum(e.amount_gbp) filter (where e.category = 'maintenance')    as maintenance_gbp,
           sum(e.amount_gbp)                                              as total_expense_gbp
    from core.expense e
    where e.site_id is not null          -- central overhead excluded by design
    group by 1, 2, 3
)
select s.site_code,
       s.name                                          as site_name,
       s.region,
       coalesce(r.line_code, c.line_code)              as business_line,
       coalesce(r.period, c.period)                    as period,
       coalesce(r.revenue_invoiced_gbp, 0)             as revenue_invoiced_gbp,
       coalesce(r.revenue_collected_gbp, 0)            as revenue_collected_gbp,
       coalesce(c.rent_gbp, 0)                         as rent_gbp,
       coalesce(c.rates_gbp, 0)                        as rates_gbp,
       coalesce(c.utilities_gbp, 0)                    as utilities_gbp,
       coalesce(c.labour_gbp, 0)                       as labour_gbp,
       coalesce(c.maintenance_gbp, 0)                  as maintenance_gbp,
       coalesce(c.total_expense_gbp, 0)                as total_expense_gbp,
       coalesce(r.revenue_invoiced_gbp, 0)
         - coalesce(c.total_expense_gbp, 0)            as contribution_gbp,
       round(
           case when coalesce(r.revenue_invoiced_gbp, 0) = 0 then null
                else 100.0 * (coalesce(r.revenue_invoiced_gbp, 0)
                              - coalesce(c.total_expense_gbp, 0))
                     / r.revenue_invoiced_gbp
           end, 1)                                     as contribution_margin_pct,
       round(
           case when coalesce(r.revenue_invoiced_gbp, 0) = 0 then null
                else 100.0 * coalesce(c.labour_gbp, 0) / r.revenue_invoiced_gbp
           end, 1)                                     as labour_pct_of_revenue
from revenue r
full outer join cost c
     on c.site_id = r.site_id and c.period = r.period and c.line_code = r.line_code
join core.site s on s.site_id = coalesce(r.site_id, c.site_id);

create or replace view reporting.vw_finance_aged_debt as
select bp.trading_name,
       bp.credit_band,
       s.site_code,
       i.invoice_no,
       i.due_on,
       (current_date - i.due_on)                      as days_overdue,
       case
           when current_date <= i.due_on            then 'current'
           when current_date - i.due_on <= 30       then '1-30'
           when current_date - i.due_on <= 60       then '31-60'
           when current_date - i.due_on <= 90       then '61-90'
           else '90+'
       end                                            as ageing_bucket,
       i.net_gbp + i.vat_gbp
         - coalesce(paid.amount, 0)                   as outstanding_gbp
from core.invoice i
join core.brand_partner     bp on bp.partner_id = i.partner_id
join core.licence_agreement l  on l.licence_id  = i.licence_id
join core.kitchen_unit      u  on u.unit_id     = l.unit_id
join core.site              s  on s.site_id     = u.site_id
left join lateral (
    select sum(p.amount_gbp) as amount
    from core.payment p where p.invoice_id = i.invoice_id
) paid on true
where i.status not in ('paid','written_off')
  and i.net_gbp + i.vat_gbp - coalesce(paid.amount, 0) > 0;

-- Budget variance. For an FD this outranks the raw P&L.
create or replace view reporting.vw_finance_budget_variance as
with actual as (
    select site_code, business_line, period, 'revenue' as measure,
           revenue_invoiced_gbp as actual_value
    from reporting.vw_finance_site_pnl
    union all
    select site_code, business_line, period, 'utilities', utilities_gbp
    from reporting.vw_finance_site_pnl
    union all
    select site_code, business_line, period, 'site_labour', labour_gbp
    from reporting.vw_finance_site_pnl
    union all
    select site_code, business_line, period, 'rent', rent_gbp
    from reporting.vw_finance_site_pnl
)
select a.site_code,
       a.business_line,
       a.period,
       a.measure,
       a.actual_value,
       b.budget_value,
       a.actual_value - b.budget_value                       as variance_gbp,
       round(case when b.budget_value = 0 then null
                  else 100.0 * (a.actual_value - b.budget_value) / b.budget_value
             end, 1)                                          as variance_pct
from actual a
join core.site s on s.site_code = a.site_code
left join core.budget_line b
       on b.site_id      = s.site_id
      and b.line_code    = a.business_line
      and b.period_start = a.period
      and b.measure      = a.measure
      and b.scenario     = 'budget';

-- Head-lease exposure: break dates and rent reviews are the biggest
-- forward-looking cost risk in a leasehold estate.
create or replace view reporting.vw_finance_lease_exposure as
select p.name                                        as property_name,
       p.city,
       hl.landlord,
       hl.passing_rent_gbp,
       hl.service_charge_gbp,
       hl.expiry_date,
       (hl.expiry_date - current_date)                as days_to_expiry,
       hl.review_type,
       hl.next_review_on,
       hl.break_date,
       hl.dilapidations_provision_gbp,
       count(distinct s.site_id)                      as sites_on_property,
       count(u.unit_id)                               as units_on_property
from core.head_lease hl
join core.property p on p.property_id = hl.property_id
left join core.site s on s.property_id = p.property_id
left join core.kitchen_unit u on u.site_id = s.site_id
group by hl.lease_id, p.name, p.city, hl.landlord, hl.passing_rent_gbp,
         hl.service_charge_gbp, hl.expiry_date, hl.review_type,
         hl.next_review_on, hl.break_date, hl.dilapidations_provision_gbp;

-- Own-operated food margin: structurally different from licence revenue, so it
-- gets its own view rather than distorting the site P&L.
create or replace view reporting.vw_finance_operated_brand_pnl as
with rev as (
    select o.brand_id,
           o.site_id,
           date_trunc('month', o.placed_at)::date            as period,
           sum(o.gross_gbp)                                   as gross_gbp,
           sum(o.platform_commission_gbp)                     as commission_gbp,
           sum(o.discount_gbp)                                as discount_gbp,
           sum(o.net_gbp)                                     as net_revenue_gbp,
           count(*)                                           as orders
    from core.sales_order o
    where o.status = 'fulfilled'
    group by 1, 2, 3
)
select ob.name                                                  as brand,
       s.site_code,
       rev.period,
       rev.orders,
       rev.gross_gbp,
       rev.commission_gbp,
       round(100.0 * rev.commission_gbp / nullif(rev.gross_gbp, 0), 1)
                                                                as commission_pct_of_gross,
       rev.net_revenue_gbp,
       coalesce(c.food_cost_gbp, 0) + coalesce(c.packaging_gbp, 0)
         + coalesce(c.wastage_gbp, 0)                           as cogs_gbp,
       round(100.0 * (coalesce(c.food_cost_gbp, 0) + coalesce(c.packaging_gbp, 0)
             + coalesce(c.wastage_gbp, 0)) / nullif(rev.net_revenue_gbp, 0), 1)
                                                                as cogs_pct_of_net,
       rev.net_revenue_gbp - coalesce(c.food_cost_gbp, 0)
         - coalesce(c.packaging_gbp, 0) - coalesce(c.wastage_gbp, 0)
                                                                as gross_margin_gbp
from rev
join core.operated_brand ob on ob.brand_id = rev.brand_id
join core.site s            on s.site_id   = rev.site_id
left join core.cogs_entry c
       on c.brand_id     = rev.brand_id
      and c.site_id      = rev.site_id
      and c.period_start = rev.period;

-- ================== 2. REVENUE ASSURANCE — the view that finds money ========
-- Open the FD demo with this one. Exception classes over data the core schema
-- already holds: what did we earn this month and not bill for?

create or replace view reporting.vw_finance_revenue_assurance as

-- (a) Unit is physically occupied but has no active licence behind it.
select 'occupied_no_licence'                      as exception_type,
       s.site_code,
       u.unit_code,
       null::text                                  as partner,
       null::numeric                               as expected_gbp,
       null::numeric                               as actual_gbp,
       null::numeric                               as gap_gbp,
       'Unit marked occupied with no active licence' as detail
from core.kitchen_unit u
join core.site s on s.site_id = u.site_id
where u.status = 'occupied'
  and not exists (
      select 1 from core.licence_agreement l
      where l.unit_id = u.unit_id and l.status = 'active')

union all

-- (b) Active licence with no invoice covering the current period.
select 'licence_not_invoiced',
       s.site_code,
       u.unit_code,
       bp.trading_name,
       l.monthly_fee_gbp,
       0,
       l.monthly_fee_gbp,
       'Active licence with no invoice for the current period'
from core.licence_agreement l
join core.kitchen_unit  u  on u.unit_id    = l.unit_id
join core.site          s  on s.site_id    = u.site_id
join core.brand_partner bp on bp.partner_id = l.partner_id
where l.status = 'active'
  and l.start_date <= date_trunc('month', current_date)
  -- A licence past its end date belongs to the 'expired still active' class
  -- below: it needs closing, not invoicing. Excluding it here stops the same
  -- licence being counted twice and overstating the leakage figure.
  and (l.end_date is null or l.end_date >= current_date)
  and not exists (
      select 1 from core.invoice i
      where i.licence_id = l.licence_id
        and i.period_start = date_trunc('month', current_date)::date)

union all

-- (c) Invoiced below the contracted fee — silent underbilling.
select 'underbilled',
       s.site_code,
       u.unit_code,
       bp.trading_name,
       l.monthly_fee_gbp,
       i.net_gbp,
       l.monthly_fee_gbp - i.net_gbp,
       'Invoiced amount is below the contracted monthly fee'
from core.invoice i
join core.licence_agreement l on l.licence_id  = i.licence_id
join core.kitchen_unit  u     on u.unit_id     = l.unit_id
join core.site          s     on s.site_id     = u.site_id
join core.brand_partner bp    on bp.partner_id = l.partner_id
where i.status <> 'written_off'
  and i.net_gbp < l.monthly_fee_gbp

union all

-- (d) Licence past its end date but never closed.
select 'licence_expired_still_active',
       s.site_code,
       u.unit_code,
       bp.trading_name,
       l.monthly_fee_gbp,
       null,
       null,
       'Licence end date has passed but status is still active'
from core.licence_agreement l
join core.kitchen_unit  u  on u.unit_id     = l.unit_id
join core.site          s  on s.site_id     = u.site_id
join core.brand_partner bp on bp.partner_id = l.partner_id
where l.status = 'active'
  and l.end_date is not null
  and l.end_date < current_date

union all

-- (e) Head-lease rent review date passed with no recorded action.
select 'rent_review_missed',
       coalesce(s.site_code, p.name),
       null,
       hl.landlord,
       hl.passing_rent_gbp,
       null,
       null,
       'Rent review date has passed on the head lease'
from core.head_lease hl
join core.property p on p.property_id = hl.property_id
left join core.site s on s.property_id = p.property_id
where hl.next_review_on is not null
  and hl.next_review_on < current_date

union all

-- (f) Licence says utilities are recharged, but no recharge line exists.
select 'utilities_not_recharged',
       s.site_code,
       u.unit_code,
       bp.trading_name,
       null, null, null,
       'Licence has a recharge basis set but no utility recharge was billed'
from core.licence_agreement l
join core.kitchen_unit  u  on u.unit_id     = l.unit_id
join core.site          s  on s.site_id     = u.site_id
join core.brand_partner bp on bp.partner_id = l.partner_id
where l.status = 'active'
  and l.utilities_included = false
  and l.recharge_basis is not null
  and l.recharge_basis <> 'none'
  and not exists (
      select 1 from core.invoice i
      where i.licence_id = l.licence_id
        and i.period_start = date_trunc('month', current_date)::date
        and i.net_gbp > l.monthly_fee_gbp);

-- The headline number: computed from the data, never asserted.
create or replace view reporting.vw_finance_leakage_summary as
select exception_type,
       count(*)                        as cases,
       coalesce(sum(gap_gbp), 0)       as monthly_gap_gbp,
       coalesce(sum(gap_gbp), 0) * 12  as annualised_gap_gbp
from reporting.vw_finance_revenue_assurance
group by exception_type
order by 4 desc nulls last;

-- ============================== 3. OPERATIONS ===============================
-- Ops does NOT get invoice values, partner credit bands, or aged debt.
-- Utility cost is included because Ops is accountable for consumption.

create or replace view reporting.vw_ops_site_occupancy as
select s.site_code,
       s.name                                                   as site_name,
       s.region,
       count(u.unit_id)                                         as units_total,
       count(*) filter (where u.status = 'occupied')            as units_occupied,
       count(*) filter (where u.status = 'available')           as units_available,
       count(*) filter (where u.status = 'offline')             as units_offline,
       round(100.0 * count(*) filter (where u.status = 'occupied')
             / nullif(count(u.unit_id), 0), 1)                  as occupancy_pct,
       sum(u.floor_area_sqft) filter (where u.status = 'available')
                                                                as void_sqft,
       coalesce(sum(lic.monthly_fee_gbp), 0)                    as contracted_monthly_fee_gbp
from core.site s
join core.kitchen_unit u on u.site_id = s.site_id
left join lateral (
    select l.monthly_fee_gbp
    from core.licence_agreement l
    where l.unit_id = u.unit_id and l.status = 'active'
    limit 1
) lic on true
where s.closed_on is null
group by s.site_id, s.site_code, s.name, s.region;

create or replace view reporting.vw_ops_maintenance_load as
select s.site_code,
       t.category,
       t.priority,
       count(*)                                                  as tickets,
       count(*) filter (where t.status in ('open','in_progress')) as tickets_open,
       round(avg(extract(epoch from (t.resolved_on - t.raised_on)) / 3600.0)
             filter (where t.resolved_on is not null)::numeric, 1) as avg_hours_to_resolve,
       coalesce(sum(t.cost_gbp), 0)                              as spend_gbp
from core.maintenance_ticket t
join core.site s on s.site_id = t.site_id
group by s.site_code, t.category, t.priority;

-- NOTE: the unit count comes from a lateral subquery, NOT a join to
-- kitchen_unit. Joining would fan every utility reading out by the number of
-- units at the site and multiply the consumption and cost sums.
create or replace view reporting.vw_ops_utility_intensity as
select s.site_code,
       ur.utility,
       date_trunc('month', ur.period_start)::date               as period,
       sum(ur.consumption)                                       as consumption,
       max(ur.uom)                                               as uom,
       sum(ur.cost_gbp)                                          as cost_gbp,
       round(sum(ur.cost_gbp) / nullif(occ.units_occupied, 0), 2)
                                                                 as cost_per_occupied_unit_gbp
from core.utility_reading ur
join core.site s on s.site_id = ur.site_id
join lateral (
    select count(*) as units_occupied
    from core.kitchen_unit u
    where u.site_id = s.site_id and u.status = 'occupied'
) occ on true
group by s.site_code, ur.utility, 3, occ.units_occupied;

-- Compliance expiry: answers a question nobody can currently answer at all.
create or replace view reporting.vw_ops_compliance_expiry as
select s.site_code,
       u.unit_code,
       c.kind,
       c.issued_on,
       c.expires_on,
       (c.expires_on - current_date)                   as days_to_expiry,
       case
           when c.expires_on < current_date                then 'EXPIRED'
           when c.expires_on - current_date <= 30          then 'due_30d'
           when c.expires_on - current_date <= 90          then 'due_90d'
           else 'ok'
       end                                              as status,
       c.issued_by,
       c.document_url
from core.compliance_certificate c
join core.site s on s.site_id = c.site_id
left join core.kitchen_unit u on u.unit_id = c.unit_id;

-- Capital replacement pipeline, with straight-line depreciation derived.
create or replace view reporting.vw_ops_asset_replacement as
select s.site_code,
       a.category,
       count(*)                                                  as assets,
       sum(a.capex_gbp)                                          as capex_gbp,
       round(sum(a.capex_gbp / a.useful_life_months), 2)         as monthly_depreciation_gbp,
       count(*) filter (
           where a.replacement_due_on is not null
             and a.replacement_due_on <= current_date + 365)      as due_within_12m,
       sum(a.capex_gbp) filter (
           where a.replacement_due_on is not null
             and a.replacement_due_on <= current_date + 365)      as replacement_exposure_gbp
from core.asset a
join core.site s on s.site_id = a.site_id
where a.disposed_on is null
group by s.site_code, a.category;

-- =========================== 4. SALES / PARTNERSHIPS ========================
-- Sales sees overdue COUNTS as a churn signal but never the AMOUNTS.

create or replace view reporting.vw_sales_pipeline as
select e.stage,
       e.line_code                                      as business_line,
       e.source,
       s.region,
       count(*)                                          as enquiries,
       sum(e.units_requested)                            as units_requested,
       sum(e.expected_monthly_fee_gbp * e.units_requested) as pipeline_value_monthly_gbp,
       round(avg(current_date - e.received_on), 1)       as avg_age_days
from core.enquiry e
left join core.site s on s.site_id = e.target_site_id
where e.stage not in ('won','lost')
group by e.stage, e.line_code, e.source, s.region;

create or replace view reporting.vw_sales_conversion as
select date_trunc('month', e.received_on)::date          as cohort_month,
       e.source,
       count(*)                                          as enquiries,
       count(*) filter (where e.stage = 'won')           as won,
       count(*) filter (where e.stage = 'lost')          as lost,
       round(100.0 * count(*) filter (where e.stage = 'won')
             / nullif(count(*), 0), 1)                   as win_rate_pct,
       round(avg(e.closed_on - e.received_on)
             filter (where e.stage = 'won'), 1)          as avg_days_to_win
from core.enquiry e
group by 1, 2;

-- Grain is ONE ROW PER ACTIVE LICENCE, so licence_id must be in the group by.
create or replace view reporting.vw_sales_churn_risk as
select l.licence_id,
       bp.trading_name,
       bp.brand_group,
       bp.credit_band,
       bp.account_manager,
       s.site_code,
       l.end_date,
       (l.end_date - current_date)                       as days_to_expiry,
       l.monthly_fee_gbp,
       count(*) filter (where i.status = 'overdue')      as overdue_invoices,
       case
           when bp.credit_band in ('C','D')
             or count(*) filter (where i.status = 'overdue') >= 2 then 'high'
           when l.end_date is not null
            and l.end_date - current_date <= 90               then 'medium'
           else 'low'
       end                                               as risk_flag
from core.licence_agreement l
join core.brand_partner bp on bp.partner_id = l.partner_id
join core.kitchen_unit  u  on u.unit_id     = l.unit_id
join core.site          s  on s.site_id     = u.site_id
left join core.invoice  i  on i.licence_id  = l.licence_id
where l.status = 'active'
group by l.licence_id, bp.trading_name, bp.brand_group, bp.credit_band,
         bp.account_manager, s.site_code, l.end_date, l.monthly_fee_gbp;

-- ===================== 5. SCORECARD (07e) — all departments =================
create or replace view reporting.vw_scorecard as
select s.subject_type,
       s.display_name                                        as subject,
       s.parent_id,
       m.metric_code,
       m.name                                                as metric,
       m.unit,
       t.period_start,
       a.actual_value,
       t.target_value,
       t.owner,
       a.actual_value - t.target_value                        as variance,
       case
           when a.actual_value is null                                then 'no_data'
           when m.direction = 'higher_is_better' and a.actual_value >= t.target_value
             or m.direction = 'lower_is_better'  and a.actual_value <= t.target_value
                                                                      then 'green'
           when t.threshold_amber is not null
            and (m.direction = 'higher_is_better' and a.actual_value >= t.threshold_amber
              or m.direction = 'lower_is_better'  and a.actual_value <= t.threshold_amber)
                                                                      then 'amber'
           else 'red'
       end                                                    as rag,
       rc.due_on                                              as review_due_on,
       rc.status                                              as review_status
from core.metric_target t
join core.metric            m  on m.metric_code = t.metric_code
join core.scorecard_subject s  on s.subject_id  = t.subject_id
left join core.metric_actual a
       on a.metric_code = t.metric_code
      and a.subject_id  = t.subject_id
      and a.period_start = t.period_start
left join core.review_cycle rc
       on rc.subject_id  = t.subject_id
      and rc.period_start = t.period_start
where m.is_active and s.is_active;

-- ================= 6. DATA-QUALITY EXCEPTIONS — reconciliation ==============
create or replace view reporting.vw_data_exceptions as
select 'invoice_without_payment_past_due' as exception_type, count(*) as cases
from core.invoice i
where i.status not in ('paid','written_off') and i.due_on < current_date - 90
union all
select 'unit_never_commissioned', count(*)
from core.kitchen_unit where commissioned_on > current_date
union all
select 'certificate_expired', count(*)
from core.compliance_certificate where expires_on < current_date
union all
select 'asset_past_replacement_date', count(*)
from core.asset where replacement_due_on < current_date and disposed_on is null
union all
select 'onboarding_step_overdue', count(*)
from core.onboarding_step
where completed_on is null and due_on is not null and due_on < current_date
union all
select 'site_without_head_lease', count(*)
from core.site s
where s.closed_on is null
  and not exists (select 1 from core.head_lease hl where hl.property_id = s.property_id);
