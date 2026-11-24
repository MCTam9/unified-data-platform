"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { askAgent, Row } from "@/lib/api";
import { DataTable } from "./ui";

type Exchange = {
  question: string;
  answer?: string;
  queries?: { sql: string; purpose: string; rows: Row[]; error?: string }[];
  error?: string;
  pending?: boolean;
};

type Size = { w: number; h: number };

const DEFAULT_SIZE: Size = { w: 420, h: 540 };
const MIN_SIZE: Size = { w: 320, h: 360 };
const SIZE_KEY = "encore:agent-dock-size";
const BOTTOM_PX = 84;
const SIDE_PX = 24;
const TOP_ROOM_PX = 72;

const SUGGESTIONS: Record<string, string[]> = {
  FINANCE: [
    "Which sites were over budget on utilities last quarter?",
    "What is our largest revenue leakage class right now?",
    "List the top 5 overdue partners by outstanding balance",
  ],
  OPS: [
    "Which sites have expired compliance certificates?",
    "Show the 5 lowest-occupancy sites right now",
    "Which sites have the most open maintenance tickets?",
  ],
  SALES: [
    "Which active licences are flagged high churn risk?",
    "Break down open pipeline value by stage",
    "What was our cohort win rate over the last 6 months?",
  ],
};

function clampSize(s: Size): Size {
  if (typeof window === "undefined") return s;
  const maxW = Math.max(MIN_SIZE.w, window.innerWidth - SIDE_PX * 2);
  const maxH = Math.max(MIN_SIZE.h, window.innerHeight - BOTTOM_PX - TOP_ROOM_PX);
  return {
    w: Math.round(Math.min(maxW, Math.max(MIN_SIZE.w, s.w))),
    h: Math.round(Math.min(maxH, Math.max(MIN_SIZE.h, s.h))),
  };
}

