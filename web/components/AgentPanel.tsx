"use client";
import { useState } from "react";
import { askAgent, Row } from "@/lib/api";
import { DataTable } from "./ui";

type Exchange = {
  question: string;
  answer?: string;
  queries?: { sql: string; purpose: string; rows: Row[]; error?: string }[];
  error?: string;
  pending?: boolean;
};

// Every answer shows its SQL. Non-negotiable in a finance tool: the reader can
// see how a number was derived, and it doubles as the cheapest audit trail.
export function AgentPanel({ token }: { token: string }) {
  const [history, setHistory] = useState<Exchange[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question || busy) return;
    setQ("");
    setBusy(true);
    setHistory((h) => [...h, { question, pending: true }]);
    try {
      const res = await askAgent(token, question);
      setHistory((h) =>
        h.map((x, i) => i === h.length - 1
          ? { question, answer: res.answer, queries: res.queries }
          : x));
    } catch (err) {
      setHistory((h) =>
        h.map((x, i) => i === h.length - 1
          ? { question, error: err instanceof Error ? err.message : "failed" }
          : x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-500">
        Ask in plain English. The agent queries only the views your role can
        read — the database enforces the boundary, and every answer shows the
        SQL it ran.
      </p>
      <div className="space-y-4">
        {history.map((x, i) => (
          <div key={i} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-3">
            <p className="font-medium text-neutral-900 dark:text-neutral-100">{x.question}</p>
            {x.pending && <p className="text-sm text-neutral-500 animate-pulse">Querying…</p>}
            {x.error && <p className="text-sm text-red-700 dark:text-red-400">{x.error}</p>}
            {x.answer && (
              <p className="text-sm text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">{x.answer}</p>
            )}
            {x.queries?.map((qr, j) => (
              <details key={j} className="rounded-lg bg-neutral-50 dark:bg-neutral-900 p-3">
                <summary className="cursor-pointer text-xs font-medium text-neutral-600 dark:text-neutral-400">
                  SQL — {qr.purpose} {qr.error ? "(errored)" : `(${qr.rows.length} rows)`}
                </summary>
                <pre className="mt-2 overflow-x-auto text-xs text-neutral-700 dark:text-neutral-300">{qr.sql}</pre>
                {qr.error && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{qr.error}</p>}
                {qr.rows.length > 0 && (
                  <div className="mt-2"><DataTable rows={qr.rows} maxRows={10} /></div>
                )}
              </details>
            ))}
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='e.g. "Which sites were over budget on utilities last quarter?"'
          className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-neutral-900 dark:bg-neutral-100 px-4 py-2 text-sm font-medium text-white dark:text-neutral-900 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
