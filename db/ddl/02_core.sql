-- ============================================================================
-- UNIFIED DATA PLATFORM — CORE SCHEMA
-- Sections 07 / 07b / 07c / 07d / 07e of the brief, in dependency order.
-- All data synthetic. Structure is a proposal, not a description of any client.
-- `core` holds truth; nobody outside the loader ever reads it directly.
-- ============================================================================

-- ---------------------------------------------------------------- dimensions
create table if not exists core.business_line (
    line_code   text primary key,                      -- 'CORE','PICNIC','PROFOODS'
    name        text not null,
    launched_on date
);

create table if not exists core.department (
    dept_code text primary key,                        -- 'FINANCE','OPS','SALES'
    name      text not null
);

-- ------------------------------------------------------ legal + property layer
-- Created before core.site: a site sits inside a property held by an entity,
-- and the head lease drives the largest cost line in the business.
create table if not exists core.legal_entity (
    entity_id          uuid primary key default gen_random_uuid(),
    name               text not null,
    companies_house_no text,
    parent_name        text,
    vat_number         text
);

create table if not exists core.property (
    property_id   uuid primary key default gen_random_uuid(),
    name          text not null,
    address_line1 text not null,
    city          text not null,
    postcode      text not null,
    tenure        text not null check (tenure in ('freehold','leasehold')),
    acquired_on   date,
    disposed_on   date
);

create table if not exists core.head_lease (
    lease_id            uuid primary key default gen_random_uuid(),
    property_id         uuid not null references core.property(property_id),
    landlord            text not null,
    start_date          date not null,
    expiry_date         date not null,
    passing_rent_gbp    numeric(12,2) not null,
    service_charge_gbp  numeric(12,2) not null default 0,
    review_type         text check (review_type in
        ('upward_only','open_market','rpi','fixed','none')),
    next_review_on      date,
    break_date          date,
    break_notice_days   integer,
    dilapidations_provision_gbp numeric(12,2),
    constraint head_lease_dates check (expiry_date > start_date)
);
create index if not exists head_lease_expiry_idx on core.head_lease (expiry_date);

-- ------------------------------------------- accounting reference (07d) first,
-- so revenue and cost tables can carry nominal/VAT codes from day one.
create table if not exists core.nominal_account (
    nominal_code text primary key,
    name         text not null,
    account_type text not null check (account_type in
        ('revenue','cost_of_sales','overhead','asset','liability','equity')),
    vat_code     text
);

create table if not exists core.vat_rate (
    vat_code   text primary key,       -- 'S' standard, 'Z' zero, 'E' exempt, 'RC' reverse charge
    name       text not null,
    rate_pct   numeric(5,2) not null,
    valid_from date not null
);

-- ------------------------------------------------------------- physical estate
create table if not exists core.site (
    site_id         uuid primary key default gen_random_uuid(),
    property_id     uuid not null references core.property(property_id),
    entity_id       uuid not null references core.legal_entity(entity_id),
    site_code       text not null unique,              -- 'LDN-BER-01'
    name            text not null,
    address_line1   text not null,
    city            text not null,
    postcode        text not null,
    region          text not null,                     -- 'London','South','North'
    opened_on       date not null,
    closed_on       date,
    floor_area_sqft integer not null check (floor_area_sqft > 0),
    constraint site_dates_ordered
        check (closed_on is null or closed_on >= opened_on)
);

create table if not exists core.kitchen_unit (
    unit_id          uuid primary key default gen_random_uuid(),
    site_id          uuid not null references core.site(site_id),
    unit_code        text not null,                    -- 'K-014'
    floor_area_sqft  integer not null check (floor_area_sqft > 0),
    extraction_class text not null,                    -- spec tier, drives the fee
    status           text not null
        check (status in ('available','occupied','offline')),
    commissioned_on  date not null,
    unique (site_id, unit_code)
);
create index if not exists kitchen_unit_site_status_idx
    on core.kitchen_unit (site_id, status);

-- ------------------------------------------------------------------ commercial
-- Mirror pattern: brand_partner / enquiry sync from the CRM, invoice / payment
-- from the ledger. Local read model only — never write back a field the source
-- system owns.
create table if not exists core.brand_partner (
    partner_id         uuid primary key default gen_random_uuid(),
    legal_name         text not null,
    trading_name       text not null,
    brand_group        text,                           -- multi-site operator parent
    companies_house_no text,
    credit_band        text check (credit_band in ('A','B','C','D')),
    onboarded_on       date not null,
    account_manager    text,
    source_system      text not null default 'internal'
        check (source_system in ('internal','xero','hubspot')),
    external_id        text,
    synced_at          timestamptz,
    unique (source_system, external_id)
);

