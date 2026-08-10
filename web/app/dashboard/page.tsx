"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PERSONAS, fetchView, fetchViews, gbp } from "@/lib/api";
import { usePolled } from "@/lib/usePolled";
import { DataTable, Section, StatTile, TableSkeleton } from "@/components/ui";
import { FinanceOverview, OpsOverview, SalesOverview } from "@/components/Overview";
import { SystemPanel } from "@/components/System";
import { AgentPanel } from "@/components/AgentPanel";

const POLL_MS = 15000;

// Which views make up each department's screens, in display order. The list
// the user actually gets comes from /api/views (i.e. from Postgres grants) —
// this map only orders and titles what the database allows. Tabs whose view
// is a client-side composition need no grant of their own.
type Screen = { view: string; title: string; note?: string };
const OVERVIEW: Screen = { view: "overview", title: "Overview" };

const SCREENS: Record<string, Screen[]> = {
  FINANCE: [
    // Revenue assurance stays the landing tab — it is the demo's first screen.
    { view: "vw_finance_revenue_assurance", title: "Revenue assurance",
      note: "Occupied but unbilled, underbilled, expired-but-active — earned and not invoiced" },
    OVERVIEW,
    { view: "vw_finance_site_pnl", title: "Site P&L",
      note: "Contribution margin: central overhead is excluded, never silently allocated" },
    { view: "vw_finance_budget_variance", title: "Budget variance",
      note: "Actual against budget, per site and measure" },
    { view: "vw_finance_aged_debt", title: "Aged debt",
      note: "Outstanding gross (net + VAT) less payments received" },
    { view: "vw_finance_lease_exposure", title: "Head-lease exposure",
      note: "Passing rent, expiries, break dates and rent-review dates" },
    { view: "vw_finance_operated_brand_pnl", title: "Operated food P&L",
      note: "Own-operated food: platform commission and COGS, kept apart from licence revenue" },
    { view: "vw_scorecard", title: "Scorecard",
      note: "Target vs actual with a named owner and a review date" },
    { view: "vw_data_exceptions", title: "Data quality" },
  ],
  OPS: [
    OVERVIEW,
    { view: "vw_ops_compliance_expiry", title: "Compliance",
      note: "Certificate expiry across the estate — an expired cert is a closed kitchen" },
    { view: "vw_ops_site_occupancy", title: "Occupancy",
      note: "Current unit status per site" },
    { view: "vw_ops_maintenance_load", title: "Maintenance",
      note: "Ticket load, resolution time and spend by site and category" },
    { view: "vw_ops_utility_intensity", title: "Utilities",
      note: "Consumption and cost per site, and cost per occupied unit" },
    { view: "vw_ops_asset_replacement", title: "Assets",
      note: "Capex, derived depreciation and replacements due within 12 months" },
    { view: "vw_scorecard", title: "Scorecard" },
    { view: "vw_data_exceptions", title: "Data quality" },
  ],
  SALES: [
    OVERVIEW,
    { view: "vw_sales_pipeline", title: "Pipeline",
      note: "Open enquiries by stage, source and region" },
    { view: "vw_sales_conversion", title: "Conversion",
      note: "Monthly cohorts: win rate and days to win" },
    { view: "vw_sales_churn_risk", title: "Churn risk",
      note: "One row per active licence. Overdue counts only — amounts are Finance's" },
    { view: "vw_scorecard", title: "Scorecard" },
  ],
};

const ROLE_LABEL: Record<string, string> = {
  FINANCE: "dept_finance", OPS: "dept_ops", SALES: "dept_sales",
};

