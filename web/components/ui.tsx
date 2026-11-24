"use client";
import { useMemo, useState } from "react";
import { Row, gbp } from "@/lib/api";

// Status badges carry text + colour, never colour alone.
const STATUS_TONE: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  EXPIRED: { bg: "bg-[var(--blocked-soft)]", text: "text-[var(--blocked-ink)]", dot: "bg-[var(--blocked)]", label: "Expired" },
  due_30d: { bg: "bg-[var(--attention-soft)]", text: "text-[var(--attention-ink)]", dot: "bg-[var(--attention)]", label: "Due 30d" },
  due_90d: { bg: "bg-[var(--attention-soft)]", text: "text-[var(--attention-ink)]", dot: "bg-[var(--attention)]", label: "Due 90d" },
  ok: { bg: "bg-[var(--good-soft)]", text: "text-[var(--good-ink)]", dot: "bg-[var(--good)]", label: "OK" },
  red: { bg: "bg-[var(--blocked-soft)]", text: "text-[var(--blocked-ink)]", dot: "bg-[var(--blocked)]", label: "Red" },
  amber: { bg: "bg-[var(--attention-soft)]", text: "text-[var(--attention-ink)]", dot: "bg-[var(--attention)]", label: "Amber" },
  green: { bg: "bg-[var(--good-soft)]", text: "text-[var(--good-ink)]", dot: "bg-[var(--good)]", label: "Green" },
  high: { bg: "bg-[var(--blocked-soft)]", text: "text-[var(--blocked-ink)]", dot: "bg-[var(--blocked)]", label: "High" },
  medium: { bg: "bg-[var(--attention-soft)]", text: "text-[var(--attention-ink)]", dot: "bg-[var(--attention)]", label: "Medium" },
  low: { bg: "bg-[var(--good-soft)]", text: "text-[var(--good-ink)]", dot: "bg-[var(--good)]", label: "Low" },
  overdue: { bg: "bg-[var(--blocked-soft)]", text: "text-[var(--blocked-ink)]", dot: "bg-[var(--blocked)]", label: "Overdue" },
  "90+": { bg: "bg-[var(--blocked-soft)]", text: "text-[var(--blocked-ink)]", dot: "bg-[var(--blocked)]", label: "90+ days" },
  "61-90": { bg: "bg-[var(--attention-soft)]", text: "text-[var(--attention-ink)]", dot: "bg-[var(--attention)]", label: "61–90 days" },
  "31-60": { bg: "bg-[var(--attention-soft)]", text: "text-[var(--attention-ink)]", dot: "bg-[var(--attention)]", label: "31–60 days" },
  "0-30": { bg: "bg-[var(--subtle)]", text: "text-[var(--ink-muted)]", dot: "bg-[var(--ink-muted)]", label: "0–30 days" },
  no_data: { bg: "bg-[var(--subtle)]", text: "text-[var(--ink-muted)]", dot: "bg-[var(--ink-muted)]", label: "No data" },
};