create table if not exists core.licence_agreement (
    licence_id         uuid primary key default gen_random_uuid(),
    unit_id            uuid not null references core.kitchen_unit(unit_id),
    partner_id         uuid not null references core.brand_partner(partner_id),
    line_code          text not null references core.business_line(line_code),
    start_date         date not null,
    end_date           date,                           -- null = open ended
    monthly_fee_gbp    numeric(10,2) not null check (monthly_fee_gbp >= 0),
    deposit_gbp        numeric(10,2) not null default 0,
    notice_days        integer not null default 30,
    status             text not null
        check (status in ('active','ended','terminated')),
    termination_reason text,        -- 'insolvency','non_payment','relocation','planned_exit'
    utilities_included boolean not null default true,
    recharge_basis     text check (recharge_basis in
        ('none','submeter','floor_area_apportioned','fixed_uplift')),
    nominal_code       text references core.nominal_account(nominal_code),
    constraint licence_dates_ordered
        check (end_date is null or end_date >= start_date),
    -- A unit cannot be let to two partners over the same dates. Enforced by the
    -- database, not by application code.
    constraint licence_no_overlap
        exclude using gist (
            unit_id with =,
            daterange(start_date, coalesce(end_date, 'infinity'::date), '[)') with &&
        )
);
create index if not exists licence_partner_idx on core.licence_agreement (partner_id);
create index if not exists licence_unit_status_idx on core.licence_agreement (unit_id, status);

-- --------------------------------------------------------- billing run (07c)
-- If invoicing ~300 partners is manual today, generating it deterministically
-- from active licences is the single most legible digitisation win.
create table if not exists core.billing_run (
    run_id        uuid primary key default gen_random_uuid(),
    period_start  date not null,
    period_end    date not null,
    generated_at  timestamptz not null default now(),
    generated_by  text not null,
    status        text not null
        check (status in ('draft','approved','posted','cancelled')),
    invoice_count integer not null default 0,
    total_net_gbp numeric(14,2) not null default 0,
    notes         text
);

-- A period can have many draft runs but only ONE posted run.
create unique index if not exists billing_run_one_posted_per_period
    on core.billing_run (period_start, period_end)
    where status = 'posted';

-- --------------------------------------------------------------------- revenue
create table if not exists core.invoice (
    invoice_id        uuid primary key default gen_random_uuid(),
    invoice_no        text not null unique,
    licence_id        uuid not null references core.licence_agreement(licence_id),
    partner_id        uuid not null references core.brand_partner(partner_id),
    run_id            uuid references core.billing_run(run_id),  -- null = raised manually
    period_start      date not null,
    period_end        date not null,
    issued_on         date not null,
    due_on            date not null,
    net_gbp           numeric(10,2) not null,
    vat_gbp           numeric(10,2) not null default 0,
    vat_code          text references core.vat_rate(vat_code),
    recognition_start date,          -- billed ≠ earned; deferred revenue apportions here
    recognition_end   date,
    status            text not null
        check (status in ('issued','part_paid','paid','overdue','written_off')),
    source_system     text not null default 'internal'
        check (source_system in ('internal','xero','hubspot')),
    external_id       text,
    synced_at         timestamptz,
    constraint invoice_period_ordered check (period_end >= period_start),
    unique (source_system, external_id)
);
create index if not exists invoice_partner_status_idx on core.invoice (partner_id, status);
create index if not exists invoice_period_idx on core.invoice (period_start);

create table if not exists core.payment (
    payment_id    uuid primary key default gen_random_uuid(),
    invoice_id    uuid not null references core.invoice(invoice_id),
    received_on   date not null,
    amount_gbp    numeric(10,2) not null check (amount_gbp > 0),
    method        text not null check (method in ('bacs','card','direct_debit','other')),
    source_system text not null default 'internal'
        check (source_system in ('internal','xero','hubspot')),
    external_id   text,
    synced_at     timestamptz,
    unique (source_system, external_id)
);
create index if not exists payment_invoice_idx on core.payment (invoice_id);

