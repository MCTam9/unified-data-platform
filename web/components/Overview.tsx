"use client";
import { useState } from "react";
import {
  Point,
  Row,
  billLicence,
  excludePartialPeriod,
  fetchView,
  gbp,
  groupSum,
  monthLabel,
} from "@/lib/api";
import { usePolled } from "@/lib/usePolled";
import { BarRank, ChartCard, TrendLine } from "./charts";
import { Sheet, StatusPill } from "./ui";

// Per-department Executive Briefings.
// Layer 1 (Hero Plinth): Pure visual summary & headline metrics.
// Layer 2 (Workspace Sheets): Actionable queues, watchlists, trends & breakdowns.

const POLL_MS = 15000;
const HERO_NUM = "text-[clamp(2.25rem,4vw,3.25rem)]";

function BriefingSkeleton() {
  return (
    <div className="space-y-5">
      <div className="plinth h-[230px] animate-pulse rounded-2xl" />
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 space-y-5 lg:col-span-4">
          <div className="h-64 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--card)]" />
          <div className="h-56 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--card)]" />
        </div>
        <div className="col-span-12 space-y-5 lg:col-span-8">
          <div className="h-72 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--card)]" />
          <div className="h-64 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--card)]" />
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="rounded-xl bg-[var(--blocked-soft)] px-5 py-4 text-sm font-medium text-[var(--blocked-ink)]">
      {message}
    </p>
  );
}

function RegisterLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-medium text-[var(--ink-muted)] underline-offset-4 transition-colors hover:text-[var(--ink)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]"
    >
      {label}
    </button>
  );
}

