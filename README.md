# Unified Data Platform — demo

**One database. Three departments. Each sees only its own views — enforced by
Postgres roles and grants, not by application code.**

> **Everything here is illustrative.** Every table, column, threshold, name and
> number is synthetic and invented. The structure is a *proposal* built on
> stated assumptions — not a description of any real company's systems or data.

## What it demonstrates

- **A system of record, not just reporting.** Capture-layer tables (billing
  runs, onboarding steps, documents, spend approvals) create the data;
  reporting falls out of it. A missed `billing_activated` onboarding step
  becomes an exception on the revenue-assurance screen a month later — the
  loop closes with a named owner.
- **Revenue assurance** — the screen that finds money. Six exception classes
  (occupied-but-unlicensed units, unbilled licences, underbilling, expired
  licences still active, missed rent reviews, unrecharged utilities) computed
  from the data, with an annualised headline figure.
- **The access boundary lives in the database.** Definer's-rights views over a
  locked-down `core` schema; per-department roles with view grants; row-level
  security (with `FORCE`, and view ownership separated from table ownership —
  the two details that make RLS real through views). A pytest suite connects
  as each role and proves the boundary: `tests/test_permissions.py`.
- **Finance-grade discipline.** Period locking by trigger (closed months
  reject writes; corrections book as dated adjustments), an append-only audit
  log, nominal codes and VAT codes on every money line, billed-vs-earned
  recognition dates, GiST exclusion constraints that make double-letting a
  unit *impossible* rather than discouraged.
- **A "How it works" tab that shows the enforcement rather than claiming it** —
  the role x view grant matrix queried live from `has_table_privilege`, the
  audit trail filling up as writes happen, and the agent's own query log.
- **An AI query agent that cannot leak.** Natural language → SQL over the
  reporting views, executed on a connection opened as the asking user's own
  Postgres role. The grants are the security boundary, not the prompt. Every
  answer shows its SQL; every question is logged. Ships with an eval harness
  whose permission and injection gates must pass 100%.

## Run it

Prereqs: Docker (or colima), Python 3.12+, Node 20+.

```bash
docker compose up -d                       # Postgres 16 + pgvector on :5433
python -m venv .venv
.venv/bin/pip install "psycopg[binary]" psycopg_pool faker pytest pyyaml anthropic fastapi "uvicorn[standard]"

.venv/bin/python tools/db/migrate.py       # idempotent DDL
.venv/bin/python tools/db/seed.py          # deterministic synthetic data
.venv/bin/python tools/quality/reconcile.py  # the numbers tie, to the penny
.venv/bin/python tools/db/verify_grants.py   # the grant matrix, printed
.venv/bin/python -m pytest tests/          # 44 tests incl. the permission proof

.venv/bin/python -m uvicorn api.main:app --port 8000   # API
cd web && npm install && npm run dev                    # UI on :3000
```

Open http://localhost:3000, pick a persona, and switch departments in the
header — the same app changes shape because the database says so. Each
department gets an **Overview** of charts (trend lines, rankings, a compliance
status donut) computed client-side from the same granted views, polled every
15 s. Tables sort on click, filter, and export to CSV.

### Make it visibly live

```bash
.venv/bin/python tools/db/simulate.py --interval 5
```

A clearly-labelled demo simulator writes plausible events (payments arriving,
food orders, tickets, enquiries — and the occasional billing catch-up that
makes the leakage headline drop) into the **open** accounting period only;
the period-lock trigger rejects anything historical. Every write lands in the
audit log attributed to `simulator@demo.local`.

### The AI agent (optional — needs a key)

```bash
cp .env.example .env    # add ANTHROPIC_API_KEY
export ANTHROPIC_API_KEY=...
.venv/bin/python tools/agent/ask.py --role dept_finance \
  --question "Which sites were over budget on utilities last quarter?"

# The eval harness — permission + injection gates must pass 100% to ship:
.venv/bin/python tools/agent/eval.py --suite evals/agent_suite.yaml --runs 3
```

The "Ask the data" tab in the web app uses the same code path — same per-role
connection pools, so the step-3 grants constrain the model too.

## Layout

```
db/ddl/          idempotent SQL: schema, views, roles/grants/RLS, triggers
tools/           deterministic CLIs (flag + exit-code contract)
  db/            migrate, seed, verify_grants
  quality/       reconcile — site P&L + central overhead ties to the ledger
  agent/         ask (the query agent), catalogue, eval, eval_compare
workflows/       SOPs: month_end_close, onboard_partner, run_billing
api/             FastAPI — per-role pools, bearer-token stub
web/             Next.js — dashboards + department switch + agent panel
evals/           the agent eval suite (permission/injection cases first)
tests/           pytest — the permission boundary, period locking, audit
```

## Design decisions worth asking about

- `numeric` never `float` for money; UUID primary keys; invoiced revenue and
  collected cash never conflated.
- `expense.site_id` is nullable **on purpose**: null = central overhead, never
  silently allocated to a site. Site P&L is contribution margin and says so.
- Views run with the definer's rights; the reporting views are owned by a role
  that does **not** own `core`, and RLS is `FORCE`d — without both, the site
  scoping would silently do nothing for queries arriving through the views.
- Depreciation is derived (`capex / useful_life_months`), never stored.
- `unique nulls not distinct` on budget lines — two central budget rows for
  the same period and measure must collide (Postgres 15+).
- One posted billing run per period, by partial unique index.
- Mirror columns (`source_system`, `external_id`, `synced_at`) on invoice,
  payment, partner and enquiry: the design integrates an accounting system and
  a CRM as sources of truth — mirror, don't replace.
- The scorecard's `employee` grain is modelled but deliberately seeded with
  nothing: personal performance data needs a lawful basis and its own access
  control before it needs a schema.