-- ----------------------------------------------------------------------- costs
create table if not exists core.supplier (
    supplier_id uuid primary key default gen_random_uuid(),
    name        text not null,
    category    text not null
);

create table if not exists core.expense (
    expense_id   uuid primary key default gen_random_uuid(),
    site_id      uuid references core.site(site_id),   -- null = central overhead, by design
    supplier_id  uuid references core.supplier(supplier_id),
    line_code    text not null references core.business_line(line_code),
    category     text not null check (category in
        ('rent','business_rates','utilities','site_labour','maintenance',
         'insurance','cleaning','security','central_overhead')),
    period_start date not null,
    period_end   date not null,
    amount_gbp   numeric(12,2) not null,
    cost_centre  text not null,
    nominal_code text references core.nominal_account(nominal_code)
);
create index if not exists expense_site_period_idx on core.expense (site_id, period_start);

-- ------------------------------------------------------------------ operations
create table if not exists core.maintenance_ticket (
    ticket_id   uuid primary key default gen_random_uuid(),
    site_id     uuid not null references core.site(site_id),
    unit_id     uuid references core.kitchen_unit(unit_id),
    raised_on   timestamptz not null,
    category    text not null,   -- 'extraction','refrigeration','plumbing','electrical','fabric'
    priority    text not null check (priority in ('P1','P2','P3')),
    status      text not null check (status in ('open','in_progress','resolved','closed')),
    resolved_on timestamptz,
    cost_gbp    numeric(10,2),
    contractor  text,
    constraint ticket_resolved_after_raised
        check (resolved_on is null or resolved_on >= raised_on)
);
create index if not exists ticket_site_status_idx on core.maintenance_ticket (site_id, status);

create table if not exists core.utility_reading (
    reading_id   uuid primary key default gen_random_uuid(),
    site_id      uuid not null references core.site(site_id),
    utility      text not null check (utility in ('electricity','gas','water')),
    period_start date not null,
    period_end   date not null,
    consumption  numeric(12,2) not null,
    uom          text not null,                        -- 'kWh','m3'
    cost_gbp     numeric(10,2) not null
);
create index if not exists utility_site_period_idx on core.utility_reading (site_id, period_start);

create table if not exists core.site_staffing (
    staffing_id  uuid primary key default gen_random_uuid(),
    site_id      uuid not null references core.site(site_id),
    role         text not null,   -- 'site_manager','cleaner','security','maintenance'
    period_start date not null,
    period_end   date not null,
    fte          numeric(5,2) not null check (fte >= 0),
    cost_gbp     numeric(10,2) not null
);
create index if not exists staffing_site_period_idx on core.site_staffing (site_id, period_start);

-- -------------------------------------------------------------------- pipeline
create table if not exists core.enquiry (
    enquiry_id               uuid primary key default gen_random_uuid(),
    brand_name               text not null,
    partner_id               uuid references core.brand_partner(partner_id), -- set on win
    line_code                text not null references core.business_line(line_code),
    source                   text not null,   -- 'website','referral','broker','outbound'
    received_on              date not null,
    target_site_id           uuid references core.site(site_id),
    units_requested          integer not null default 1 check (units_requested > 0),
    stage                    text not null check (stage in
        ('new','qualified','viewing','proposal','won','lost')),
    owner                    text,
    expected_monthly_fee_gbp numeric(10,2),
    closed_on                date,
    lost_reason              text,
    source_system            text not null default 'internal'
        check (source_system in ('internal','xero','hubspot')),
    external_id              text,
    synced_at                timestamptz,
    unique (source_system, external_id)
);
create index if not exists enquiry_stage_idx on core.enquiry (stage, received_on);

-- ----------------------------------------- asset register (07b) — capex vs opex
create table if not exists core.asset (
    asset_id            uuid primary key default gen_random_uuid(),
    site_id             uuid not null references core.site(site_id),
    unit_id             uuid references core.kitchen_unit(unit_id),
    asset_tag           text not null unique,
    category            text not null check (category in
        ('extraction','refrigeration','cold_room','gas_interlock','fire_suppression',
         'grease_trap','hvac','electrical','fabric','other')),
    manufacturer        text,
    model               text,
    installed_on        date not null,
    capex_gbp           numeric(12,2) not null check (capex_gbp >= 0),
    useful_life_months  integer not null check (useful_life_months > 0),
    warranty_expires_on date,
    replacement_due_on  date,
    disposed_on         date
);
create index if not exists asset_site_category_idx on core.asset (site_id, category);
-- Depreciation is DERIVED, never stored: capex_gbp / useful_life_months per month.

