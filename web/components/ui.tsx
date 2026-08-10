"use client";
import { Row, gbp } from "@/lib/api";

// Values wear text tokens; a status pill is never color-alone — it always
// carries its label text.
const STATUS_STYLES: Record<string, string> = {
  EXPIRED: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  due_30d: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  due_90d: "bg-yellow-50 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200",
  ok: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  red: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  green: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  high: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  medium: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  low: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  overdue: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  no_data: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

const PILL_COLUMNS = new Set(["status", "rag", "risk_flag", "ageing_bucket"]);

function Cell({ col, value }: { col: string; value: unknown }) {
  if (value === null || value === undefined)
    return <span className="text-neutral-400">—</span>;
  const s = String(value);
  if (PILL_COLUMNS.has(col) && STATUS_STYLES[s]) {
    return (
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s]}`}>
        {s}
      </span>
    );
  }
  if (typeof value === "number") {
    const money = col.endsWith("_gbp") || col.includes("gap");
    return (
      <span className="tabular-nums">
        {money ? gbp(value) : value.toLocaleString("en-GB")}
      </span>
    );
  }
  return <span>{s}</span>;
}

export function DataTable({ rows, maxRows = 40 }: { rows: Row[]; maxRows?: number }) {
  if (!rows.length)
    return <p className="text-sm text-neutral-500 py-6">No rows.</p>;
  const cols = Object.keys(rows[0]);
  const shown = rows.slice(0, maxRows);
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                {c.replaceAll("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="border-b border-neutral-100 dark:border-neutral-900 last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
              {cols.map((c) => (
                <td key={c} className="px-3 py-1.5 whitespace-nowrap text-neutral-800 dark:text-neutral-200">
                  <Cell col={c} value={r[c]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && (
        <p className="px-3 py-2 text-xs text-neutral-500">
          Showing {maxRows} of {rows.length} rows
        </p>
      )}
    </div>
  );
}

export function StatTile({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: "bad" | "good" | "neutral";
}) {
  const valueColor =
    tone === "bad" ? "text-red-700 dark:text-red-400"
    : tone === "good" ? "text-emerald-700 dark:text-emerald-400"
    : "text-neutral-900 dark:text-neutral-50";
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}

export function Section({ title, note, children }: {
  title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-3">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        {note && <p className="text-xs text-neutral-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}
