"use client";
import { fetchAgentLog, fetchAudit, fetchGrants } from "@/lib/api";
import { usePolled } from "@/lib/usePolled";
import { ChartCard } from "./charts";

// The evidence tab. Everything here is read live from the database at page
// load rather than asserted in prose — the grant matrix comes from
// has_table_privilege, the audit rows from the append-only log, the agent log
// from what the model actually ran. This is the tab for the engineering
// audience: it shows the boundary instead of claiming it.

function Architecture() {
  const box = "fill-white dark:fill-neutral-950 stroke-neutral-300 dark:stroke-neutral-700";
  const label = "fill-neutral-700 dark:fill-neutral-300 text-[11px]";
  const muted = "fill-neutral-500 text-[10px]";
  return (
    <svg viewBox="0 0 720 190" className="w-full" role="img"
      aria-label="Browser to API to reporting views to core schema; the agent uses the same role pools">
      {/* lanes */}
      <rect x="8" y="40" width="120" height="46" rx="8" className={box} strokeWidth="1.5" />
      <text x="68" y="60" textAnchor="middle" className={label}>Browser</text>
      <text x="68" y="76" textAnchor="middle" className={muted}>persona = token</text>

      <rect x="168" y="28" width="150" height="70" rx="8" className={box} strokeWidth="1.5" />
      <text x="243" y="50" textAnchor="middle" className={label}>API</text>
      <text x="243" y="66" textAnchor="middle" className={muted}>one pool per</text>
      <text x="243" y="79" textAnchor="middle" className={muted}>department role</text>

      <rect x="358" y="28" width="150" height="70" rx="8" className={box} strokeWidth="1.5" />
      <text x="433" y="50" textAnchor="middle" className={label}>reporting views</text>
      <text x="433" y="66" textAnchor="middle" className={muted}>definer&apos;s rights,</text>
      <text x="433" y="79" textAnchor="middle" className={muted}>granted per role</text>

      <rect x="548" y="28" width="150" height="70" rx="8" className="fill-neutral-100 dark:fill-neutral-900 stroke-neutral-300 dark:stroke-neutral-700" strokeWidth="1.5" />
      <text x="623" y="50" textAnchor="middle" className={label}>core schema</text>
      <text x="623" y="66" textAnchor="middle" className={muted}>revoked from all;</text>
      <text x="623" y="79" textAnchor="middle" className={muted}>FORCE RLS on site</text>

      {/* agent lane */}
      <rect x="168" y="130" width="150" height="42" rx="8" className={box} strokeWidth="1.5" strokeDasharray="4 3" />
      <text x="243" y="147" textAnchor="middle" className={label}>AI query agent</text>
      <text x="243" y="162" textAnchor="middle" className={muted}>same role pools</text>

      {[
        [128, 63, 168, 63], [318, 63, 358, 63], [508, 63, 548, 63],
      ].map(([x1, y1, x2, y2], i) => (
        <g key={i}>
          <line x1={x1} y1={y1} x2={x2 - 6} y2={y2}
            className="stroke-neutral-400 dark:stroke-neutral-600" strokeWidth="1.5" />
          <polygon points={`${x2},${y2} ${x2 - 7},${y2 - 4} ${x2 - 7},${y2 + 4}`}
            className="fill-neutral-400 dark:fill-neutral-600" />
        </g>
      ))}
      <line x1="243" y1="98" x2="243" y2="130"
        className="stroke-neutral-400 dark:stroke-neutral-600" strokeWidth="1.5" strokeDasharray="4 3" />
    </svg>
  );
}

const CHECK = (
  <span className="text-emerald-700 dark:text-emerald-400" aria-label="granted">✓</span>
);
const DOT = <span className="text-neutral-300 dark:text-neutral-700" aria-label="no access">·</span>;

