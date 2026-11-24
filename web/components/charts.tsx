"use client";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Institutional finance palette: graphite ink for primary measure, deep teal
// for cash/secondary comparison. Status colours stay strictly on status.
const LIGHT = {
  s1: "#0f172a",
  s2: "#0f766e",
  grid: "#e2e6ed",
  ink: "#526071",
  surface: "#ffffff",
};
const DARK = {
  s1: "#e2e8f0",
  s2: "#2dd4bf",
  grid: "#253142",
  ink: "#93a1b2",
  surface: "#161f2b",
};

export const STATUS_COLORS: Record<string, string> = {
  ok: "#15803d",
  due_90d: "#ca8a04",
  due_30d: "#d97706",
  EXPIRED: "#dc2626",
};

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const fn = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return dark ? DARK : LIGHT;
}

export type Point = Record<string, string | number | null>;

const fmtCompact = (v: number) =>
  Math.abs(v) >= 1000
    ? `${(v / 1000).toFixed(Math.abs(v) >= 100000 ? 0 : 1)}k`
    : String(v);

function tooltipStyle(t: typeof LIGHT) {
  return {
    backgroundColor: t.surface,
    border: `1px solid ${t.grid}`,
    borderRadius: 10,
    fontSize: 12,
    color: t.ink,
    boxShadow: "0 6px 18px rgba(20, 26, 33, 0.08)",
  } as const;
}

/** Multi-series line chart. Series keep fixed hues; one y-axis, always. */
export function TrendLine({
  data,
  x,
  series,
  unit = "",
  height = 240,
}: {
  data: Point[];
  x: string;
  series: { key: string; label: string }[];
  unit?: string;
  height?: number;
}) {
  const t = useTheme();
  const hues = [t.s1, t.s2];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey={x}
          tick={{ fontSize: 12, fill: t.ink }}
          tickLine={false}
          axisLine={{ stroke: t.grid }}
        />
        <YAxis
          tick={{ fontSize: 12, fill: t.ink }}
          tickLine={false}
          axisLine={false}
          tickFormatter={fmtCompact}
          width={48}
        />
        <Tooltip
          contentStyle={tooltipStyle(t)}
          formatter={(v) => [
            `${unit}${Number(v).toLocaleString("en-GB")}`,
            undefined,
          ]}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Line
            key={s.key}
            isAnimationActive={false}
            dataKey={s.key}
            name={s.label}
            type="monotone"
            stroke={hues[i % hues.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Single-measure bar ranking. Neutral ink by default — red only for negative/alert if signalled. */
export function BarRank({
  data,
  x,
  y,
  unit = "",
  height = 240,
  statusKey,
}: {
  data: Point[];
  x: string;
  y: string;
  unit?: string;
  height?: number;
  statusKey?: string;
}) {
  const t = useTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
        barCategoryGap="24%"
      >
        <CartesianGrid stroke={t.grid} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey={x}
          tick={{ fontSize: 11, fill: t.ink }}
          tickLine={false}
          axisLine={{ stroke: t.grid }}
          interval={0}
          angle={data.length > 6 ? -35 : 0}
          textAnchor={data.length > 6 ? "end" : "middle"}
          height={data.length > 6 ? 76 : 26}
        />
        <YAxis
          tick={{ fontSize: 12, fill: t.ink }}
          tickLine={false}
          axisLine={false}
          tickFormatter={fmtCompact}
          width={48}
        />
        <Tooltip
          contentStyle={tooltipStyle(t)}
          cursor={{ fill: t.grid, opacity: 0.35 }}
          formatter={(v) => [
            `${unit}${Number(v).toLocaleString("en-GB")}`,
            undefined,
          ]}
        />
        <Bar dataKey={y} isAnimationActive={false} radius={[4, 4, 0, 0]}>
          {data.map((row, i) => (
            <Cell
              key={i}
              fill={
                statusKey ? STATUS_COLORS[String(row[statusKey])] ?? t.s1 : t.s1
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Part-to-whole donut, <=4 slices, reserved status colors, labelled legend. */
export function StatusDonut({
  data,
  nameKey,
  valueKey,
  centerLabel,
}: {
  data: Point[];
  nameKey: string;
  valueKey: string;
  centerLabel?: string;
}) {
  const t = useTheme();
  const total = data.reduce((a, r) => a + Number(r[valueKey] ?? 0), 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            isAnimationActive={false}
            dataKey={valueKey}
            nameKey={nameKey}
            innerRadius={64}
            outerRadius={92}
            paddingAngle={2}
            stroke={t.surface}
          >
            {data.map((row, i) => (
              <Cell
                key={i}
                fill={STATUS_COLORS[String(row[nameKey])] ?? t.s1}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={tooltipStyle(t)}
            formatter={(v, name) => [
              `${Number(v).toLocaleString("en-GB")} (${(
                (Number(v) / Math.max(total, 1)) *
                100
              ).toFixed(1)}%)`,
              String(name),
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value, entry) =>
              `${value} — ${Number(
                (entry?.payload as Point | undefined)?.[valueKey] ?? 0,
              ).toLocaleString("en-GB")}`
            }
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-8">
        <div className="text-center">
          <p className="type-heading text-2xl type-data text-[var(--ink)]">
            {total.toLocaleString("en-GB")}
          </p>
          {centerLabel && (
            <p className="text-xs text-[var(--ink-muted)]">{centerLabel}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Crisp finance-ops chart sheet with hairline edge. */
export function ChartCard({
  title,
  note,
  action,
  className = "",
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-[var(--ink)] ${className}`}
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="type-heading text-[1.0625rem] text-[var(--ink)]">
            {title}
          </h3>
          {note && (
            <p className="text-sm text-[var(--ink-muted)]">{note}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
