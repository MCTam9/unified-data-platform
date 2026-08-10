"use client";
import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// Categorical palette, validated with the dataviz six-checks validator for
// both surfaces (light: #2563eb/#d97706, dark: #3b82f6/#d97706). Color
// follows the entity — a series keeps its hue everywhere it appears.
// Status colors are the reserved pill palette, never reused for series.
const LIGHT = { s1: "#2563eb", s2: "#d97706", grid: "#e5e5e4", ink: "#525250", surface: "#ffffff" };
const DARK = { s1: "#3b82f6", s2: "#d97706", grid: "#2e2e2c", ink: "#a3a39f", surface: "#0a0a0a" };

export const STATUS_COLORS: Record<string, string> = {
  ok: "#059669", due_90d: "#ca8a04", due_30d: "#d97706", EXPIRED: "#dc2626",
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
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k` : String(v);

function tooltipStyle(t: typeof LIGHT) {
  return {
    backgroundColor: t.surface,
    border: `1px solid ${t.grid}`,
    borderRadius: 8,
    fontSize: 12,
    color: t.ink,
  } as const;
}

/** Multi-series line chart. Series keep fixed hues; one y-axis, always. */
export function TrendLine({ data, x, series, unit = "" }: {
  data: Point[]; x: string;
  series: { key: string; label: string }[]; unit?: string;
}) {
  const t = useTheme();
  const hues = [t.s1, t.s2];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey={x} tick={{ fontSize: 11, fill: t.ink }} tickLine={false}
          axisLine={{ stroke: t.grid }} />
        <YAxis tick={{ fontSize: 11, fill: t.ink }} tickLine={false}
          axisLine={false} tickFormatter={fmtCompact} width={44} />
        <Tooltip contentStyle={tooltipStyle(t)}
          formatter={(v) => [`${unit}${Number(v).toLocaleString("en-GB")}`, undefined]} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Line key={s.key} isAnimationActive={false} dataKey={s.key} name={s.label} type="monotone"
            stroke={hues[i % hues.length]} strokeWidth={2}
            dot={false} activeDot={{ r: 4 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Single-measure bar ranking. One hue — identity is the axis label, not color. */
export function BarRank({ data, x, y, unit = "", height = 240, statusKey }: {
  data: Point[]; x: string; y: string; unit?: string; height?: number;
  /** color bars by STATUS_COLORS[row[statusKey]] instead of the series hue */
  statusKey?: string;
}) {
  const t = useTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid stroke={t.grid} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey={x} tick={{ fontSize: 10, fill: t.ink }} tickLine={false}
          axisLine={{ stroke: t.grid }} interval={0}
          angle={data.length > 4 ? -30 : 0}
          textAnchor={data.length > 4 ? "end" : "middle"}
          height={data.length > 4 ? 76 : 24} />
        <YAxis tick={{ fontSize: 11, fill: t.ink }} tickLine={false}
          axisLine={false} tickFormatter={fmtCompact} width={44} />
        <Tooltip contentStyle={tooltipStyle(t)} cursor={{ fill: t.grid, opacity: 0.4 }}
          formatter={(v) => [`${unit}${Number(v).toLocaleString("en-GB")}`, undefined]} />
        <Bar dataKey={y} isAnimationActive={false} radius={[4, 4, 0, 0]}>
          {data.map((row, i) => (
            <Cell key={i}
              fill={statusKey ? STATUS_COLORS[String(row[statusKey])] ?? t.s1 : t.s1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Part-to-whole donut, <=4 slices, reserved status colors, labelled legend —
 *  identity is never color-alone. */
export function StatusDonut({ data, nameKey, valueKey, centerLabel }: {
  data: Point[]; nameKey: string; valueKey: string; centerLabel?: string;
}) {
  const t = useTheme();
  const total = data.reduce((a, r) => a + Number(r[valueKey] ?? 0), 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} isAnimationActive={false} dataKey={valueKey} nameKey={nameKey}
            innerRadius={62} outerRadius={92} paddingAngle={2} stroke={t.surface}>
            {data.map((row, i) => (
              <Cell key={i} fill={STATUS_COLORS[String(row[nameKey])] ?? t.s1} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle(t)}
            formatter={(v, name) => [
              `${Number(v).toLocaleString("en-GB")} (${((Number(v) / total) * 100).toFixed(1)}%)`,
              String(name),
            ]} />
          <Legend wrapperStyle={{ fontSize: 12 }}
            formatter={(value, entry) =>
              `${value} — ${Number((entry?.payload as Point | undefined)?.[valueKey] ?? 0).toLocaleString("en-GB")}`} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-8">
        <div className="text-center">
          <p className="text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
            {total.toLocaleString("en-GB")}
          </p>
          {centerLabel && <p className="text-xs text-neutral-500">{centerLabel}</p>}
        </div>
      </div>
    </div>
  );
}

export function ChartCard({ title, note, children }: {
  title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
        {note && <p className="text-xs text-neutral-500">{note}</p>}
      </div>
      {children}
    </div>
  );
}