-- ------------------------------------------------ statutory compliance (07b)
-- An expired cert is a closed kitchen and an insurance problem.
create table if not exists core.compliance_certificate (
    certificate_id uuid primary key default gen_random_uuid(),
    site_id        uuid not null references core.site(site_id),
    unit_id        uuid references core.kitchen_unit(unit_id),
    asset_id       uuid references core.asset(asset_id),
    kind           text not null check (kind in
        ('gas_safety','electrical_eicr','pat','fire_risk_assessment',
         'extraction_clean_tr19','food_premises_registration','food_hygiene_rating',
         'insurance','legionella','grease_trap_service')),
    issued_on      date not null,
    expires_on     date not null,
    issued_by      text,
    reference      text,
    document_url   text,
    constraint certificate_dates check (expires_on > issued_on)
);
create index if not exists certificate_expiry_idx on core.compliance_certificate (expires_on);

-- --------------------------- own-operated food (07b) — a structurally different P&L
create table if not exists core.operated_brand (
    brand_id    uuid primary key default gen_random_uuid(),
    line_code   text not null references core.business_line(line_code),
    name        text not null,
    launched_on date
);

create table if not exists core.sales_order (
    order_id                uuid primary key default gen_random_uuid(),
    brand_id                uuid not null references core.operated_brand(brand_id),
    site_id                 uuid not null references core.site(site_id),
    channel                 text not null check (channel in
        ('deliveroo','ubereats','justeat','direct_web','direct_phone','corporate')),
    placed_at               timestamptz not null,
    gross_gbp               numeric(10,2) not null,
    platform_commission_gbp numeric(10,2) not null default 0,
    discount_gbp            numeric(10,2) not null default 0,
    net_gbp                 numeric(10,2) not null,
    items                   integer not null check (items > 0),
    status                  text not null
        check (status in ('placed','fulfilled','cancelled','refunded'))
);
create index if not exists sales_order_site_placed_idx on core.sales_order (site_id, placed_at);

create table if not exists core.cogs_entry (
    cogs_id       uuid primary key default gen_random_uuid(),
    brand_id      uuid not null references core.operated_brand(brand_id),
    site_id       uuid not null references core.site(site_id),
    period_start  date not null,
    period_end    date not null,
    food_cost_gbp numeric(12,2) not null,
    packaging_gbp numeric(12,2) not null default 0,
    wastage_gbp   numeric(12,2) not null default 0
);

-- --------------------------------------------- budget vs actual (07b) — an FD's job
create table if not exists core.budget_line (
    budget_id    uuid primary key default gen_random_uuid(),
    site_id      uuid references core.site(site_id),   -- null = central
    line_code    text not null references core.business_line(line_code),
    period_start date not null,
    period_end   date not null,
    measure      text not null check (measure in
        ('revenue','rent','business_rates','utilities','site_labour','maintenance',
         'insurance','cleaning','security','central_overhead','occupancy_pct','headcount_fte')),
    budget_value numeric(14,2) not null,
    scenario     text not null default 'budget'
        check (scenario in ('budget','forecast','prior_year')),
    -- NULLS NOT DISTINCT is load-bearing: site_id is nullable for central lines,
    -- and under default NULL semantics two central budget rows for the same
    -- period and measure would BOTH be allowed. Postgres 15+.
    unique nulls not distinct (site_id, line_code, period_start, measure, scenario)
);

-- ------------------------------ occupancy over time (07b) — voids need history
-- kitchen_unit.status answers "what is empty right now"; this answers
-- "what were our void unit-days last quarter", which is the actual KPI.
create table if not exists core.unit_status_history (
    history_id uuid primary key default gen_random_uuid(),
    unit_id    uuid not null references core.kitchen_unit(unit_id),
    status     text not null check (status in ('available','occupied','offline')),
    valid_from date not null,
    valid_to   date,                                   -- null = current
    reason     text,
    constraint status_history_dates
        check (valid_to is null or valid_to > valid_from),
    constraint unit_status_no_overlap
        exclude using gist (
            unit_id with =,
            daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[)') with &&
        )
);

