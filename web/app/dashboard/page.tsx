"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PERSONAS, fetchView, fetchViews, gbp } from "@/lib/api";
import { usePolled } from "@/lib/usePolled";
import { DataTable, Section, StatTile, TableSkeleton } from "@/components/ui";
import { FinanceOverview, OpsOverview, SalesOverview } from "@/components/Overview";
import { AgentPanel } from "@/components/AgentPanel";

const POLL_MS = 15000;

// Which views make up each department's screens, in display order. The list
// the user actually gets comes from /api/views (i.e. from Postgres grants) —
// this map only orders and titles what the database allows. "overview" is a
// client-side composition of granted views, so it needs no grant of its own.
type Screen = { view: string; title: string; note?: string };
const OVERVIEW: Screen = { view: "overview", title: "Overview" };

const SCREENS: Record<string, Screen[]> = {
  FINANCE: [
    // Revenue assurance stays the landing tab — it is the demo's first screen.
    { view: "vw_finance_revenue_assurance", title: "Revenue assurance",
      note: "Exceptions: earned but not billed. The screen that finds money." },
    OVERVIEW,
    { view: "vw_finance_site_pnl", title: "Site P&L",
      note: "Contribution margin — central overhead deliberately excluded" },
    { view: "vw_finance_budget_variance", title: "Budget variance" },
    { view: "vw_finance_aged_debt", title: "Aged debt" },
    { view: "vw_finance_lease_exposure", title: "Head-lease exposure" },
    { view: "vw_finance_operated_brand_pnl", title: "Operated food P&L" },
    { view: "vw_scorecard", title: "Scorecard" },
    { view: "vw_data_exceptions", title: "Data quality" },
  ],
  OPS: [
    OVERVIEW,
    { view: "vw_ops_compliance_expiry", title: "Compliance expiry",
      note: "An expired cert is a closed kitchen" },
    { view: "vw_ops_site_occupancy", title: "Occupancy" },
    { view: "vw_ops_maintenance_load", title: "Maintenance" },
    { view: "vw_ops_utility_intensity", title: "Utilities" },
    { view: "vw_ops_asset_replacement", title: "Asset replacement" },
    { view: "vw_scorecard", title: "Scorecard" },
    { view: "vw_data_exceptions", title: "Data quality" },
  ],
  SALES: [
    OVERVIEW,
    { view: "vw_sales_pipeline", title: "Pipeline" },
    { view: "vw_sales_conversion", title: "Conversion" },
    { view: "vw_sales_churn_risk", title: "Churn risk" },
    { view: "vw_scorecard", title: "Scorecard" },
  ],
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

  // What Postgres says this role can read (polled so grant changes surface).
  const grants = usePolled(
    () => (token ? fetchViews(token) : Promise.resolve(null)),
    [token], 60000);
  const granted = grants.data?.views ?? [];

  const screens = useMemo(() => {
    if (!persona) return [];
    return SCREENS[persona.dept].filter(
      (s) => s.view === "overview" || granted.includes(s.view));
  }, [persona, granted]);

  useEffect(() => {
    if (screens.length && active !== "agent"
        && !screens.some((s) => s.view === active)) {
      setActive(screens[0].view);
    }
  }, [screens, active]);

  // Finance headline tiles — only fetched when granted.
  const summary = usePolled(
    () => (token && persona?.dept === "FINANCE"
      ? fetchView(token, "vw_finance_leakage_summary").then((r) => r.rows)
      : Promise.resolve([])),
    [token, persona?.dept], POLL_MS);

  // The active table's rows, polled.
  const isTable = !!active && active !== "agent" && active !== "overview";
  const table = usePolled(
    () => (token && isTable
      ? fetchView(token, active).then((r) => r.rows)
      : Promise.resolve(null)),
    [token, active, isTable], POLL_MS);

  if (!token || !persona) return null;
  const screen = screens.find((s) => s.view === active);
  const summaryRows = summary.data ?? [];
  const annualisedGap = summaryRows.reduce(
    (a, r) => a + Number(r.annualised_gap_gbp ?? 0), 0);
  const cases = summaryRows.reduce((a, r) => a + Number(r.cases ?? 0), 0);
  const lastUpdated = table.lastUpdated ?? summary.lastUpdated;

  function switchPersona(t: string) {
    localStorage.setItem("demo_token", t);
    setToken(t);
    setActive("");
  }

  const tabClass = (selected: boolean) =>
    `rounded-t-lg px-3 py-2 text-sm transition-colors ${
      selected
        ? "border border-b-0 border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 font-medium text-neutral-900 dark:text-neutral-100"
        : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"}`;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            Unified Data Platform
            <span className="ml-3 rounded-full bg-amber-100 dark:bg-amber-950 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200 align-middle">
              synthetic data
            </span>
          </h1>
          <p className="text-sm text-neutral-500">
            Signed in as <span className="font-medium text-neutral-700 dark:text-neutral-300">{persona.label}</span>
            {" · "}role <code className="text-xs">{persona.dept === "FINANCE" ? "dept_finance" : persona.dept === "OPS" ? "dept_ops" : "dept_sales"}</code>
            {lastUpdated && (
              <span className="ml-2 text-xs text-neutral-400">
                · updated {lastUpdated.toLocaleTimeString("en-GB")}
              </span>
            )}
          </p>
        </div>
        {/* The reveal: switch department and watch the same app change shape */}
        <div className="flex gap-2">
          {PERSONAS.map((p) => (
            <button key={p.token} onClick={() => switchPersona(p.token)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                p.token === token
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-500"
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {persona.dept === "FINANCE" && summaryRows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Annualised leakage" value={gbp(annualisedGap)} tone="bad"
            sub="computed from the data, not asserted" />
          <StatTile label="Open exceptions" value={String(cases)} tone="bad" />
          <StatTile label="Exception classes" value={String(summaryRows.length)} />
          <StatTile label="Biggest class"
            value={String(summaryRows[0]?.exception_type ?? "—").replaceAll("_", " ")}
            sub={gbp(Number(summaryRows[0]?.annualised_gap_gbp ?? 0)) + "/yr"} />
        </div>
      )}

      <nav className="flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800 pb-px">
        {screens.map((s) => (
          <button key={s.view} onClick={() => setActive(s.view)}
            className={tabClass(active === s.view)}>
            {s.title}
          </button>
        ))}
        <button onClick={() => setActive("agent")} className={tabClass(active === "agent")}>
          Ask the data
        </button>
      </nav>

      {active === "agent" ? (
        <AgentPanel token={token} />
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
    </main>
  );
}
