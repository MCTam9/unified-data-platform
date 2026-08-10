-- ============================================================================
-- UNIFIED DATA PLATFORM — ACCESS MODEL (section 09). The actual punchline.
-- One database, three departments, enforced by Postgres grants — not by an
-- `if` in a route handler.
-- ============================================================================

-- Nobody touches core. Ever.
revoke all on all tables in schema core from public;
revoke all on schema core from public;

-- Department roles. LOGIN so the demo, the tests and the API can connect as
-- them directly — the grants below are the security boundary the AI agent
-- inherits too.
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'dept_finance') then
        create role dept_finance login password 'finance_dev';
    end if;
    if not exists (select 1 from pg_roles where rolname = 'dept_ops') then
        create role dept_ops login password 'ops_dev';
    end if;
    if not exists (select 1 from pg_roles where rolname = 'dept_sales') then
        create role dept_sales login password 'sales_dev';
    end if;
    -- Owns the reporting views but NOT core. This is what makes RLS real for
    -- queries arriving through the views: a table owner bypasses RLS unless
    -- forced, and a non-materialised view reads core AS ITS OWNER.
    if not exists (select 1 from pg_roles where rolname = 'reporting_owner') then
        create role reporting_owner nologin;
    end if;
end $$;

-- reporting_owner can read core (the views need it); departments cannot.
grant usage on schema core to reporting_owner;
grant select on all tables in schema core to reporting_owner;
alter default privileges in schema core grant select on tables to reporting_owner;

-- The reporting views run with the definer's (owner's) rights, so the
-- department roles read reporting.* without ever being granted core.
alter view reporting.vw_finance_site_pnl          owner to reporting_owner;
alter view reporting.vw_finance_aged_debt         owner to reporting_owner;
alter view reporting.vw_finance_budget_variance   owner to reporting_owner;
alter view reporting.vw_finance_lease_exposure    owner to reporting_owner;
alter view reporting.vw_finance_operated_brand_pnl owner to reporting_owner;
alter view reporting.vw_finance_revenue_assurance owner to reporting_owner;
alter view reporting.vw_finance_leakage_summary   owner to reporting_owner;
alter view reporting.vw_ops_site_occupancy        owner to reporting_owner;
alter view reporting.vw_ops_maintenance_load      owner to reporting_owner;
alter view reporting.vw_ops_utility_intensity     owner to reporting_owner;
alter view reporting.vw_ops_compliance_expiry     owner to reporting_owner;
alter view reporting.vw_ops_asset_replacement     owner to reporting_owner;
alter view reporting.vw_sales_pipeline            owner to reporting_owner;
alter view reporting.vw_sales_conversion          owner to reporting_owner;
alter view reporting.vw_sales_churn_risk          owner to reporting_owner;
alter view reporting.vw_scorecard                 owner to reporting_owner;
alter view reporting.vw_data_exceptions           owner to reporting_owner;

grant usage on schema reporting to dept_finance, dept_ops, dept_sales;

-- Finance: money, budget, leases, leakage.
grant select on reporting.vw_finance_site_pnl,
                reporting.vw_finance_aged_debt,
                reporting.vw_finance_budget_variance,
                reporting.vw_finance_lease_exposure,
                reporting.vw_finance_operated_brand_pnl,
                reporting.vw_finance_revenue_assurance,
                reporting.vw_finance_leakage_summary    to dept_finance;

-- Ops: occupancy, maintenance, utilities (cost included — Ops is accountable
-- for consumption), compliance, assets. No invoice values, no credit bands.
grant select on reporting.vw_ops_site_occupancy,
                reporting.vw_ops_maintenance_load,
                reporting.vw_ops_utility_intensity,
                reporting.vw_ops_compliance_expiry,
                reporting.vw_ops_asset_replacement      to dept_ops;

-- Sales: pipeline, conversion, churn risk (overdue counts, never amounts).
grant select on reporting.vw_sales_pipeline,
                reporting.vw_sales_conversion,
                reporting.vw_sales_churn_risk           to dept_sales;

-- Scorecard is the shared performance layer; data exceptions go to Ops and
-- Finance (the two owners of reconciliation).
grant select on reporting.vw_scorecard to dept_finance, dept_ops, dept_sales;
grant select on reporting.vw_data_exceptions to dept_finance, dept_ops;

-- ------------------------------------------------------------- row-level security
-- Scope a regional manager to their own sites via a session variable the API
-- sets per request (inside the transaction, reset on connection release).
alter table core.site enable row level security;

drop policy if exists site_scope_policy on core.site;
create policy site_scope_policy on core.site
    using (
        current_setting('app.site_scope', true) is null
        or current_setting('app.site_scope', true) = ''
        or site_id = any (string_to_array(current_setting('app.site_scope', true), ',')::uuid[])
    );

-- FORCE is the load-bearing word: without it, a table owner bypasses RLS, and
-- non-materialised views read core AS THEIR OWNER — so if one role owned both
-- core.site and the views, the policy would silently do nothing for queries
-- arriving through reporting.*. Here the views are owned by reporting_owner
-- (not the table owner), and FORCE covers the remaining hole.
alter table core.site force row level security;