-- ------------------------------------------------------------ documents (07c)
create table if not exists core.document (
    document_id    uuid primary key default gen_random_uuid(),
    kind           text not null check (kind in
        ('licence','certificate','invoice','head_lease','insurance','id_check','other')),
    licence_id     uuid references core.licence_agreement(licence_id),
    certificate_id uuid references core.compliance_certificate(certificate_id),
    lease_id       uuid references core.head_lease(lease_id),
    partner_id     uuid references core.brand_partner(partner_id),
    site_id        uuid references core.site(site_id),
    filename       text not null,
    content_type   text not null,
    size_bytes     bigint not null check (size_bytes > 0),
    storage_key    text not null unique,      -- object storage; presigned URL on read
    uploaded_at    timestamptz not null default now(),
    uploaded_by    text not null,
    -- Every document must hang off at least one real thing.
    constraint document_has_a_parent check (
        num_nonnulls(licence_id, certificate_id, lease_id, partner_id, site_id) >= 1
    )
);

-- Chunked document text for hybrid retrieval (11a). Same role grants apply to
-- retrieval as to SQL, so section 09 stays the single security boundary.
create table if not exists core.document_chunk (
    chunk_id    uuid primary key default gen_random_uuid(),
    document_id uuid not null references core.document(document_id) on delete cascade,
    chunk_index integer not null,
    content     text not null,
    page_number integer,
    embedding   vector(1024),
    unique (document_id, chunk_index)
);
create index if not exists document_chunk_embedding_idx on core.document_chunk
    using hnsw (embedding vector_cosine_ops);

-- ------------------------------------------------- spend approval (07c)
-- Committed spend before it becomes an invoice; maintenance is the
-- uncontrolled line in a 550-kitchen estate.
create table if not exists core.spend_approval (
    approval_id    uuid primary key default gen_random_uuid(),
    ticket_id      uuid references core.maintenance_ticket(ticket_id),
    site_id        uuid not null references core.site(site_id),
    requested_by   text not null,
    requested_on   timestamptz not null default now(),
    amount_gbp     numeric(12,2) not null check (amount_gbp > 0),
    threshold_band text not null,      -- drives who must sign: site / ops / FD
    status         text not null check (status in ('pending','approved','rejected')),
    decided_by     text,
    decided_on     timestamptz,
    constraint decision_is_complete check (
        (status = 'pending' and decided_by is null and decided_on is null)
        or (status <> 'pending' and decided_by is not null and decided_on is not null)
    )
);

-- --------------------------------------- onboarding (07c) — where data is born
create table if not exists core.onboarding_case (
    case_id      uuid primary key default gen_random_uuid(),
    enquiry_id   uuid references core.enquiry(enquiry_id),
    partner_id   uuid not null references core.brand_partner(partner_id),
    unit_id      uuid references core.kitchen_unit(unit_id),
    licence_id   uuid references core.licence_agreement(licence_id),
    opened_on    date not null,
    completed_on date,
    status       text not null
        check (status in ('open','blocked','completed','abandoned'))
);

create table if not exists core.onboarding_step (
    step_id      uuid primary key default gen_random_uuid(),
    case_id      uuid not null references core.onboarding_case(case_id),
    step         text not null check (step in
        ('credit_check','licence_signed','deposit_received','id_verified',
         'keys_issued','food_registration','billing_activated')),
    owner_dept   text not null references core.department(dept_code),
    due_on       date,
    completed_on date,
    unique (case_id, step)
);

-- ------------------------------------------------ period locking + audit (07d)
create table if not exists core.accounting_period (
    period_start date primary key,
    period_end   date not null,
    status       text not null check (status in ('open','closed','locked')),
    closed_on    timestamptz,
    closed_by    text
);

create table if not exists core.period_adjustment (
    adjustment_id   uuid primary key default gen_random_uuid(),
    site_id         uuid references core.site(site_id),
    original_period date not null,
    booked_period   date not null,
    nominal_code    text not null,
    amount_gbp      numeric(14,2) not null,
    reason          text not null,
    raised_by       text not null,
    raised_on       timestamptz not null default now()
);

create table if not exists core.audit_log (
    audit_id   bigserial primary key,
    table_name text not null,
    row_id     uuid not null,
    action     text not null check (action in ('insert','update','delete')),
    changed_by text not null,          -- from current_setting('app.user_email')
    changed_at timestamptz not null default now(),
    old_values jsonb,
    new_values jsonb
);
create index if not exists audit_log_row_idx
    on core.audit_log (table_name, row_id, changed_at desc);