export function SystemPanel({ token }: { token: string }) {
  const grants = usePolled(`grants:${token}`, () => fetchGrants(token), 60000);
  const audit = usePolled(`audit:${token}`, () => fetchAudit(token), 8000);
  const agentLog = usePolled(`agentlog:${token}`, () => fetchAgentLog(token), 15000);

  const roles = grants.data?.roles ?? [];

  return (
    <div className="space-y-4">
      <ChartCard title="How the boundary is enforced"
        note="the model and the app both read through the same grants">
        <Architecture />
        <ul className="mt-2 grid gap-1 text-xs text-neutral-600 dark:text-neutral-400 sm:grid-cols-2">
          <li>• Views run with the definer&apos;s rights; their owner does not own <code>core</code>, and RLS is <code>FORCE</code>d — both are needed or site scoping silently does nothing through a view.</li>
          <li>• A GiST exclusion constraint makes double-letting a unit impossible, not discouraged.</li>
          <li>• Closed periods reject writes by trigger; corrections book as dated adjustments.</li>
          <li>• Mirrored tables carry <code>source_system</code> / <code>external_id</code> / <code>synced_at</code> — ledger and CRM stay the source of truth.</li>
        </ul>
        <p className="mt-3 rounded-lg bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">
            This app for workflows; a BI tool for exploration.
          </span>{" "}
          Metabase is self-hosted alongside it and connects <em>once per
          department role</em>, so its schema sync only discovers the views that
          role is granted — the BI tool&apos;s data model is the same grant
          matrix shown below. Start it with{" "}
          <code>docker compose --profile bi up -d metabase</code> and it runs at{" "}
          <a href="http://localhost:3002" target="_blank" rel="noreferrer"
            className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100">
            localhost:3002
          </a>.
        </p>
      </ChartCard>

      <ChartCard title="Live grant matrix"
        note="asked of Postgres on load — not read from a config file">
        {grants.error && <p className="text-sm text-red-700 dark:text-red-400">{grants.error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className="py-2 text-left font-medium text-neutral-500">reporting view</th>
                {roles.map((r) => (
                  <th key={r} className="px-3 py-2 text-center font-medium text-neutral-500">
                    {r.replace("dept_", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(grants.data?.matrix ?? []).map((row) => (
                <tr key={String(row.view)}
                  className="border-b border-neutral-100 dark:border-neutral-900 last:border-0">
                  <td className="py-1.5 font-mono text-xs text-neutral-800 dark:text-neutral-200">
                    {String(row.view)}
                  </td>
                  {roles.map((r) => (
                    <td key={r} className="px-3 py-1.5 text-center">{row[r] ? CHECK : DOT}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {grants.data && (
          <p className="mt-3 rounded-lg bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400">
            <span className="font-medium text-neutral-800 dark:text-neutral-200">
              {grants.data.core_tables} core tables
            </span>{" "}
            hold the truth; department roles can read{" "}
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              {grants.data.core_readable_by_roles}
            </span>{" "}
            of them. The same assertion runs in the test suite —{" "}
            <code>pytest tests/test_permissions.py</code>.
          </p>
        )}
      </ChartCard>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title="Audit trail" note="append-only, written by triggers">
          {(audit.data?.rows ?? []).length === 0 ? (
            <p className="py-6 text-sm text-neutral-500">
              No writes yet. Start the activity simulator to see rows appear.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500">
                  <th className="py-1.5 text-left font-medium">time</th>
                  <th className="py-1.5 text-left font-medium">table</th>
                  <th className="py-1.5 text-left font-medium">action</th>
                  <th className="py-1.5 text-left font-medium">by</th>
                </tr>
              </thead>
              <tbody>
                {(audit.data?.rows ?? []).map((r, i) => (
                  <tr key={i} className="border-b border-neutral-100 dark:border-neutral-900 last:border-0">
                    <td className="py-1 tabular-nums text-neutral-500">{String(r.changed_at)}</td>
                    <td className="py-1 font-mono text-neutral-800 dark:text-neutral-200">{String(r.table_name)}</td>
                    <td className="py-1 text-neutral-600 dark:text-neutral-400">{String(r.action)}</td>
                    <td className="py-1 text-neutral-600 dark:text-neutral-400">{String(r.changed_by)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>

        <ChartCard title="Agent query log" note="every question the model was asked">
          {(agentLog.data?.rows ?? []).length === 0 ? (
            <p className="py-6 text-sm text-neutral-500">
              No questions asked yet. Every one gets logged with its role, outcome
              and row count — the answer to &ldquo;why did it say that?&rdquo; in three months.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500">
                  <th className="py-1.5 text-left font-medium">time</th>
                  <th className="py-1.5 text-left font-medium">role</th>
                  <th className="py-1.5 text-left font-medium">question</th>
                  <th className="py-1.5 text-left font-medium">outcome</th>
                </tr>
              </thead>
              <tbody>
                {(agentLog.data?.rows ?? []).map((r, i) => (
                  <tr key={i} className="border-b border-neutral-100 dark:border-neutral-900 last:border-0">
                    <td className="py-1 tabular-nums text-neutral-500">{String(r.asked_at)}</td>
                    <td className="py-1 text-neutral-600 dark:text-neutral-400">
                      {String(r.role_name).replace("dept_", "")}
                    </td>
                    <td className="max-w-[16rem] truncate py-1 text-neutral-800 dark:text-neutral-200">
                      {String(r.question)}
                    </td>
                    <td className="py-1 text-neutral-600 dark:text-neutral-400">{String(r.outcome)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
