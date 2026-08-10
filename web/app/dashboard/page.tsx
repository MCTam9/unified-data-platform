"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PERSONAS, Row, fetchView, fetchViews, gbp } from "@/lib/api";
import { DataTable, Section, StatTile } from "@/components/ui";
import { AgentPanel } from "@/components/AgentPanel";

// Which views make up each department's screens, in display order. The list
// the user actually gets comes from /api/views (i.e. from Postgres grants) —
// this map only orders and titles what the database allows.
const SCREENS: Record<string, { view: string; title: string; note?: string }[]> = {
  FINANCE: [
    { view: "vw_finance_revenue_assurance", title: "Revenue assurance",
      note: "Exceptions: earned but not billed. The screen that finds money." },
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
    { view: "vw_sales_pipeline", title: "Pipeline" },
    { view: "vw_sales_conversion", title: "Conversion" },
    { view: "vw_sales_churn_risk", title: "Churn risk" },
    { view: "vw_scorecard", title: "Scorecard" },
  ],
};

export default function Dashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [granted, setGranted] = useState<string[]>([]);
  const [active, setActive] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Row[]>([]);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const persona = PERSONAS.find((p) => p.token === token);
  const screens = useMemo(() => {
    if (!persona) return [];
    // Only screens the database actually granted to this role.
    return SCREENS[persona.dept].filter((s) => granted.includes(s.view));
  }, [persona, granted]);

  useEffect(() => {
    const t = localStorage.getItem("demo_token");
    if (!t) { router.replace("/"); return; }
    setToken(t);
    fetchViews(t)
      .then((v) => setGranted(v.views))
      .catch((e) => setError(String(e)));
    // Finance headline: the leakage summary, fetched only if granted —
    // for other roles Postgres would refuse it anyway.
    fetchView(t, "vw_finance_leakage_summary")
      .then((r) => setSummary(r.rows))
      .catch(() => setSummary([]));
  }, [router]);

  useEffect(() => {
    if (screens.length && active !== "agent" && !screens.some((s) => s.view === active)) {
      setActive(screens[0].view);
    }
  }, [screens, active]);

  useEffect(() => {
    if (!token || !active || active === "agent") return;
    setLoading(true);
    setError("");
    fetchView(token, active)
      .then((r) => setRows(r.rows))
      .catch((e) => { setRows([]); setError(String(e)); })
      .finally(() => setLoading(false));
  }, [token, active]);

  if (!token || !persona) return null;
  const screen = screens.find((s) => s.view === active);

  const annualisedGap = summary.reduce(
    (a, r) => a + Number(r.annualised_gap_gbp ?? 0), 0);
  const cases = summary.reduce((a, r) => a + Number(r.cases ?? 0), 0);

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
          </p>
        </div>
        {/* The reveal: switch department and watch the same app change shape */}
        <div className="flex gap-2">
          {PERSONAS.map((p) => (
            <button
              key={p.token}
              onClick={() => { localStorage.setItem("demo_token", p.token); setToken(p.token); setGranted([]); setSummary([]); setActive("");
                fetchViews(p.token).then((v) => setGranted(v.views)).catch((e) => setError(String(e)));
                fetchView(p.token, "vw_finance_leakage_summary").then((r) => setSummary(r.rows)).catch(() => setSummary([]));
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                p.token === token
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-500"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {persona.dept === "FINANCE" && summary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Annualised leakage" value={gbp(annualisedGap)} tone="bad"
            sub="computed from the data, not asserted" />
          <StatTile label="Open exceptions" value={String(cases)} tone="bad" />
          <StatTile label="Exception classes" value={String(summary.length)} />
          <StatTile label="Biggest class"
            value={String(summary[0]?.exception_type ?? "—").replaceAll("_", " ")}
            sub={gbp(Number(summary[0]?.annualised_gap_gbp ?? 0)) + "/yr"} />
        </div>
      )}

      <nav className="flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800 pb-px">
        {screens.map((s) => (
          <button
            key={s.view}
            onClick={() => setActive(s.view)}
            className={`rounded-t-lg px-3 py-2 text-sm transition-colors ${
              active === s.view
                ? "border border-b-0 border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 font-medium text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"
            }`}
          >
            {s.title}
          </button>
        ))}
        <button
          onClick={() => setActive("agent")}
          className={`rounded-t-lg px-3 py-2 text-sm transition-colors ${
            active === "agent"
              ? "border border-b-0 border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 font-medium text-neutral-900 dark:text-neutral-100"
              : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"
          }`}
        >
          Ask the data
        </button>
      </nav>

      {active === "agent" ? (
        <AgentPanel token={token} />
      ) : screen ? (
        <Section title={screen.title} note={screen.note}>
          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
          {loading ? (
            <p className="text-sm text-neutral-500 py-6 animate-pulse">Loading…</p>
          ) : (
            <DataTable rows={rows} />
          )}
        </Section>
      ) : (
        <p className="text-sm text-neutral-500 py-6">Loading views…</p>
      )}
    </main>
  );
}
