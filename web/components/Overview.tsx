"use client";
import { Row, excludePartialPeriod, fetchView, gbp, groupSum, monthLabel } from "@/lib/api";
import { usePolled } from "@/lib/usePolled";
import { BarRank, ChartCard, StatusDonut, TrendLine } from "./charts";
import { StatTile } from "./ui";

// Per-department chart overviews. Everything derives from the reporting
// views the role is granted — the same boundary as every other screen; the
// charts are just another reader.

const POLL_MS = 15000;

function Loading() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-60 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- FINANCE
export function FinanceOverview({ token }: { token: string }) {
  const { data, error } = usePolled(`fin-overview:${token}`,
    () => Promise.all([
      fetchView(token, "vw_finance_site_pnl", 2000),
      fetchView(token, "vw_finance_leakage_summary"),
    ]), POLL_MS);

  if (error) return <p className="text-sm text-red-700 dark:text-red-400">{error}</p>;
  if (!data) return <Loading />;
  const [pnl, leakage] = data.map((d) => d.rows);

  const byMonth = excludePartialPeriod(
    groupSum(pnl, "period", ["revenue_invoiced_gbp", "revenue_collected_gbp"]))
    .map((p) => ({ ...p, month: monthLabel(p.period) }));

  const latestPeriod = String(pnl.reduce(
    (a, r) => (String(r.period) > a ? String(r.period) : a), ""));
  const latestMonth = pnl.filter((r) => r.period === latestPeriod);
  const topSites = groupSum(latestMonth, "site_code", ["contribution_gbp"])
    .sort((a, b) => Number(b.contribution_gbp) - Number(a.contribution_gbp))
    .slice(0, 10);

  const leakageBars = leakage.map((r) => ({
    class: String(r.exception_type).replaceAll("_", " "),
    annualised_gap_gbp: Number(r.annualised_gap_gbp),
  }));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ChartCard title="Revenue by month" note="complete months only. Cash sits above net revenue because it carries VAT — collected on HMRC's behalf, not income.">
        <TrendLine data={byMonth} x="month" unit="£"
          series={[
            { key: "revenue_invoiced_gbp", label: "Invoiced (net)" },
            { key: "revenue_collected_gbp", label: "Collected (cash, incl. VAT)" },
          ]} />
      </ChartCard>
      <ChartCard title="Annualised leakage by exception class" note="monthly gap × 12 — recurs until the billing process changes">
        <BarRank data={leakageBars} x="class" y="annualised_gap_gbp" unit="£" />
      </ChartCard>
      <ChartCard title={`Top sites by contribution — ${monthLabel(latestPeriod)}`}
        note="contribution margin; central overhead excluded by design">
        <BarRank data={topSites} x="site_code" y="contribution_gbp" unit="£" />
      </ChartCard>
    </div>
  );
}

// ----------------------------------------------------------------------- OPS
const STATUS_ORDER = ["ok", "due_90d", "due_30d", "EXPIRED"];