export default function Dashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [active, setActive] = useState<string>("");

  const persona = PERSONAS.find((p) => p.token === token);

  useEffect(() => {
    const t = localStorage.getItem("demo_token");
    if (!t) { router.replace("/"); return; }
    setToken(t);
  }, [router]);

  // What Postgres says this role can read (polled, so a grant change shows up).
  const grants = usePolled(`views:${token}`,
    () => (token ? fetchViews(token) : Promise.resolve(null)), 60000);
  const granted = grants.data?.views ?? [];

  const screens = useMemo(() => {
    if (!persona) return [];
    return SCREENS[persona.dept].filter(
      (s) => s.view === "overview" || granted.includes(s.view));
  }, [persona, granted]);

  useEffect(() => {
    const fixed = ["agent", "system"];
    if (screens.length && !fixed.includes(active)
        && !screens.some((s) => s.view === active)) {
      setActive(screens[0].view);
    }
  }, [screens, active]);

  // Finance headline tiles — only fetched when the role is granted the view.
  const summary = usePolled(`leakage:${token}`,
    () => (token && persona?.dept === "FINANCE"
      ? fetchView(token, "vw_finance_leakage_summary").then((r) => r.rows)
      : Promise.resolve([])), POLL_MS);

  // The active table's rows.
  const isTable = !!active && !["agent", "system", "overview"].includes(active);
  const table = usePolled(`view:${token}:${active}`,
    () => (token && isTable
      ? fetchView(token, active).then((r) => r.rows)
      : Promise.resolve(null)), POLL_MS);

  if (!token || !persona) return null;
  const screen = screens.find((s) => s.view === active);
  const summaryRows = summary.data ?? [];
  const annualisedGap = summaryRows.reduce(
    (a, r) => a + Number(r.annualised_gap_gbp ?? 0), 0);
  const cases = summaryRows.reduce((a, r) => a + Number(r.cases ?? 0), 0);
  const lastUpdated = table.lastUpdated ?? summary.lastUpdated ?? grants.lastUpdated;
  const refreshing = table.isRefreshing || summary.isRefreshing;

  function switchPersona(t: string) {
    localStorage.setItem("demo_token", t);
    setToken(t);
    setActive("");
  }

  // Every tab carries a border at all times — activation changes colour only,
  // never layout, so the bar cannot shift as you click along it.
  const tabClass = (selected: boolean) =>
    "shrink-0 rounded-lg border px-3 py-1.5 text-sm transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 " +
    (selected
      ? "border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 font-medium text-neutral-900 dark:text-neutral-50"
      : "border-transparent text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-900 hover:text-neutral-800 dark:hover:text-neutral-300");

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
              Unified Data Platform
            </h1>
            <span className="rounded-full bg-amber-100 dark:bg-amber-950 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:text-amber-200">
              synthetic data
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {persona.label}
            {" · connected as "}
            <code className="text-xs text-neutral-600 dark:text-neutral-400">
              {ROLE_LABEL[persona.dept]}
            </code>
            {persona.token === "demo-ops-london" && (
              <span className="text-neutral-400"> · scoped to London sites</span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-1.5">
            {PERSONAS.map((p) => (
              <button key={p.token} onClick={() => switchPersona(p.token)}
                className={
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 " +
                  (p.token === token
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-500")
                }>
                {p.label}
              </button>
            ))}
          </div>
          {lastUpdated && (
            <p className="flex items-center gap-1.5 text-[11px] text-neutral-400">
              <span className={`inline-block h-1.5 w-1.5 rounded-full transition-colors ${
                refreshing ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"}`} />
              live · updated {lastUpdated.toLocaleTimeString("en-GB")}
            </p>
          )}
        </div>
      </header>

      {persona.dept === "FINANCE" && summaryRows.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Annualised leakage" value={gbp(annualisedGap)} tone="bad"
            sub="computed from the data, not asserted" />
          <StatTile label="Open exceptions" value={String(cases)} tone="bad"
            sub={`across ${summaryRows.length} classes`} />
          <StatTile label="Biggest class"
            value={String(summaryRows[0]?.exception_type ?? "—").replaceAll("_", " ")}
            sub={`${gbp(Number(summaryRows[0]?.annualised_gap_gbp ?? 0))} a year`} />
          <StatTile label="Sites reporting" value="25" sub="one source of truth" />
        </div>
      )}

      {/* Wraps rather than scrolls: no tab is ever hidden mid-demo, and every
          tab already carries a border so wrapping can't shift on activation. */}
      <nav className="mt-6 flex flex-wrap items-center gap-1 border-b border-neutral-200 dark:border-neutral-800 pb-2"
        aria-label="Screens">
        {screens.map((s) => (
          <button key={s.view} onClick={() => setActive(s.view)}
            aria-current={active === s.view ? "page" : undefined}
            className={tabClass(active === s.view)}>
            {s.title}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-800" aria-hidden />
        <button onClick={() => setActive("agent")} className={tabClass(active === "agent")}>
          Ask the data
        </button>
        <button onClick={() => setActive("system")} className={tabClass(active === "system")}>
          How it works
        </button>
      </nav>

      {/* Fixed floor so the page never collapses and re-expands between tabs */}
      <div className="mt-5 min-h-[62vh]">
        {active === "agent" ? (
          <AgentPanel token={token} />
        ) : active === "system" ? (
          <SystemPanel token={token} />
        ) : active === "overview" ? (
          persona.dept === "FINANCE" ? <FinanceOverview token={token} />
          : persona.dept === "OPS" ? <OpsOverview token={token} />
          : <SalesOverview token={token} />
        ) : screen ? (
          <Section title={screen.title} note={screen.note}>
            {table.error && <p className="text-sm text-red-700 dark:text-red-400">{table.error}</p>}
            {table.data === null && !table.error ? (
              <TableSkeleton />
            ) : (
              <DataTable rows={table.data ?? []} exportName={screen.view} />
            )}
          </Section>
        ) : (
          <TableSkeleton />
        )}
      </div>
    </main>
  );
}
