-- ============================================================================
-- THE CATALOGUE — what each view and column MEANS, defined once
--
-- An object name is a developer concern; a business label is a presentation
-- concern. Keeping both in the database means the app, the BI tool and the AI
-- agent cannot drift from each other — and nobody has to click a description
-- into a BI tool where it lives outside version control.
--
-- Postgres comments are the natural home for prose: visible in psql (\d+),
-- carried into Metabase on schema sync. Display names, department and tab
-- order have no native slot, so they live in one small table beside them.
--
-- Both sit in `core`, not `reporting`: this is metadata about the platform,
-- not business data, and keeping it out of `reporting` means the BI tool's
-- per-role connections still discover exactly the granted business views.
-- The three consumers (API, agent, BI setup) all read it over an admin
-- connection, which is what they already use for metadata.
-- ============================================================================

create table if not exists core.view_catalogue (
    view_name    text primary key,
    display_name text not null,           -- what a business user should see
    department   text not null check (department in
                     ('FINANCE', 'OPS', 'SALES', 'SHARED')),
    sort_order   integer not null default 100
);

insert into core.view_catalogue (view_name, display_name, department, sort_order) values
    ('vw_finance_revenue_assurance',  'Revenue assurance',    'FINANCE', 10),
    ('vw_finance_site_pnl',           'Site P&L',             'FINANCE', 30),
    ('vw_finance_budget_variance',    'Budget variance',      'FINANCE', 40),
    ('vw_finance_aged_debt',          'Aged debt',            'FINANCE', 50),
    ('vw_finance_lease_exposure',     'Head-lease exposure',  'FINANCE', 60),
    ('vw_finance_operated_brand_pnl', 'Operated food P&L',    'FINANCE', 70),
    ('vw_finance_leakage_summary',    'Leakage summary',      'FINANCE', 80),
    ('vw_ops_compliance_expiry',      'Compliance',           'OPS',     20),
    ('vw_ops_site_occupancy',         'Occupancy',            'OPS',     30),
    ('vw_ops_maintenance_load',       'Maintenance',          'OPS',     40),
    ('vw_ops_utility_intensity',      'Utilities',            'OPS',     50),
    ('vw_ops_asset_replacement',      'Assets',               'OPS',     60),
    ('vw_sales_pipeline',             'Pipeline',             'SALES',   20),
    ('vw_sales_conversion',           'Conversion',           'SALES',   30),
    ('vw_sales_churn_risk',           'Churn risk',           'SALES',   40),
    ('vw_scorecard',                  'Scorecard',            'SHARED',  90),
    ('vw_data_exceptions',            'Data quality',         'SHARED',  95)
on conflict (view_name) do update
    set display_name = excluded.display_name,
        department   = excluded.department,
        sort_order   = excluded.sort_order;

-- One row per column, carrying both the prose (from the comments below) and
-- the presentation hints derived from the naming convention the schema
-- already follows: *_gbp is money, *_pct is a percentage. The convention does
-- the work, so nothing is restated by hand.
create or replace view core.catalogue as
select vc.view_name,
       vc.display_name,
       vc.department,
       vc.sort_order,
       obj_description(c.oid, 'pg_class')            as description,
       a.attnum                                      as column_position,
       a.attname                                     as column_name,
       col_description(c.oid, a.attnum)              as column_description,
       -- Sentence case, not initcap: "Revenue invoiced", not "Revenue Invoiced".
       case
           when a.attname like '%\_gbp' then
               upper(left(replace(left(a.attname, length(a.attname) - 4), '_', ' '), 1))
               || substr(replace(left(a.attname, length(a.attname) - 4), '_', ' '), 2)
               || ' (£)'
           when a.attname like '%\_pct' then
               upper(left(replace(left(a.attname, length(a.attname) - 4), '_', ' '), 1))
               || substr(replace(left(a.attname, length(a.attname) - 4), '_', ' '), 2)
               || ' %'
           else upper(left(replace(a.attname, '_', ' '), 1))
                || substr(replace(a.attname, '_', ' '), 2)
       end                                           as column_display_name,
       case when a.attname like '%\_gbp' then 'currency_gbp' end
                                                     as column_semantic