export function OpsOverview({ token }: { token: string }) {
  const { data, error } = usePolled(`ops-overview:${token}`,
    () => Promise.all([
      fetchView(token, "vw_ops_compliance_expiry", 2000),
      fetchView(token, "vw_ops_site_occupancy"),
      fetchView(token, "vw_ops_utility_intensity", 2000),
      fetchView(token, "vw_ops_maintenance_load", 2000),
    ]), POLL_MS);

  if (error) return <p className="text-sm text-red-700 dark:text-red-400">{error}</p>;
  if (!data) return <Loading />;
  const [certs, occupancy, utilities, maint] = data.map((d) => d.rows);

  const certMix = STATUS_ORDER
    .map((s) => ({ status: s, count: certs.filter((c) => c.status === s).length }))
    .filter((r) => r.count > 0);
  const occBars = occupancy
    .map((r) => ({ site_code: String(r.site_code), occupancy_pct: Number(r.occupancy_pct) }))
    .sort((a, b) => a.occupancy_pct - b.occupancy_pct);
  const utilByMonth = excludePartialPeriod(groupSum(utilities, "period", ["cost_gbp"]))
    .map((p) => ({ ...p, month: monthLabel(p.period) }));

  const unitsTotal = occupancy.reduce((a, r) => a + Number(r.units_total), 0);
  const unitsOcc = occupancy.reduce((a, r) => a + Number(r.units_occupied), 0);
  const expired = certs.filter((c) => c.status === "EXPIRED").length;
  const openTickets = maint.reduce((a, r) => a + Number(r.tickets_open ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Estate occupancy"
          value={`${((100 * unitsOcc) / Math.max(unitsTotal, 1)).toFixed(1)}%`}
          sub={`${unitsOcc} of ${unitsTotal} units`} />
        <StatTile label="Expired certificates" value={String(expired)}
          tone={expired ? "bad" : "good"} sub="an expired cert is a closed kitchen" />
        <StatTile label="Open tickets" value={String(openTickets)} />
        <StatTile label="Sites" value={String(occupancy.length)} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Compliance certificate status" note="across the whole estate">
          <StatusDonut data={certMix} nameKey="status" valueKey="count"
            centerLabel="certificates" />
        </ChartCard>
        <ChartCard title="Utility cost by month" note="all utilities, all sites — complete months only">
          <TrendLine data={utilByMonth} x="month" unit="£"
            series={[{ key: "cost_gbp", label: "Utility cost" }]} />
        </ChartCard>
        <ChartCard title="Occupancy by site" note="lowest first — the relet worklist">
          <BarRank data={occBars} x="site_code" y="occupancy_pct" unit="" height={280} />
        </ChartCard>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- SALES
export function SalesOverview({ token }: { token: string }) {
  const { data, error } = usePolled(`sales-overview:${token}`,
    () => Promise.all([
      fetchView(token, "vw_sales_pipeline", 2000),
      fetchView(token, "vw_sales_conversion", 2000),
      fetchView(token, "vw_sales_churn_risk", 2000),
    ]), POLL_MS);

  if (error) return <p className="text-sm text-red-700 dark:text-red-400">{error}</p>;
  if (!data) return <Loading />;
  const [pipeline, conversion, churn] = data.map((d) => d.rows);

  const STAGES = ["new", "qualified", "viewing", "proposal"];
  const byStage = STAGES.map((s) => ({
    stage: s,
    pipeline_value_monthly_gbp: pipeline.filter((r) => r.stage === s)
      .reduce((a, r) => a + Number(r.pipeline_value_monthly_gbp ?? 0), 0),
  }));

  const cohorts = excludePartialPeriod(
    groupSum(conversion, "cohort_month", ["enquiries", "won", "lost"]))
    .map((p) => ({
      ...p, month: monthLabel(p.cohort_month),
      win_rate_pct: Number(p.won) + Number(p.lost) > 0
        ? Math.round((1000 * Number(p.won)) / (Number(p.won) + Number(p.lost))) / 10
        : null,
    }));

  const pipelineValue = byStage.reduce((a, r) => a + r.pipeline_value_monthly_gbp, 0);
  const highRisk = churn.filter((r) => r.risk_flag === "high").length;
  const won = conversion.reduce((a, r) => a + Number(r.won), 0);
  const lost = conversion.reduce((a, r) => a + Number(r.lost), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Open pipeline" value={gbp(pipelineValue)} sub="expected monthly fees" />
        <StatTile label="Win rate (all time)"
          value={`${((100 * won) / Math.max(won + lost, 1)).toFixed(0)}%`}
          sub={`${won} won · ${lost} lost`} />
        <StatTile label="High churn risk" value={String(highRisk)}
          tone={highRisk ? "bad" : "good"} sub="active licences" />
        <StatTile label="Active licences" value={String(churn.length)} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Pipeline value by stage" note="open enquiries, expected £/month">
          <BarRank data={byStage} x="stage" y="pipeline_value_monthly_gbp" unit="£" />
        </ChartCard>
        {/* Two measures, two scales — small multiples, never a dual axis */}
        <div className="space-y-4">
          <ChartCard title="Enquiries per cohort month">
            <TrendLine data={cohorts} x="month"
              series={[{ key: "enquiries", label: "Enquiries" }]} />
          </ChartCard>
          <ChartCard title="Win rate per cohort month" note="% of closed enquiries won">
            <TrendLine data={cohorts} x="month" unit=""
              series={[{ key: "win_rate_pct", label: "Win rate %" }]} />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
