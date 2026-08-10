# SOP — Run the live demo

Every step names the tool it calls. Total setup time from cold: ~2 minutes.

## Start everything

```bash
docker compose up -d                                  # Postgres
.venv/bin/python tools/db/migrate.py                  # idempotent — safe to re-run
.venv/bin/python tools/db/seed.py                     # deterministic reset
.venv/bin/python -m uvicorn api.main:app --port 8000  # API
cd web && npm run build && npx next start -p 3000     # UI (or npm run dev)
export ANTHROPIC_API_KEY=...                          # for the agent tab

# The live feel — plausible events every few seconds, clearly labelled:
.venv/bin/python tools/db/simulate.py --interval 5
```

Re-seeding resets the world to the same deterministic state; the simulator
only ever writes into the OPEN accounting period (the period-lock trigger
rejects anything else — worth saying out loud).

## The talk track, in order

1. **Open as Finance Director.** Revenue assurance is the landing screen:
   "here is money currently being lost, computed from the data — £X annualised."
2. **Overview tab.** Invoiced vs collected trend; leakage by class. Payments
   are arriving live (the simulator) — the collected line and tiles tick.
3. **Wait for the catch-up moment** (or trigger it: the simulator invoices an
   unbilled licence roughly once a minute). The leakage headline DROPS in
   front of the audience: "found, then fixed, and it stays fixed because the
   billing run generates from licences."
4. **Switch persona** in the header — Ops, then the London manager (same
   screens, 12 sites: row-level security), then Sales. "Same database, same
   numbers. Nobody sees anyone else's — enforced by Postgres grants, so it
   stays true even if someone writes a bad query."
5. **Ask the data.** One finance question; show the SQL under the answer.
   Then switch to Ops and ask a finance question — refusal, because the
   database said no, not the prompt.
6. **For engineers:** `python -m pytest tests/` and
   `python tools/db/verify_grants.py` on screen; the audit log showing the
   simulator's writes attributed to `simulator@demo.local`.

## Fallback

Screenshots live in `.tmp/screenshots/` (regenerate with the Playwright
drive script). Record a 3-minute walkthrough in advance. Never demo without
the fallback.