-- --------------------------------------------- performance management (07e)
-- Reporting says what happened; this says what was supposed to happen, who
-- owns it, and when it gets reviewed. Generic by design: a metric is a metric
-- whether it measures a site, a brand, a department or a person.
create table if not exists core.metric (
    metric_code    text primary key,            -- 'occupancy_pct', 'labour_pct_revenue'
    name           text not null,
    description    text not null,               -- plain English, shown in the UI
    unit           text not null check (unit in ('gbp','pct','count','days','ratio')),
    direction      text not null check (direction in ('higher_is_better','lower_is_better')),
    grain          text not null check (grain in
        ('company','entity','business_line','region','site','unit','brand','department','employee')),
    cadence        text not null check (cadence in ('daily','weekly','monthly','quarterly')),
    source_view    text not null,               -- reporting.vw_… that computes it
    source_column  text not null,
    is_active      boolean not null default true
);

create table if not exists core.scorecard_subject (
    subject_id   uuid primary key default gen_random_uuid(),
    subject_type text not null check (subject_type in
        ('company','entity','business_line','region','site','brand','department','employee')),
    subject_ref  text not null,                 -- site_code, dept_code, employee ref…
    display_name text not null,
    parent_id    uuid references core.scorecard_subject(subject_id),   -- board → region → site
    is_active    boolean not null default true,
    unique (subject_type, subject_ref)
);

create table if not exists core.metric_target (
    target_id    uuid primary key default gen_random_uuid(),
    metric_code  text not null references core.metric(metric_code),
    subject_id   uuid not null references core.scorecard_subject(subject_id),
    period_start date not null,
    period_end   date not null,
    target_value numeric(14,4) not null,
    stretch_value numeric(14,4),
    threshold_amber numeric(14,4),              -- RAG banding
    threshold_red   numeric(14,4),
    owner        text not null,                 -- a NAMED person, never a team
    set_by       text not null,
    set_on       timestamptz not null default now(),
    unique (metric_code, subject_id, period_start)
);

-- Once a period's actual is taken, it is frozen — same discipline as period
-- locking. A scorecard that silently restates last month is worthless.
create table if not exists core.metric_actual (
    actual_id    uuid primary key default gen_random_uuid(),
    metric_code  text not null references core.metric(metric_code),
    subject_id   uuid not null references core.scorecard_subject(subject_id),
    period_start date not null,
    period_end   date not null,
    actual_value numeric(14,4) not null,
    captured_at  timestamptz not null default now(),
    unique (metric_code, subject_id, period_start)
);

create table if not exists core.review_cycle (
    cycle_id     uuid primary key default gen_random_uuid(),
    subject_id   uuid not null references core.scorecard_subject(subject_id),
    period_start date not null,
    period_end   date not null,
    due_on       date not null,
    held_on      date,
    chaired_by   text,
    status       text not null check (status in ('scheduled','held','missed','cancelled')),
    notes        text,
    unique (subject_id, period_start)
);

create table if not exists core.review_action (
    action_id   uuid primary key default gen_random_uuid(),
    cycle_id    uuid not null references core.review_cycle(cycle_id),
    metric_code text references core.metric(metric_code),
    description text not null,
    owner       text not null,
    due_on      date not null,
    completed_on date,
    status      text not null check (status in ('open','done','dropped'))
);

-- ----------------------------------------------------------------- access model
create table if not exists core.app_user (
    user_id    uuid primary key default gen_random_uuid(),
    email      citext not null unique,
    full_name  text not null,
    dept_code  text not null references core.department(dept_code),
    site_scope uuid[],                        -- null or empty = all sites
    is_active  boolean not null default true
);

-- -------------------------------------------------- agent query log (11)
-- Every question, the generated SQL, the row count, and the role. When
-- somebody disputes a number in three months, this table is the answer.
create table if not exists core.agent_query_log (
    log_id      uuid primary key default gen_random_uuid(),
    asked_at    timestamptz not null default now(),
    role_name   text not null,
    user_email  text,
    question    text not null,
    generated_sql text,
    row_count   integer,
    outcome     text not null check (outcome in ('answered','refused','errored')),
    duration_ms integer
);
