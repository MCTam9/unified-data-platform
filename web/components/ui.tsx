"use client";
import { useMemo, useState } from "react";
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
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

const fmtDate = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

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
  if (ISO_DATE.test(s) && (col.endsWith("_on") || col.endsWith("_date")
      || col === "period" || col.endsWith("_month") || col.startsWith("period"))) {
    return <span className="whitespace-nowrap">{fmtDate(s)}</span>;
  }
  return <span>{s}</span>;
}

function toCsv(rows: Row[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function DataTable({ rows, maxRows = 40, exportName = "export" }: {
  rows: Row[]; maxRows?: number; exportName?: string;
}) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [filter, setFilter] = useState("");

  const cols = rows.length ? Object.keys(rows[0]) : [];
  const numericCols = useMemo(
    () => new Set(cols.filter((c) => rows.some((r) => typeof r[c] === "number"))),
    [cols, rows]);

  const visible = useMemo(() => {
    let out = rows;
    if (filter.trim()) {
      const q = filter.toLowerCase();
      out = out.filter((r) =>
        Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)));
    }
    if (sortCol) {
      out = [...out].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        if (typeof av === "number" && typeof bv === "number")
          return (av - bv) * sortDir;
        return String(av).localeCompare(String(bv)) * sortDir;
      });
    }
    return out;
  }, [rows, filter, sortCol, sortDir]);

  if (!rows.length)
    return <p className="text-sm text-neutral-500 py-6">No rows.</p>;

  const shown = visible.slice(0, maxRows);

  function clickHeader(c: string) {
    if (sortCol === c) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortCol(c); setSortDir(1); }
  }

  function downloadCsv() {
    const blob = new Blob([toCsv(visible)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {rows.length > 10 && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter rows…"
            className="w-56 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-3 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
          />
        )}
        <span className="text-xs text-neutral-500">
          {visible.length !== rows.length ? `${visible.length} of ${rows.length} rows` : `${rows.length} rows`}
        </span>
        <button onClick={downloadCsv}
          className="ml-auto rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:border-neutral-500">
          Download CSV
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
              {cols.map((c) => (
                <th key={c}
                  onClick={() => clickHeader(c)}
                  className={`cursor-pointer select-none px-3 py-2 font-medium text-neutral-500 dark:text-neutral-400 whitespace-nowrap hover:text-neutral-800 dark:hover:text-neutral-200 ${
                    numericCols.has(c) ? "text-right" : "text-left"}`}>
                  {c.replaceAll("_", " ")}
                  {sortCol === c && <span className="ml-1">{sortDir === 1 ? "↑" : "↓"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="border-b border-neutral-100 dark:border-neutral-900 last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
                {cols.map((c) => (
                  <td key={c}
                    className={`px-3 py-1.5 whitespace-nowrap text-neutral-800 dark:text-neutral-200 ${
                      numericCols.has(c) ? "text-right" : "text-left"}`}>
                    <Cell col={c} value={r[c]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length > maxRows && (
          <p className="px-3 py-2 text-xs text-neutral-500">
            Showing {maxRows} of {visible.length} rows — filter to narrow, or download the CSV for everything
          </p>
        )}
      </div>
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

export function TableSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-72 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />
    </div>
  );
}