// ------------------------------------------------------------------- FINANCE
export function FinanceOverview({
  token,
  onOpenRegister,
  onNotify,
}: {
  token: string;
  onOpenRegister: (view: string) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const [hoveredSpark, setHoveredSpark] = useState<number | null>(null);

  const polled = usePolled(
    `fin-briefing:${token}`,
    () =>
      Promise.all([
        fetchView(token, "vw_finance_leakage_summary"),
        fetchView(token, "vw_finance_revenue_assurance", 200),
        fetchView(token, "vw_finance_site_pnl", 2000),
        fetchView(token, "vw_finance_aged_debt", 500),
        fetchView(token, "vw_finance_budget_variance", 1000),
      ]),
    POLL_MS,
  );

  if (polled.error) return <ErrorBanner message={polled.error} />;
  if (!polled.data) return <BriefingSkeleton />;

  const [leakage, assurance, pnl, agedDebt, budgetVar] = polled.data.map(
    (d) => d.rows,
  );

  // 1. Revenue leakage summary & billable queue
  const annualisedGap = leakage.reduce(
    (a, r) => a + Number(r.annualised_gap_gbp ?? 0),
    0,
  );
  const totalCases = leakage.reduce((a, r) => a + Number(r.cases ?? 0), 0);

  const billableQueue = assurance
    .filter((r) => r.exception_type === "licence_not_invoiced")
    .sort((a, b) => Number(b.gap_gbp ?? 0) - Number(a.gap_gbp ?? 0));

  async function handleQuickBill(r: Row) {
    const site = String(r.site_code);
    const unit = String(r.unit_code);
    const key = `${site}:${unit}`;
    setBusyKey(key);
    try {
      const res = await billLicence(token, site, unit);
      setDoneKeys((prev) => new Set(prev).add(key));
      onNotify(
        `Invoice ${res.invoice_no} raised for ${res.partner} — ${gbp(res.net_gbp)}/mo recovered.`,
        false,
      );
      polled.reload();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Billing action failed", true);
    } finally {
      setBusyKey(null);
    }
  }

  // 2. Trading series & latest complete month
  const byMonth: Point[] = excludePartialPeriod(
    groupSum(pnl, "period", [
      "revenue_invoiced_gbp",
      "revenue_collected_gbp",
      "contribution_gbp",
      "rent_gbp",
      "rates_gbp",
      "utilities_gbp",
      "labour_gbp",
      "maintenance_gbp",
    ]),
  ).map((p) => ({ ...p, month: monthLabel(p.period) }));

  const latestComplete = byMonth[byMonth.length - 1];
  const priorComplete = byMonth.length > 1 ? byMonth[byMonth.length - 2] : null;
  const latestRev = Number(latestComplete?.revenue_invoiced_gbp ?? 0);
  const priorRev = Number(priorComplete?.revenue_invoiced_gbp ?? 0);
  const revMomPct =
    priorRev > 0 ? ((latestRev - priorRev) / priorRev) * 100 : null;
  const latestCash = Number(latestComplete?.revenue_collected_gbp ?? 0);
  const latestContrib = Number(latestComplete?.contribution_gbp ?? 0);
  const latestMarginPct = latestRev > 0 ? (latestContrib / latestRev) * 100 : 0;

  // Compact 12-month revenue spark-bars for the hero visual summary
  const sparkMonths = byMonth.slice(-12);
  const sparkValues = sparkMonths.map((m) => Number(m.revenue_invoiced_gbp ?? 0));
  const maxSparkRev = Math.max(1, ...sparkValues);
  const minSparkRev = sparkValues.length ? Math.min(...sparkValues) : 0;
  const activeSparkIdx =
    hoveredSpark !== null && sparkMonths[hoveredSpark]
      ? hoveredSpark
      : sparkMonths.length - 1;
  const activeSpark = sparkMonths[activeSparkIdx];
  const fmtShortGbp = (v: number) =>
    Math.abs(v) >= 1_000_000
      ? `£${(v / 1_000_000).toFixed(2)}m`
      : Math.abs(v) >= 1_000
        ? `£${Math.round(v / 1_000)}k`
        : gbp(v);

  // Latest-month site operating cost composition
  const costLines = [
    { label: "Rent", amount: Number(latestComplete?.rent_gbp ?? 0) },
    { label: "Labour", amount: Number(latestComplete?.labour_gbp ?? 0) },
    { label: "Rates", amount: Number(latestComplete?.rates_gbp ?? 0) },
    { label: "Utilities", amount: Number(latestComplete?.utilities_gbp ?? 0) },
    { label: "Maintenance", amount: Number(latestComplete?.maintenance_gbp ?? 0) },
  ].sort((a, b) => b.amount - a.amount);
  const totalCostLatest = costLines.reduce((a, c) => a + c.amount, 0);

  const latestCompletePeriod = String(latestComplete?.period ?? "");
  const latestMonthPnl = pnl.filter(
    (r) => String(r.period) === latestCompletePeriod,
  );
  const siteContribution = groupSum(latestMonthPnl, "site_code", [
    "contribution_gbp",
    "revenue_invoiced_gbp",
  ]).sort((a, b) => Number(b.contribution_gbp) - Number(a.contribution_gbp));

  const topSites = siteContribution.slice(0, 6);
  const bottomSites = [...siteContribution].reverse().slice(0, 5);
  const maxContribAbs = Math.max(
    1,
    ...siteContribution.map((s) => Math.abs(Number(s.contribution_gbp ?? 0))),
  );
  const siteCount = new Set(pnl.map((r) => String(r.site_code))).size || 25;

  // 3. Aged debt summary
  const totalOverdue = agedDebt.reduce(
    (a, r) => a + Number(r.outstanding_gbp ?? 0),
    0,
  );
  const bucketOrder = ["0-30", "31-60", "61-90", "90+"];
  const bucketTotals = bucketOrder.map((b) => ({
    bucket: b,
    amount: agedDebt
      .filter((r) => String(r.ageing_bucket) === b)
      .reduce((a, r) => a + Number(r.outstanding_gbp ?? 0), 0),
  }));
  const overdue90 = bucketTotals.find((b) => b.bucket === "90+")?.amount ?? 0;
  const topDebtors = [...agedDebt]
    .sort((a, b) => Number(b.outstanding_gbp ?? 0) - Number(a.outstanding_gbp ?? 0))
    .slice(0, 5);

  // 4. Budget variance alerts
  const latestBudgetPeriod = budgetVar.reduce(
    (a, r) => (String(r.period) > a ? String(r.period) : a),
    "",
  );
  const latestBudgetAlerts = budgetVar
    .filter(
      (r) =>
        String(r.period) === latestBudgetPeriod &&
        Number(r.variance_gbp ?? 0) < 0,
    )
    .sort((a, b) => Number(a.variance_gbp ?? 0) - Number(b.variance_gbp ?? 0))
    .slice(0, 5);
  const maxVarAbs = Math.max(
    1,
    ...latestBudgetAlerts.map((r) => Math.abs(Number(r.variance_gbp ?? 0))),
  );

  return (
    <div className="space-y-5">
      {/* LAYER 1 — VISUAL SUMMARY HERO PLINTH (key metrics + compact visual trajectory only) */}
      <section
        aria-label="Finance executive summary"
        className="plinth overflow-hidden rounded-2xl ring-1 ring-white/[0.08]"
      >
        <div className="grid gap-8 p-6 sm:p-7 lg:grid-cols-12 lg:items-end">
          {/* Primary headline + 4 key metrics */}
          <div className="space-y-5 lg:col-span-7">
            <p className="text-xs font-medium text-[var(--ink-muted)]">
              Finance Director · {siteCount} sites reporting
              {latestComplete ? ` · Latest complete month: ${latestComplete.month}` : ""}
            </p>

            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <p className={`type-display ${HERO_NUM}`}>{gbp(latestRev)}</p>
              <span className="text-sm text-[var(--ink-muted)]">
                invoiced revenue (net)
              </span>
              {revMomPct !== null && (
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium type-data ${
                    revMomPct >= 0
                      ? "bg-[var(--good-soft)] text-[var(--good-ink)]"
                      : "bg-[var(--blocked-soft)] text-[var(--blocked-ink)]"
                  }`}
                >
                  {revMomPct >= 0 ? "+" : ""}
                  {revMomPct.toFixed(1)}% MoM
                </span>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-white/10 pt-5 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">
                  Cash collected
                </dt>
                <dd className="type-heading mt-1 text-lg type-data text-[var(--series)]">
                  {gbp(latestCash)}
                </dd>
                <dd className="text-[11px] text-[var(--ink-muted)]">
                  Incl. VAT
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">
                  Site contribution
                </dt>
                <dd className="type-heading mt-1 text-lg type-data">
                  {gbp(latestContrib)}
                </dd>
                <dd className="text-[11px] type-data text-[var(--ink-muted)]">
                  {latestMarginPct.toFixed(1)}% margin
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                  <span
                    className={`size-1.5 rounded-full ${
                      annualisedGap > 0 ? "bg-[var(--blocked)]" : "bg-[var(--good)]"
                    }`}
                    aria-hidden
                  />
                  Revenue leakage
                </dt>
                <dd className="type-heading mt-1 text-lg type-data text-[var(--blocked-ink)]">
                  {gbp(annualisedGap)}
                </dd>
                <dd className="text-[11px] type-data text-[var(--ink-muted)]">
                  {totalCases} open / yr
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">
                  Overdue debt
                </dt>
                <dd className="type-heading mt-1 text-lg type-data">
                  {gbp(totalOverdue)}
                </dd>
                <dd className="text-[11px] type-data text-[var(--blocked-ink)]">
                  {gbp(overdue90)} at 90+d
                </dd>
              </div>
            </dl>
          </div>

          {/* Right 5 cols: Visual-only summary (12-month trajectory spark-bars + cost mix bar) */}
          <div className="flex flex-col justify-between gap-5 border-t border-white/10 pt-5 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            {/* 12-month revenue pulse with live figure readout & range labels */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium text-[var(--ink)]">
                  12-month revenue trajectory
                </span>
                {activeSpark && (
                  <span className="type-data font-semibold text-[var(--series)]">
                    {String(activeSpark.month)} ·{" "}
                    {gbp(Number(activeSpark.revenue_invoiced_gbp ?? 0))}
                  </span>
                )}
              </div>

              <div className="flex items-stretch gap-2.5">
                {/* Compact Y-axis scale (peak & floor) */}
                <div className="flex flex-col justify-between text-right text-[10px] leading-none type-data text-[var(--ink-muted)]">
                  <span>{fmtShortGbp(maxSparkRev)}</span>
                  <span>{fmtShortGbp(minSparkRev)}</span>
                </div>

                <div className="flex-1">
                  <div
                    className="flex h-16 items-end gap-1 border-b border-white/15 pb-1"
                    role="img"
                    aria-label="12-month invoiced revenue bar trajectory"
                    onMouseLeave={() => setHoveredSpark(null)}
                  >
                    {sparkMonths.map((m, i) => {
                      const val = Number(m.revenue_invoiced_gbp ?? 0);
                      const hPx = Math.max(8, Math.round((val / maxSparkRev) * 56));
                      const isActive = i === activeSparkIdx;
                      return (
                        <button
                          key={String(m.period)}
                          type="button"
                          onMouseEnter={() => setHoveredSpark(i)}
                          onFocus={() => setHoveredSpark(i)}
                          aria-label={`${m.month}: ${gbp(val)}`}
                          className="group flex h-full flex-1 items-end focus:outline-none"
                        >
                          <span
                            className={`block w-full rounded-t-sm transition-colors duration-100 ${
                              isActive
                                ? "bg-[var(--series)]"
                                : "bg-white/30 group-hover:bg-white/55"
                            }`}
                            style={{ height: `${hPx}px` }}
                          />
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] type-data text-[var(--ink-muted)]">
                    <span>{sparkMonths[0]?.month ?? ""}</span>
                    <span>
                      {sparkMonths[Math.floor(sparkMonths.length / 2)]?.month ?? ""}
                    </span>
                    <span className="text-[var(--ink)]">
                      {sparkMonths[sparkMonths.length - 1]?.month ?? ""}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Stacked operating cost mix bar */}
            <div className="space-y-2 border-t border-white/10 pt-4">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-[var(--ink)]">
                  Site cost mix
                </span>
                <span className="type-data text-[var(--ink-muted)]">
                  {gbp(totalCostLatest)}
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--track)]">
                {costLines.map((c, idx) => {
                  const pct =
                    totalCostLatest > 0 ? (c.amount / totalCostLatest) * 100 : 0;
                  const shades = [
                    "bg-white/85",
                    "bg-[var(--series)]",
                    "bg-white/50",
                    "bg-white/30",
                    "bg-white/15",
                  ];
                  return (
                    <div
                      key={c.label}
                      title={`${c.label}: ${gbp(c.amount)} (${Math.round(pct)}%)`}
                      className={`grow-x h-full ${shades[idx % shades.length]}`}
                      style={{
                        width: `${pct}%`,
                        ["--grow-delay" as string]: `${80 + idx * 50}ms`,
                      }}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] type-data text-[var(--ink-muted)]">
                {costLines.slice(0, 4).map((c) => (
                  <span key={c.label}>
                    {c.label}{" "}
                    <strong className="font-medium text-[var(--ink)]">
                      {totalCostLatest > 0
                        ? `${Math.round((c.amount / totalCostLatest) * 100)}%`
                        : "0%"}
                    </strong>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* LAYER 2 — DETAILED OPERATIONAL SHEETS (Left 4 cols: Actions & Watchlists / Right 8 cols: Trends & Site Margin) */}
      <div className="grid grid-cols-12 gap-5">
        {/* Left 4 cols: Actionable queue + Watchlists */}
        <div className="col-span-12 flex flex-col gap-5 lg:col-span-4">
          <Sheet
            title="Revenue assurance queue"
            description={`${billableQueue.length} unbilled licences ready to invoice`}
            action={
              <RegisterLink
                label={`All ${totalCases}`}
                onClick={() => onOpenRegister("vw_finance_revenue_assurance")}
              />
            }
          >
            {billableQueue.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">
                All active licences have been invoiced for the open period.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {billableQueue.slice(0, 5).map((r) => {
                  const site = String(r.site_code);
                  const unit = String(r.unit_code);
                  const key = `${site}:${unit}`;
                  const isBusy = busyKey === key;
                  const isDone = doneKeys.has(key);
                  return (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--ink)]">
                          {String(r.partner ?? "Unnamed partner")}
                        </p>
                        <p className="truncate text-xs type-data text-[var(--ink-muted)]">
                          <span className="font-mono">{site}</span> · {unit} ·{" "}
                          <span className="font-semibold text-[var(--blocked-ink)]">
                            {gbp(Number(r.gap_gbp ?? 0))}/mo
                          </span>
                        </p>
                      </div>
                      {isDone ? (
                        <span className="inline-flex h-7 w-[88px] shrink-0 items-center justify-center rounded-md bg-[var(--good-soft)] text-xs font-medium text-[var(--good-ink)]">
                          Invoiced ✓
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleQuickBill(r)}
                          className="inline-flex h-7 w-[88px] shrink-0 items-center justify-center rounded-md bg-[var(--ink)] text-xs font-medium text-[var(--card)] transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] disabled:opacity-45"
                        >
                          {isBusy ? "Billing…" : "Bill now"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Sheet>

          <Sheet
            title="Aged debt"
            description="Overdue receivables by ageing bucket"
            action={
              <RegisterLink
                label="Open register"
                onClick={() => onOpenRegister("vw_finance_aged_debt")}
              />
            }
          >
            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--track)]">
                  {bucketTotals.map((b) => {
                    const pct =
                      totalOverdue > 0 ? (b.amount / totalOverdue) * 100 : 0;
                    if (pct <= 0) return null;
                    const color =
                      b.bucket === "90+"
                        ? "bg-[var(--blocked)]"
                        : b.bucket === "61-90"
                          ? "bg-[var(--attention)]"
                          : b.bucket === "31-60"
                            ? "bg-[var(--ink)]/55"
                            : "bg-[var(--ink)]/25";
                    return (
                      <div
                        key={b.bucket}
                        title={`${b.bucket} days: ${gbp(b.amount)}`}
                        className={`h-full ${color}`}
                        style={{ width: `${pct}%` }}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap justify-between gap-2 text-xs type-data text-[var(--ink-muted)]">
                  {bucketTotals.map((b) => (
                    <span key={b.bucket}>
                      {b.bucket}d:{" "}
                      <strong className="font-medium text-[var(--ink)]">
                        {gbp(b.amount)}
                      </strong>
                    </span>
                  ))}
                </div>
              </div>

              {topDebtors.length > 0 && (
                <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)] pt-1">
                  {topDebtors.map((d, i) => (
                    <li
                      key={`${d.invoice_no}-${i}`}
                      className="flex items-center justify-between gap-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[var(--ink)]">
                          {String(d.trading_name)}
                        </p>
                        <p className="text-[var(--ink-muted)] type-data">
                          <span className="font-mono">{String(d.site_code)}</span> ·{" "}
                          {Number(d.days_overdue)}d overdue
                        </p>
                      </div>
                      <span
                        className={`shrink-0 font-semibold type-data ${
                          String(d.ageing_bucket) === "90+"
                            ? "text-[var(--blocked-ink)]"
                            : "text-[var(--ink)]"
                        }`}
                      >
                        {gbp(Number(d.outstanding_gbp))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Sheet>

          <Sheet
            title="Budget alerts"
            description={
              latestBudgetPeriod
                ? `Largest adverse variances (${monthLabel(latestBudgetPeriod)})`
                : "Adverse variances against budget"
            }
            action={
              <RegisterLink
                label="Open register"
                onClick={() => onOpenRegister("vw_finance_budget_variance")}
              />
            }
          >
            {latestBudgetAlerts.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">
                No adverse budget variances in the latest period.
              </p>
            ) : (
              <ul className="space-y-3">
                {latestBudgetAlerts.map((r, i) => {
                  const v = Number(r.variance_gbp ?? 0);
                  const pct = (Math.abs(v) / maxVarAbs) * 100;
                  return (
                    <li key={i} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="truncate font-medium text-[var(--ink)]">
                          <span className="font-mono">{String(r.site_code)}</span>{" "}
                          <span className="font-normal text-[var(--ink-muted)]">
                            {String(r.measure).replaceAll("_", " ")}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold type-data text-[var(--blocked-ink)]">
                          {gbp(v)} ({Number(r.variance_pct ?? 0).toFixed(1)}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--track)]">
                        <div
                          className="h-full rounded-full bg-[var(--blocked)]"
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Sheet>
        </div>

        {/* Right 8 cols: Revenue trend & Site contribution */}
        <div className="col-span-12 flex flex-col gap-5 lg:col-span-8">
          <ChartCard
            title="Revenue and cash collection"
            note="Complete months only. Collected cash sits above net revenue because it includes VAT held for HMRC."
            action={
              <RegisterLink
                label="Open site P&L"
                onClick={() => onOpenRegister("vw_finance_site_pnl")}
              />
            }
          >
            <TrendLine
              data={byMonth}
              x="month"
              unit="£"
              height={260}
              series={[
                { key: "revenue_invoiced_gbp", label: "Invoiced (net)" },
                {
                  key: "revenue_collected_gbp",
                  label: "Collected (cash, incl. VAT)",
                },
              ]}
            />
          </ChartCard>

          <Sheet
            title={`Site contribution (${latestComplete ? latestComplete.month : "latest month"})`}
            description="Contribution margin before central overhead — highest performers beside sites needing attention"
            action={
              <RegisterLink
                label="All 25 sites"
                onClick={() => onOpenRegister("vw_finance_site_pnl")}
              />
            }
          >
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-3">
                <p className="text-xs font-semibold text-[var(--ink-muted)]">
                  Top contributing sites
                </p>
                <ul className="space-y-2.5">
                  {topSites.map((s) => {
                    const val = Number(s.contribution_gbp ?? 0);
                    return (
                      <li key={String(s.site_code)} className="space-y-1">
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-mono font-medium text-[var(--ink)]">
                            {String(s.site_code)}
                          </span>
                          <span className="type-data font-semibold text-[var(--ink)]">
                            {gbp(val)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--track)]">
                          <div
                            className="h-full rounded-full bg-[var(--ink)]"
                            style={{
                              width: `${Math.max(4, (Math.abs(val) / maxContribAbs) * 100)}%`,
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-[var(--ink-muted)]">
                  Lowest contribution / watchlist
                </p>
                <ul className="space-y-2.5">
                  {bottomSites.map((s) => {
                    const val = Number(s.contribution_gbp ?? 0);
                    const isNeg = val < 0;
                    return (
                      <li key={String(s.site_code)} className="space-y-1">
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-mono font-medium text-[var(--ink)]">
                            {String(s.site_code)}
                          </span>
                          <span
                            className={`type-data font-semibold ${
                              isNeg
                                ? "text-[var(--blocked-ink)]"
                                : "text-[var(--ink)]"
                            }`}
                          >
                            {gbp(val)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--track)]">
                          <div
                            className={`h-full rounded-full ${
                              isNeg ? "bg-[var(--blocked)]" : "bg-[var(--ink)]/55"
                            }`}
                            style={{
                              width: `${Math.max(4, (Math.abs(val) / maxContribAbs) * 100)}%`,
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </Sheet>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------- OPS
const STATUS_ORDER = ["ok", "due_90d", "due_30d", "EXPIRED"];

export function OpsOverview({
  token,
  onOpenRegister,
}: {
  token: string;
  onOpenRegister: (view: string) => void;
}) {
  const polled = usePolled(
    `ops-briefing:${token}`,
    () =>
      Promise.all([
        fetchView(token, "vw_ops_compliance_expiry", 2000),
        fetchView(token, "vw_ops_site_occupancy"),
        fetchView(token, "vw_ops_utility_intensity", 2000),
        fetchView(token, "vw_ops_maintenance_load", 2000),
      ]),
    POLL_MS,
  );

  if (polled.error) return <ErrorBanner message={polled.error} />;
  if (!polled.data) return <BriefingSkeleton />;

  const [certs, occupancy, utilities, maint] = polled.data.map((d) => d.rows);

  const unitsTotal = occupancy.reduce((a, r) => a + Number(r.units_total), 0);
  const unitsOcc = occupancy.reduce((a, r) => a + Number(r.units_occupied), 0);
  const occPct = (100 * unitsOcc) / Math.max(unitsTotal, 1);

  const certCounts = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, certs.filter((c) => c.status === s).length]),
  );
  const totalCerts = Math.max(1, certs.length);

  const urgentCerts = [...certs]
    .filter((c) => c.status === "EXPIRED" || c.status === "due_30d")
    .sort((a, b) => Number(a.days_to_expiry ?? 0) - Number(b.days_to_expiry ?? 0))
    .slice(0, 6);

  const occBars = occupancy
    .map((r) => ({
      site_code: String(r.site_code),
      occupancy_pct: Number(r.occupancy_pct),
    }))
    .sort((a, b) => a.occupancy_pct - b.occupancy_pct);

  const utilByMonth = excludePartialPeriod(
    groupSum(utilities, "period", ["cost_gbp"]),
  ).map((p) => ({ ...p, month: monthLabel(p.period) }));

  const openTickets = maint.reduce(
    (a, r) => a + Number(r.tickets_open ?? 0),
    0,
  );
  const maintBySite = groupSum(maint, "site_code", [
    "tickets_open",
    "spend_gbp",
  ])
    .sort((a, b) => Number(b.tickets_open) - Number(a.tickets_open))
    .slice(0, 6);

  return (
    <div className="space-y-5">
      {/* LAYER 1 — OPS VISUAL SUMMARY PLINTH */}
      <section
        aria-label="Operations executive summary"
        className="plinth overflow-hidden rounded-2xl ring-1 ring-white/[0.08]"
      >
        <div className="grid gap-8 p-6 sm:p-7 lg:grid-cols-12 lg:items-end">
          <div className="space-y-5 lg:col-span-7">
            <p className="text-xs font-medium text-[var(--ink-muted)]">
              Operations · {occupancy.length} sites in scope
              {occupancy.length < 25 ? " (London row-level security)" : " (Full estate)"}
            </p>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <p className={`type-display ${HERO_NUM}`}>
                {occPct.toFixed(1)}
                <span className="ml-0.5 text-[0.55em] text-[var(--ink-muted)]">%</span>
              </p>
              <span className="text-sm text-[var(--ink-muted)]">
                estate occupancy ({unitsOcc} of {unitsTotal} units)
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-x-6 border-t border-white/10 pt-5">
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">
                  Expired certs
                </dt>
                <dd
                  className={`type-heading mt-1 text-lg type-data ${
                    certCounts.EXPIRED > 0
                      ? "text-[var(--blocked-ink)]"
                      : "text-[var(--good-ink)]"
                  }`}
                >
                  {certCounts.EXPIRED}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">
                  Due within 30d
                </dt>
                <dd className="type-heading mt-1 text-lg type-data text-[var(--attention-ink)]">
                  {certCounts.due_30d}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">
                  Open tickets
                </dt>
                <dd className="type-heading mt-1 text-lg type-data">
                  {openTickets}
                </dd>
              </div>
            </dl>
          </div>

          <div className="space-y-3 border-t border-white/10 pt-5 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium text-[var(--ink)]">
                Compliance certificate health
              </span>
              <span className="type-data text-[var(--ink-muted)]">
                {certs.length} tracked
              </span>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--track)]">
              <div
                className="grow-x h-full bg-[var(--good)]"
                style={{ width: `${(certCounts.ok / totalCerts) * 100}%` }}
              />
              <div
                className="grow-x h-full bg-[#ca8a04]"
                style={{ width: `${(certCounts.due_90d / totalCerts) * 100}%` }}
              />
              <div
                className="grow-x h-full bg-[var(--attention)]"
                style={{ width: `${(certCounts.due_30d / totalCerts) * 100}%` }}
              />
              <div
                className="grow-x h-full bg-[var(--blocked)]"
                style={{ width: `${(certCounts.EXPIRED / totalCerts) * 100}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs type-data text-[var(--ink-muted)]">
              <span>
                OK <strong className="text-[var(--ink)]">{certCounts.ok}</strong>
              </span>
              <span>
                Due 90d <strong className="text-[var(--ink)]">{certCounts.due_90d}</strong>
              </span>
              <span>
                Due 30d <strong className="text-[var(--attention-ink)]">{certCounts.due_30d}</strong>
              </span>
              <span>
                Expired <strong className="text-[var(--blocked-ink)]">{certCounts.EXPIRED}</strong>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* LAYER 2 — DETAILED OPS SHEETS */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 flex flex-col gap-5 lg:col-span-4">
          <Sheet
            title="Compliance needing action"
            description="An expired certificate closes a kitchen"
            action={
              <RegisterLink
                label="Open register"
                onClick={() => onOpenRegister("vw_ops_compliance_expiry")}
              />
            }
          >
            {urgentCerts.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">
                No expired or expiring certificates in the next 30 days.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {urgentCerts.map((c, i) => {
                  const days = Number(c.days_to_expiry ?? 0);
                  return (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium capitalize text-[var(--ink)]">
                          <span className="font-mono">{String(c.site_code)}</span> ·{" "}
                          {String(c.kind).replaceAll("_", " ")}
                        </p>
                        <p className="text-xs type-data text-[var(--ink-muted)]">
                          {days < 0
                            ? `${Math.abs(days)}d overdue`
                            : `Expires in ${days}d`}
                        </p>
                      </div>
                      <StatusPill value={String(c.status)} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Sheet>

          <Sheet
            title="Maintenance load"
            description="Sites with the highest open ticket count"
            action={
              <RegisterLink
                label="Open register"
                onClick={() => onOpenRegister("vw_ops_maintenance_load")}
              />
            }
          >
            <ul className="divide-y divide-[var(--border)]">
              {maintBySite.map((m) => (
                <li
                  key={String(m.site_code)}
                  className="flex items-center justify-between py-2.5 text-sm"
                >
                  <div>
                    <p className="font-mono font-medium text-[var(--ink)]">
                      {String(m.site_code)}
                    </p>
                    <p className="text-xs type-data text-[var(--ink-muted)]">
                      Spend {gbp(Number(m.spend_gbp))}
                    </p>
                  </div>
                  <span className="type-data font-semibold text-[var(--ink)]">
                    {Number(m.tickets_open)} open
                  </span>
                </li>
              ))}
            </ul>
          </Sheet>
        </div>

        <div className="col-span-12 flex flex-col gap-5 lg:col-span-8">
          <ChartCard
            title="Utility cost by month"
            note="All utilities across granted sites — complete months only"
            action={
              <RegisterLink
                label="Open utilities"
                onClick={() => onOpenRegister("vw_ops_utility_intensity")}
              />
            }
          >
            <TrendLine
              data={utilByMonth}
              x="month"
              unit="£"
              series={[{ key: "cost_gbp", label: "Utility cost" }]}
            />
          </ChartCard>

          <ChartCard
            title="Occupancy by site"
            note="Lowest occupancy first — relet priority worklist"
            action={
              <RegisterLink
                label="Open occupancy"
                onClick={() => onOpenRegister("vw_ops_site_occupancy")}
              />
            }
          >
            <BarRank
              data={occBars}
              x="site_code"
              y="occupancy_pct"
              unit=""
              height={270}
            />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- SALES
export function SalesOverview({
  token,
  onOpenRegister,
}: {
  token: string;
  onOpenRegister: (view: string) => void;
}) {
  const polled = usePolled(
    `sales-briefing:${token}`,
    () =>
      Promise.all([
        fetchView(token, "vw_sales_pipeline", 2000),
        fetchView(token, "vw_sales_conversion", 2000),
        fetchView(token, "vw_sales_churn_risk", 2000),
      ]),
    POLL_MS,
  );

  if (polled.error) return <ErrorBanner message={polled.error} />;
  if (!polled.data) return <BriefingSkeleton />;

  const [pipeline, conversion, churn] = polled.data.map((d) => d.rows);

  const STAGES = ["new", "qualified", "viewing", "proposal"];
  const byStage = STAGES.map((s) => ({
    stage: s,
    value: pipeline
      .filter((r) => r.stage === s)
      .reduce((a, r) => a + Number(r.pipeline_value_monthly_gbp ?? 0), 0),
  }));
  const pipelineValue = byStage.reduce((a, r) => a + r.value, 0);
  const maxStageVal = Math.max(1, ...byStage.map((s) => s.value));

  const cohorts = excludePartialPeriod(
    groupSum(conversion, "cohort_month", ["enquiries", "won", "lost"]),
  ).map((p) => ({
    ...p,
    month: monthLabel(p.cohort_month),
    win_rate_pct:
      Number(p.won) + Number(p.lost) > 0
        ? Math.round((1000 * Number(p.won)) / (Number(p.won) + Number(p.lost))) /
          10
        : null,
  }));

  const won = conversion.reduce((a, r) => a + Number(r.won), 0);
  const lost = conversion.reduce((a, r) => a + Number(r.lost), 0);
  const winRate = (100 * won) / Math.max(won + lost, 1);

  const highRiskRows = churn
    .filter((r) => r.risk_flag === "high")
    .sort((a, b) => Number(b.monthly_fee_gbp ?? 0) - Number(a.monthly_fee_gbp ?? 0));
  const atRiskMonthly = highRiskRows.reduce(
    (a, r) => a + Number(r.monthly_fee_gbp ?? 0),
    0,
  );

  return (
    <div className="space-y-5">
      {/* LAYER 1 — SALES VISUAL SUMMARY PLINTH */}
      <section
        aria-label="Partnerships executive summary"
        className="plinth overflow-hidden rounded-2xl ring-1 ring-white/[0.08]"
      >
        <div className="grid gap-8 p-6 sm:p-7 lg:grid-cols-12 lg:items-end">
          <div className="space-y-5 lg:col-span-7">
            <p className="text-xs font-medium text-[var(--ink-muted)]">
              Partnerships Lead · {churn.length} active licences
            </p>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <p className={`type-display ${HERO_NUM}`}>{gbp(pipelineValue)}</p>
              <span className="text-sm text-[var(--ink-muted)]">
                open monthly pipeline
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-x-6 border-t border-white/10 pt-5">
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">Win rate</dt>
                <dd className="type-heading mt-1 text-lg type-data text-[var(--series)]">
                  {winRate.toFixed(0)}%
                </dd>
                <dd className="text-[11px] type-data text-[var(--ink-muted)]">
                  {won} won · {lost} lost
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">
                  High churn risk
                </dt>
                <dd className="type-heading mt-1 text-lg type-data text-[var(--blocked-ink)]">
                  {highRiskRows.length}
                </dd>
                <dd className="text-[11px] type-data text-[var(--ink-muted)]">
                  {gbp(atRiskMonthly)}/mo at risk
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">
                  Active licences
                </dt>
                <dd className="type-heading mt-1 text-lg type-data">
                  {churn.length}
                </dd>
              </div>
            </dl>
          </div>

          <div className="space-y-2.5 border-t border-white/10 pt-5 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <h2 className="type-heading text-xs text-[var(--ink)]">
              Pipeline by stage
            </h2>
            <ul className="space-y-2">
              {byStage.map((s, idx) => (
                <li key={s.stage} className="space-y-1">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="capitalize text-[var(--ink-muted)]">
                      {s.stage}
                    </span>
                    <span className="type-data font-semibold text-[var(--ink)]">
                      {gbp(s.value)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--track)]">
                    <div
                      className="grow-x h-full rounded-full bg-[var(--series)]"
                      style={{
                        width: `${Math.max(4, (s.value / maxStageVal) * 100)}%`,
                        ["--grow-delay" as string]: `${100 + idx * 60}ms`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* LAYER 2 — DETAILED SALES SHEETS */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-4">
          <Sheet
            title="High churn risk"
            description="Prioritised by monthly licence fee"
            action={
              <RegisterLink
                label="Open register"
                onClick={() => onOpenRegister("vw_sales_churn_risk")}
              />
            }
          >
            {highRiskRows.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">
                No licences flagged high churn risk.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {highRiskRows.slice(0, 6).map((r, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[var(--ink)]">
                        {String(r.trading_name)}
                      </p>
                      <p className="text-xs type-data text-[var(--ink-muted)]">
                        <span className="font-mono">{String(r.site_code)}</span> ·{" "}
                        {Number(r.overdue_invoices ?? 0)} overdue
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold type-data text-[var(--blocked-ink)]">
                      {gbp(Number(r.monthly_fee_gbp ?? 0))}/mo
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Sheet>
        </div>

        <div className="col-span-12 grid gap-5 lg:col-span-8 sm:grid-cols-2">
          <ChartCard
            title="Enquiries per cohort month"
            note="Complete cohort months"
            action={
              <RegisterLink
                label="Open conversion"
                onClick={() => onOpenRegister("vw_sales_conversion")}
              />
            }
          >
            <TrendLine
              data={cohorts}
              x="month"
              series={[{ key: "enquiries", label: "Enquiries" }]}
            />
          </ChartCard>
          <ChartCard
            title="Win rate per cohort month"
            note="Percentage of closed enquiries won"
          >
            <TrendLine
              data={cohorts}
              x="month"
              unit=""
              series={[{ key: "win_rate_pct", label: "Win rate %" }]}
            />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