from core.view_catalogue vc
join pg_class c      on c.relname = vc.view_name
join pg_namespace n  on n.oid = c.relnamespace and n.nspname = 'reporting'
join pg_attribute a  on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
order by vc.sort_order, a.attnum;

comment on table core.view_catalogue is
  'Business display name, owning department and tab order for each reporting '
  'view. The one place a human-readable label is defined.';
comment on view core.catalogue is
  'What every reporting view and column means: display names and department '
  'from core.view_catalogue, prose from the database comments, presentation '
  'hints derived from the *_gbp / *_pct naming convention. The single '
  'definition the app, the BI tool and the AI agent all read.';

-- ------------------------------------------------------------------ finance
comment on view reporting.vw_finance_site_pnl is
  'Monthly profit and loss per site and business line. Contribution margin: '
  'central overhead is deliberately excluded rather than silently allocated, '
  'so this is contribution, not fully-loaded profit.';
comment on column reporting.vw_finance_site_pnl.revenue_invoiced_gbp is
  'Licence fees invoiced in the period, net of VAT.';
comment on column reporting.vw_finance_site_pnl.revenue_collected_gbp is
  'Cash received against those invoices, including VAT. Never conflated with '
  'invoiced revenue — in a sector defined by tenant failure, conflating them '
  'is the mistake that destroys trust in the numbers.';
comment on column reporting.vw_finance_site_pnl.contribution_gbp is
  'Invoiced revenue less direct site costs. Excludes central overhead.';
comment on column reporting.vw_finance_site_pnl.labour_pct_of_revenue is
  'Site labour as a percentage of invoiced revenue.';

comment on view reporting.vw_finance_aged_debt is
  'Every unpaid invoice with its age. Outstanding is gross (net + VAT) less '
  'payments received. Debtor days and 90+ exposure come from here.';
comment on column reporting.vw_finance_aged_debt.outstanding_gbp is
  'Gross invoice value less payments received to date.';
comment on column reporting.vw_finance_aged_debt.ageing_bucket is
  'Days past the due date, bucketed: current, 1-30, 31-60, 61-90, 90+.';
comment on column reporting.vw_finance_aged_debt.credit_band is
  'Partner credit band A-D, worst is D. Feeds churn risk.';

comment on view reporting.vw_finance_budget_variance is
  'Actual against budget per site, month and measure. An FD wants the '
  'variance, not just the actual.';
comment on column reporting.vw_finance_budget_variance.variance_gbp is
  'Actual less budget. Positive is over budget on a cost, ahead on revenue.';

comment on view reporting.vw_finance_lease_exposure is
  'Head-lease commitments per property: passing rent, expiry, break dates and '
  'rent-review dates. Rent is the largest cost line and its structure drives '
  'the forward risk.';
comment on column reporting.vw_finance_lease_exposure.dilapidations_provision_gbp is
  'Provision held for making good at lease end.';

comment on view reporting.vw_finance_operated_brand_pnl is
  'Own-operated food margin: gross sales, delivery-platform commission and '
  'cost of sales. Structurally different from a flat licence fee, so it is '
  'kept apart from the site P&L rather than distorting it.';
comment on column reporting.vw_finance_operated_brand_pnl.commission_pct_of_gross is
  'Delivery-platform commission as a percentage of gross sales.';

comment on view reporting.vw_finance_revenue_assurance is
  'Exception list: revenue earned but not billed. Occupied units with no '
  'licence, active licences never invoiced this period, invoices below the '
  'contracted fee, licences past their end date, missed rent reviews and '
  'unrecharged utilities. This is the screen that finds money.';
comment on column reporting.vw_finance_revenue_assurance.gap_gbp is
  'Monthly amount at stake for this exception, where it can be quantified.';