function readSize(): Size | null {
  try {
    const raw = window.localStorage.getItem(SIZE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Size>;
    return Number.isFinite(v.w) && Number.isFinite(v.h)
      ? { w: v.w!, h: v.h! }
      : null;
  } catch {
    return null;
  }
}

function saveSize(s: Size) {
  try {
    window.localStorage.setItem(SIZE_KEY, JSON.stringify(s));
  } catch {
    // Ignore blocked storage
  }
}

/**
 * Adjustable floating AI agent chatbox anchored to the bottom-right.
 * The dashboard remains fully usable underneath; users can drag the top-left
 * corner, left edge, or top edge (or use the expand toggle) to resize it.
 */
export function AgentDock({
  token,
  dept,
  roleLabel,
  open,
  onOpenChange,
}: {
  token: string;
  dept: "FINANCE" | "OPS" | "SALES";
  roleLabel: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [history, setHistory] = useState<Exchange[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<Size>(DEFAULT_SIZE);
  const [expanded, setExpanded] = useState(false);
  const [resizing, setResizing] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Restore persisted size on mount & keep clamped on window resize.
  useEffect(() => {
    const saved = readSize();
    if (saved) setSize(clampSize(saved));
    const onResize = () => setSize((s) => clampSize(s));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [history, busy]);

  // Escape closes the floating chatbox.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const startResize = useCallback(
    (edge: { x: boolean; y: boolean }) => (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startSize = size;
      setResizing(true);
      setExpanded(false);

      const onMove = (ev: PointerEvent) => {
        const next = clampSize({
          w: edge.x ? startSize.w + (startX - ev.clientX) : startSize.w,
          h: edge.y ? startSize.h + (startY - ev.clientY) : startSize.h,
        });
        setSize(next);
      };

      const onUp = () => {
        setResizing(false);
        setSize((current) => {
          saveSize(current);
          return current;
        });
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [size],
  );

  function toggleExpand() {
    if (expanded) {
      const restored = clampSize(readSize() ?? DEFAULT_SIZE);
      setSize(restored);
      setExpanded(false);
    } else {
      setSize(clampSize({ w: 820, h: 760 }));
      setExpanded(true);
    }
  }

  async function runQuestion(rawQuestion: string) {
    const question = rawQuestion.trim();
    if (!question || busy) return;
    setQ("");
    setBusy(true);
    setHistory((h) => [...h, { question, pending: true }]);
    try {
      const res = await askAgent(token, question);
      setHistory((h) =>
        h.map((x, i) =>
          i === h.length - 1
            ? { question, answer: res.answer, queries: res.queries }
            : x,
        ),
      );
    } catch (err) {
      setHistory((h) =>
        h.map((x, i) =>
          i === h.length - 1
            ? {
                question,
                error: err instanceof Error ? err.message : "Request failed",
              }
            : x,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void runQuestion(q);
  }

  const suggestions = SUGGESTIONS[dept] ?? SUGGESTIONS.FINANCE;

  return (
    <>
      {open && (
        <section
          aria-label="Ask the data assistant"
          style={{ width: size.w, height: size.h }}
          className={`fixed right-6 bottom-20 z-50 flex max-w-[calc(100vw-2rem)] max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--card)] text-[var(--ink)] shadow-2xl ${
            resizing ? "select-none" : ""
          }`}
        >
          {/* Resize handles: top-left corner, left edge, top edge */}
          <div
            role="separator"
            aria-label="Resize chatbox diagonally"
            tabIndex={0}
            onPointerDown={startResize({ x: true, y: true })}
            onKeyDown={(e) => {
              const step = 32;
              if (e.key === "ArrowLeft")
                setSize((s) => clampSize({ w: s.w + step, h: s.h }));
              if (e.key === "ArrowRight")
                setSize((s) => clampSize({ w: s.w - step, h: s.h }));
              if (e.key === "ArrowUp")
                setSize((s) => clampSize({ w: s.w, h: s.h + step }));
              if (e.key === "ArrowDown")
                setSize((s) => clampSize({ w: s.w, h: s.h - step }));
            }}
            className="absolute top-0 left-0 z-20 h-4 w-4 cursor-nwse-resize"
            title="Drag to resize"
          />
          <div
            onPointerDown={startResize({ x: true, y: false })}
            className="absolute top-4 bottom-4 left-0 z-10 w-1.5 cursor-ew-resize"
            aria-hidden
          />
          <div
            onPointerDown={startResize({ x: false, y: true })}
            className="absolute top-0 right-4 left-4 z-10 h-1.5 cursor-ns-resize"
            aria-hidden
          />

          {/* Header */}
          <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--background)] px-4">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="inline-block size-2 rounded-full bg-[var(--series)]"
                aria-hidden
              />
              <h2 className="type-heading truncate text-sm">Ask the data</h2>
              <code className="rounded bg-[var(--subtle)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink-muted)]">
                {roleLabel}
              </code>
            </div>
            <div className="flex items-center gap-1">
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={() => setHistory([])}
                  className="rounded-md px-2 py-1 text-xs font-medium text-[var(--ink-muted)] hover:bg-[var(--subtle)] hover:text-[var(--ink)]"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={toggleExpand}
                title={expanded ? "Restore size" : "Expand chatbox"}
                className="rounded-md px-2 py-1 text-xs font-medium text-[var(--ink-muted)] hover:bg-[var(--subtle)] hover:text-[var(--ink)]"
              >
                {expanded ? "Compact" : "Expand"}
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close Ask the data"
                className="rounded-md px-2 py-1 text-xs font-medium text-[var(--ink-muted)] hover:bg-[var(--subtle)] hover:text-[var(--ink)]"
              >
                Close
              </button>
            </div>
          </header>

          {/* Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {history.length === 0 ? (
              <div className="space-y-4 py-2">
                <p className="text-sm leading-relaxed text-[var(--ink-muted)]">
                  Ask in plain English. Queries run on a Postgres connection
                  opened as <code className="font-mono text-[var(--ink)]">{roleLabel}</code>,
                  and every answer shows the SQL it ran.
                </p>
                <div className="flex flex-col gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      onClick={() => void runQuestion(s)}
                      className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3.5 py-2.5 text-left text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              history.map((x, i) => (
                <div
                  key={i}
                  className="space-y-2.5 rounded-xl bg-[var(--background)] p-3.5"
                >
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    {x.question}
                  </p>
                  {x.pending && (
                    <p className="animate-pulse text-xs text-[var(--ink-muted)]">
                      Querying {roleLabel} views…
                    </p>
                  )}
                  {x.error && (
                    <p className="rounded-lg bg-[var(--blocked-soft)] px-3 py-2 text-xs text-[var(--blocked-ink)]">
                      {x.error}
                    </p>
                  )}
                  {x.answer && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink)]">
                      {x.answer}
                    </p>
                  )}
                  {x.queries?.map((qr, j) => (
                    <details
                      key={j}
                      className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2.5"
                    >
                      <summary className="cursor-pointer select-none text-xs font-medium text-[var(--ink-muted)] hover:text-[var(--ink)]">
                        SQL — {qr.purpose}{" "}
                        {qr.error ? "(errored)" : `(${qr.rows.length} rows)`}
                      </summary>
                      <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-[var(--ink)]">
                        {qr.sql}
                      </pre>
                      {qr.error && (
                        <p className="mt-2 text-xs text-[var(--blocked-ink)]">
                          {qr.error}
                        </p>
                      )}
                      {qr.rows.length > 0 && (
                        <div className="mt-2">
                          <DataTable rows={qr.rows} maxRows={8} />
                        </div>
                      )}
                    </details>
                  ))}
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>

          {/* Input footer */}
          <form
            onSubmit={submit}
            className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] bg-[var(--background)] p-3"
          >
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ask a question…"
              aria-label="Ask the data"
              className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--ink)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !q.trim()}
              className="inline-flex h-9 w-16 shrink-0 items-center justify-center rounded-lg bg-[var(--ink)] text-xs font-semibold text-[var(--card)] transition-opacity hover:opacity-85 disabled:opacity-40"
            >
              {busy ? "…" : "Ask"}
            </button>
          </form>
        </section>
      )}

      {/* Floating launcher button */}
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-label={open ? "Close Ask the data" : "Open Ask the data"}
        className="fixed right-6 bottom-5 z-50 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--ink)] px-4 text-sm font-medium text-[var(--card)] shadow-lg transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] focus-visible:ring-offset-2"
      >
        <span
          className="inline-block size-2 rounded-full bg-[var(--series)]"
          aria-hidden
        />
        <span>{open ? "Hide agent" : "Ask the data"}</span>
      </button>
    </>
  );
}