const PILL_COLUMNS = new Set(["status", "rag", "risk_flag", "ageing_bucket"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

const fmtDate = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

function formatColHeader(col: string): string {
  const withCurrency = col.endsWith("_gbp") ? `${col.slice(0, -4)} (£)` : col;
  const spaced = withCurrency.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function StatusPill({ value }: { value: string }) {
  const tone = STATUS_TONE[value];
  if (!tone) return <span>{value}</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.bg} ${tone.text}`}>
      <span className={`size-1.5 rounded-full ${tone.dot}`} aria-hidden />
      {tone.label}
    </span>
  );
}

function Cell({ col, value }: { col: string; value: unknown }) {
  if (value === null || value === undefined)
    return <span className="text-[var(--ink-muted)] opacity-50">—</span>;
  const s = String(value);
  if (PILL_COLUMNS.has(col) && STATUS_TONE[s]) {
    return <StatusPill value={s} />;
  }
  if (typeof value === "number") {
    const money = col.endsWith("_gbp") || col.includes("gap");
    return (
      <span className="type-data">
        {money ? gbp(value) : value.toLocaleString("en-GB")}
      </span>
    );
  }
  if (
    ISO_DATE.test(s) &&
    (col.endsWith("_on") ||
      col.endsWith("_date") ||
      col === "period" ||
      col.endsWith("_month") ||
      col.startsWith("period"))
  ) {
    return <span className="whitespace-nowrap type-data">{fmtDate(s)}</span>;
  }
  if (col === "exception_type" || col === "kind") {
    const label = s.replaceAll("_", " ");
    return <span>{label.charAt(0).toUpperCase() + label.slice(1)}</span>;
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

export type RowAction = {
  /** Only rows matching this predicate get a button. */
  applies: (row: Row) => boolean;
  label: string;
  busyLabel: string;
  doneLabel: string;
  run: (row: Row) => Promise<string>;
};

/** Crisp institutional sheet with subtle 1px hairline border. */
export function Sheet({
  title,
  description,
  action,
  className = "",
  bodyClassName = "",
  children,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--ink)] ${className}`}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-5 pt-5 pb-3">
          <div className="min-w-0">
            {title && (
              <h2 className="type-heading text-[1.0625rem] text-[var(--ink)]">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-[var(--ink-muted)]">
                {description}
              </p>
            )}
          </div>
          {action}
        </header>
      )}
      <div className={`px-5 pb-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function DataTable({
  rows,
  maxRows = 50,
  exportName = "export",
  action,
  onNotify,
}: {
  rows: Row[];
  maxRows?: number;
  exportName?: string;
  action?: RowAction;
  onNotify?: (message: string, isError?: boolean) => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const [localToast, setLocalToast] = useState<{ text: string; isError?: boolean } | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [filter, setFilter] = useState("");

  const cols = rows.length ? Object.keys(rows[0]) : [];
  const numericCols = useMemo(
    () => new Set(cols.filter((c) => rows.some((r) => typeof r[c] === "number"))),
    [cols, rows],
  );

  const visible = useMemo(() => {
    let out = rows;
    if (filter.trim()) {
      const q = filter.toLowerCase();
      out = out.filter((r) =>
        Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)),
      );
    }
    if (sortCol) {
      out = [...out].sort((a, b) => {
        const av = a[sortCol],
          bv = b[sortCol];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        if (typeof av === "number" && typeof bv === "number")
          return (av - bv) * sortDir;
        return String(av).localeCompare(String(bv)) * sortDir;
      });
    }
    return out;
  }, [rows, filter, sortCol, sortDir]);

  if (!rows.length) {
    return (
      <div className="rounded-xl bg-[var(--subtle)] px-5 py-12 text-center text-sm text-[var(--ink-muted)]">
        No rows returned for this view.
      </div>
    );
  }

  const shown = visible.slice(0, maxRows);

  function clickHeader(c: string) {
    if (sortCol === c) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortCol(c);
      setSortDir(1);
    }
  }

  const rowKey = (r: Row) => JSON.stringify(Object.values(r).slice(0, 3));

  async function runAction(row: Row) {
    if (!action) return;
    const key = rowKey(row);
    setBusyKey(key);
    try {
      const message = await action.run(row);
      setDoneKeys((d) => new Set(d).add(key));
      if (onNotify) onNotify(message, false);
      else {
        setLocalToast({ text: message });
        setTimeout(() => setLocalToast(null), 6000);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action failed";
      if (onNotify) onNotify(msg, true);
      else {
        setLocalToast({ text: msg, isError: true });
        setTimeout(() => setLocalToast(null), 6000);
      }
    } finally {
      setBusyKey(null);
    }
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
    <div className="space-y-3">
      {localToast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 flex max-w-md items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
            localToast.isError
              ? "bg-[var(--blocked-soft)] text-[var(--blocked-ink)]"
              : "bg-[var(--ink)] text-[var(--card)]"
          }`}
        >
          <span className="flex-1 leading-snug">{localToast.text}</span>
          <button
            type="button"
            onClick={() => setLocalToast(null)}
            className="shrink-0 text-xs font-medium opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Fixed-height toolbar row */}
      <div className="flex h-9 items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {rows.length > 5 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter rows…"
              aria-label="Filter rows"
              className="h-9 w-64 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--ink)] focus:outline-none"
            />
          )}
          <span className="text-xs font-medium type-data text-[var(--ink-muted)]">
            {visible.length !== rows.length
              ? `${visible.length} of ${rows.length} rows`
              : `${rows.length} rows`}
          </span>
        </div>
        <button
          type="button"
          onClick={downloadCsv}
          className="inline-flex h-9 shrink-0 items-center rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-medium text-[var(--ink)] transition-colors duration-150 hover:bg-[var(--subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]"
        >
          Export CSV
        </button>
      </div>

      <div className="max-h-[calc(100vh-300px)] min-h-[320px] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[var(--subtle)]">
              {cols.map((c) => (
                <th
                  key={c}
                  onClick={() => clickHeader(c)}
                  title={`Sort by ${formatColHeader(c)}`}
                  className={`cursor-pointer select-none whitespace-nowrap border-b border-[var(--border)] bg-[var(--subtle)] px-3.5 py-2.5 text-xs font-semibold text-[var(--ink-muted)] transition-colors duration-150 hover:text-[var(--ink)] ${
                    numericCols.has(c) ? "text-right" : "text-left"
                  }`}
                >
                  <span>{formatColHeader(c)}</span>
                  <span className="ml-1 inline-flex w-3 justify-center text-xs text-[var(--ink)]">
                    {sortCol === c ? (sortDir === 1 ? "↑" : "↓") : ""}
                  </span>
                </th>
              ))}
              {action && (
                <th className="sticky right-0 w-[136px] min-w-[136px] border-b border-l border-[var(--border)] bg-[var(--subtle)] px-3 py-2.5 text-right text-xs font-semibold text-[var(--ink-muted)]">
                  Action
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {shown.map((r, i) => {
              const key = rowKey(r);
              const isBusy = busyKey === key;
              const isDone = doneKeys.has(key);
              return (
                <tr
                  key={i}
                  className="transition-colors duration-100 hover:bg-[var(--background)]"
                >
                  {cols.map((c, ci) => (
                    <td
                      key={c}
                      className={`whitespace-nowrap px-3.5 py-2.5 ${
                        ci === 0
                          ? "font-medium text-[var(--ink)]"
                          : "text-[var(--ink)] opacity-90"
                      } ${numericCols.has(c) ? "text-right" : "text-left"}`}
                    >
                      <Cell col={c} value={r[c]} />
                    </td>
                  ))}
                  {action && (
                    <td className="sticky right-0 w-[136px] min-w-[136px] border-l border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-right">
                      {action.applies(r) ? (
                        isDone ? (
                          <span className="inline-flex h-7 w-[112px] items-center justify-center rounded-md bg-[var(--good-soft)] text-xs font-medium text-[var(--good-ink)]">
                            {action.doneLabel}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => runAction(r)}
                            disabled={isBusy}
                            className="inline-flex h-7 w-[112px] items-center justify-center whitespace-nowrap rounded-md bg-[var(--ink)] text-xs font-medium text-[var(--card)] transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] disabled:opacity-45"
                          >
                            {isBusy ? action.busyLabel : action.label}
                          </button>
                        )
                      ) : (
                        <span className="inline-block h-7 w-[112px]" aria-hidden />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {visible.length > maxRows && (
        <p className="text-xs text-[var(--ink-muted)]">
          Showing first {maxRows} of {visible.length} rows. Use the filter or export CSV for the full dataset.
        </p>
      )}
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex h-9 items-center justify-between">
        <div className="h-9 w-64 animate-pulse rounded-lg bg-[var(--subtle)]" />
        <div className="h-9 w-24 animate-pulse rounded-lg bg-[var(--subtle)]" />
      </div>
      <div className="h-[360px] animate-pulse rounded-xl bg-[var(--subtle)]" />
    </div>
  );
}