comment on column reporting.vw_finance_revenue_assurance.exception_type is
  'Which class of leak this row represents.';

comment on view reporting.vw_finance_leakage_summary is
  'Revenue-assurance exceptions aggregated by class, with the monthly gap '
  'annualised. The annualised figure recurs until the billing process changes.';
comment on column reporting.vw_finance_leakage_summary.annualised_gap_gbp is
  'Monthly gap multiplied by twelve.';

-- ----------------------------------------------------------------- operations
comment on view reporting.vw_ops_site_occupancy is
  'Current unit status per site: occupied, available or offline, with '
  'occupancy percentage and the contracted fee at risk. A unit is either '
  'earning or bleeding.';
comment on column reporting.vw_ops_site_occupancy.occupancy_pct is
  'Occupied units as a percentage of total units at the site.';
comment on column reporting.vw_ops_site_occupancy.void_sqft is
  'Floor area sitting empty.';

comment on view reporting.vw_ops_maintenance_load is
  'Ticket volume, open count, average time to resolve and spend, by site, '
  'category and priority. Maintenance is the uncontrolled cost line in a '
  'large estate.';
comment on column reporting.vw_ops_maintenance_load.avg_hours_to_resolve is
  'Mean hours from raised to resolved, for resolved tickets only.';

comment on view reporting.vw_ops_utility_intensity is
  'Monthly consumption and cost per site and utility, plus cost per occupied '
  'unit. Kitchens are utility-intensive, so this is a top-three cost line.';
comment on column reporting.vw_ops_utility_intensity.cost_per_occupied_unit_gbp is
  'Utility cost divided by the number of occupied units at the site.';

comment on view reporting.vw_ops_compliance_expiry is
  'Certificate expiry per site and unit, flagged EXPIRED, due within 30 days, '
  'due within 90 days, or ok. An expired certificate is a closed kitchen and '
  'an insurance problem.';
comment on column reporting.vw_ops_compliance_expiry.days_to_expiry is
  'Days until expiry. Negative means already expired.';

comment on view reporting.vw_ops_asset_replacement is
  'Fit-out asset register by site and category, with straight-line '
  'depreciation derived rather than stored, and replacement exposure due '
  'within twelve months.';
comment on column reporting.vw_ops_asset_replacement.monthly_depreciation_gbp is
  'Derived as capex divided by useful life in months. Never stored, so a '
  'revised useful life cannot leave a stale figure behind.';

-- --------------------------------------------------------------------- sales
comment on view reporting.vw_sales_pipeline is
  'Open enquiries by stage, source and region, with the expected monthly fee '
  'they represent.';
comment on column reporting.vw_sales_pipeline.pipeline_value_monthly_gbp is
  'Expected monthly licence fee across the enquiries in this group.';

comment on view reporting.vw_sales_conversion is
  'Monthly enquiry cohorts: how many were won, how many lost, the win rate '
  'and the average days to win.';

comment on view reporting.vw_sales_churn_risk is
  'One row per active licence: expiry, credit band, overdue invoice count and '
  'a risk flag. Overdue counts only — the amounts are Finance''s.';
comment on column reporting.vw_sales_churn_risk.risk_flag is
  'High when the credit band is C or D or two or more invoices are overdue; '
  'medium when the licence expires within 90 days.';

-- ----------------------------------------------------------------- shared
comment on view reporting.vw_scorecard is
  'Performance scorecard: actual against target for every metric and subject, '
  'with a RAG status, a named owner and the review date. Reporting says what '
  'happened; this says what was supposed to happen and who owns it.';
comment on column reporting.vw_scorecard.rag is
  'Red, amber or green against the target, honouring whether higher or lower '
  'is better for that metric.';
comment on column reporting.vw_scorecard.owner is
  'A named person. Never a team — that is the difference between a '
  'performance system and a wall of charts.';

comment on view reporting.vw_data_exceptions is
  'Reconciliation layer: counts of data-quality exceptions that should be '
  'zero. Each class routes to a named domain owner rather than a shared inbox.';
