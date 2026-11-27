# SOP — Self-service BI (Metabase)

## Why a BI tool at all, when there's already a dashboard

Two layers, two jobs, and saying which is which is the recommendation:

- **The custom app** earns its place where a *workflow* needs it — the
  revenue-assurance exception list, an approvals screen, a compliance tracker
  with document upload. Things people *do*.
- **The BI tool** earns its place everywhere someone just wants to slice a
  number they already have. A one-person data function should never maintain a
  bespoke charting framework; that is a maintenance trap that eats the role.

**Build the custom app for workflows, self-host a BI tool for exploration.**

## The design decision worth defending

Metabase does **not** connect as an admin. It gets **one connection per
department role** — `dept_finance`, `dept_ops`, `dept_sales` — so its schema
sync only ever discovers the views that role is granted:

| Connection | Connects as | Views discovered |
|---|---|---|
| Platform — Finance | `dept_finance` | 9 |
| Platform — Operations | `dept_ops` | 7 |
| Platform — Sales | `dept_sales` | 4 |

The BI tool's data model *is* the grant matrix. Group permissions on top are
belt and braces: if someone misconfigures them, Postgres still refuses.
`tests/test_metabase.py` asserts all of this, including the backstop — even
the Metabase **admin** gets `permission denied` running an ops query through
the Finance connection.

## Honesty note — do not overclaim

Metabase's row-level **data sandboxing is a paid feature**. On the open-source
edition the API answers `402 — the blocked permissions functionality is only
enabled if you have a premium token`. Two things to say, in this order:

1. The open-source equivalent used here is `view-data: legacy-no-self-service`
   plus `create-queries: no`, which keeps a group out of a connection.
2. **It doesn't matter**, because row scoping never depended on Metabase:
   RLS on `core.site` scopes rows underneath the connection, so a regional
   manager is limited by the database, not by the BI tool's licence tier.

## Start it

Needs ~2 GB for the Metabase JVM on top of Postgres. On colima:
`colima start --cpu 4 --memory 6`.

```bash
docker compose --profile bi up -d metabase   # port 3010 (3000-3002 are taken locally)
.venv/bin/python tools/bi/setup_metabase.py  # idempotent — safe to re-run
.venv/bin/python -m pytest tests/test_metabase.py -q
```

The tool creates the `metabase_app` application database (Postgres, not the
bundled H2 — H2 is explicitly not for production), completes first-run setup,
creates the three role connections, syncs them, creates a group and a demo
user per department, applies the permission graph, removes the bundled Sample
Database, and adds four starter questions plus a Finance dashboard.

| Login | Password |
|---|---|
| `admin@bi.local` | `MetabaseDemo123!` |
| `finance@bi.local` / `ops@bi.local` / `sales@bi.local` | `PlatformDemo123!` |

## Demo track (3 minutes)

1. **Sign in as admin → Databases.** Three connections, one per department.
   "Metabase never connects as an admin to the warehouse."
2. **Open the Finance connection's data model.** Nine views. Open Operations:
   seven, and none of them financial. "I didn't configure that list — it's
   what the Postgres role could see when Metabase introspected."
3. **Sign in as `finance@bi.local`.** One connection. Browse the data, open
   the Finance overview dashboard.
4. **Build a question live**, in the GUI, no SQL — *aged debt by ageing
   bucket*, group and visualise. This is the actual point for a non-technical
   audience: "your team answers this themselves, and never asks anyone."
5. **For the engineers:** run the native query
   `select * from reporting.vw_ops_site_occupancy limit 1` on the Finance
   connection — `permission denied`, even as admin. Then the honesty note
   above about sandboxing.

## How the custom app and the BI tool differ

They are not competitors, and saying which does what is the recommendation:

| | Custom app | Metabase |
|---|---|---|
| Ad-hoc questions by non-technical users | ✗ fixed screens | **✓ the whole point** |
| Users saving their own questions and dashboards | ✗ | **✓** |
| Scheduled email subscriptions, drill-through, pivots | ✗ | **✓** |
| A narrative order (revenue assurance first) | **✓** | ✗ |
| Honest framing baked in (net vs cash, partial periods) | **✓** | ✗ per question |
| **Taking an action** — "Bill this now" | **✓ only here** | ✗ structurally |
| The AI query agent | **✓** | ✗ |
| Showing the boundary itself ("How it works") | **✓** | ✗ |

The last four are the app's reason to exist. Everything above them is work a
BI tool does better than a bespoke front end ever will, which is why the
recommendation is to buy that half rather than build it.

Both read the same reporting views **and now the same catalogue**, so a screen
title, a column label and the agent's glossary cannot drift apart.
