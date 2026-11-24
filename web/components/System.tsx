"use client";
import { fetchAgentLog, fetchAudit, fetchGrants } from "@/lib/api";
import { usePolled } from "@/lib/usePolled";
import { Sheet } from "./ui";

// The evidence tab. Everything here is read live from Postgres rather than
// asserted in prose — the grant matrix comes from has_table_privilege, the
// audit rows from the append-only log, and the agent log from executed SQL.

function Architecture() {
  const box = "fill-[var(--card)] stroke-[var(--border-strong)]";
  const label = "fill-[var(--ink)] text-[11px] font-medium";
  const muted = "fill-[var(--ink-muted)] text-[10px]";
  return (
    <svg
      viewBox="0 0 720 190"
      className="w-full"
      role="img"
      aria-label="Browser to API to reporting views to core schema; the agent uses the same role pools"
    >
      <rect x="8" y="40" width="120" height="46" rx="10" className={box} strokeWidth="1.5" />
      <text x="68" y="60" textAnchor="middle" className={label}>Browser</text>
      <text x="68" y="76" textAnchor="middle" className={muted}>persona = token</text>

      <rect x="168" y="28" width="150" height="70" rx="10" className={box} strokeWidth="1.5" />
      <text x="243" y="50" textAnchor="middle" className={label}>API</text>
      <text x="243" y="66" textAnchor="middle" className={muted}>one pool per</text>
      <text x="243" y="79" textAnchor="middle" className={muted}>department role</text>

      <rect x="358" y="28" width="150" height="70" rx="10" className={box} strokeWidth="1.5" />
      <text x="433" y="50" textAnchor="middle" className={label}>Reporting views</text>
      <text x="433" y="66" textAnchor="middle" className={muted}>definer&apos;s rights,</text>
      <text x="433" y="79" textAnchor="middle" className={muted}>granted per role</text>

      <rect
        x="548"
        y="28"
        width="150"
        height="70"
        rx="10"
        className="fill-[var(--subtle)] stroke-[var(--border-strong)]"
        strokeWidth="1.5"
      />
      <text x="623" y="50" textAnchor="middle" className={label}>Core schema</text>
      <text x="623" y="66" textAnchor="middle" className={muted}>revoked from all;</text>
      <text x="623" y="79" textAnchor="middle" className={muted}>FORCE RLS on site</text>

      <rect
        x="168"
        y="130"
        width="150"
        height="42"
        rx="10"
        className={box}
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <text x="243" y="147" textAnchor="middle" className={label}>AI query agent</text>
      <text x="243" y="162" textAnchor="middle" className={muted}>same role pools</text>

      {[
        [128, 63, 168, 63],
        [318, 63, 358, 63],
        [508, 63, 548, 63],
      ].map(([x1, y1, x2, y2], i) => (
        <g key={i}>
          <line
            x1={x1}
            y1={y1}
            x2={x2 - 6}
            y2={y2}
            className="stroke-[var(--ink-muted)]"
            strokeWidth="1.5"
          />
          <polygon
            points={`${x2},${y2} ${x2 - 7},${y2 - 4} ${x2 - 7},${y2 + 4}`}
            className="fill-[var(--ink-muted)]"
          />
        </g>
      ))}
      <line
        x1="243"
        y1="98"
        x2="243"
        y2="130"
        className="stroke-[var(--ink-muted)]"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
    </svg>
  );
}

const CHECK = (
  <span className="font-semibold text-[var(--good-ink)]" aria-label="granted">
    ✓
  </span>
);
const DOT = (
  <span className="text-[var(--ink-muted)] opacity-35" aria-label="no access">
    ·
  </span>
);

export function SystemPanel({ token }: { token: string }) {
  const grants = usePolled(`grants:${token}`, () => fetchGrants(token), 60000);
  const audit = usePolled(`audit:${token}`, () => fetchAudit(token), 8000);
  const agentLog = usePolled(`agentlog:${token}`, () => fetchAgentLog(token), 15000);

  const roles = grants.data?.roles ?? [];

  return (
    <div className="space-y-5">
      <Sheet
        title="How the boundary is enforced"
        description="Both the web app and the AI query agent read through the same Postgres role pools"
      >
        <Architecture />
        <ul className="mt-4 grid gap-x-8 gap-y-2 text-xs leading-relaxed text-[var(--ink-muted)] sm:grid-cols-2">
          <li>
            Views run with definer&apos;s rights; their owner does not own{" "}
            <code className="font-mono text-[var(--ink)]">core</code>, and RLS is{" "}
            <code className="font-mono text-[var(--ink)]">FORCE</code>d so site scoping applies through every view.
          </li>
          <li>
            A GiST exclusion constraint makes double-letting a unit impossible at the database layer.
          </li>
          <li>
            Closed accounting periods reject writes by trigger; corrections book as dated adjustments.
          </li>
          <li>
            Mirrored tables carry{" "}
            <code className="font-mono text-[var(--ink)]">source_system</code>,{" "}
            <code className="font-mono text-[var(--ink)]">external_id</code>, and{" "}
            <code className="font-mono text-[var(--ink)]">synced_at</code>.
          </li>
        </ul>
      </Sheet>

      <Sheet
        title="Live grant matrix"
        description="Queried directly from Postgres has_table_privilege on load"
      >
        {grants.error && (
          <p className="text-sm text-[var(--blocked-ink)]">{grants.error}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-2 text-left text-xs font-semibold text-[var(--ink-muted)]">
                  Reporting view
                </th>
                {roles.map((r) => (
                  <th
                    key={r}
                    className="px-3 py-2 text-center text-xs font-semibold capitalize text-[var(--ink-muted)]"
                  >
                    {r.replace("dept_", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {(grants.data?.matrix ?? []).map((row) => (
                <tr key={String(row.view)} className="hover:bg-[var(--background)]">
                  <td className="py-2 font-mono text-xs text-[var(--ink)]">
                    {String(row.view)}
                  </td>
                  {roles.map((r) => (
                    <td key={r} className="px-3 py-2 text-center">
                      {row[r] ? CHECK : DOT}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {grants.data && (
          <p className="mt-4 rounded-xl bg-[var(--subtle)] px-4 py-3 text-xs text-[var(--ink-muted)]">
            <span className="font-semibold type-data text-[var(--ink)]">
              {grants.data.core_tables} core tables
            </span>{" "}
            hold the underlying truth; department roles can read{" "}
            <span className="font-semibold type-data text-[var(--good-ink)]">
              {grants.data.core_readable_by_roles}
            </span>{" "}
            of them. Verified in{" "}
            <code className="font-mono text-[var(--ink)]">
              pytest tests/test_permissions.py
            </code>
            .
          </p>
        )}
      </Sheet>

      <div className="grid gap-5 lg:grid-cols-2">
        <Sheet title="Audit trail" description="Append-only log written by triggers">
          {(audit.data?.rows ?? []).length === 0 ? (
            <p className="py-6 text-sm text-[var(--ink-muted)]">
              No writes recorded yet. Trigger a billing action or run the simulator to see entries appear.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--ink-muted)]">
                    <th className="py-2 text-left font-semibold">Time</th>
                    <th className="py-2 text-left font-semibold">Table</th>
                    <th className="py-2 text-left font-semibold">Action</th>
                    <th className="py-2 text-left font-semibold">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {(audit.data?.rows ?? []).map((r, i) => (
                    <tr key={i}>
                      <td className="py-1.5 type-data text-[var(--ink-muted)]">
                        {String(r.changed_at)}
                      </td>
                      <td className="py-1.5 font-mono text-[var(--ink)]">
                        {String(r.table_name)}
                      </td>
                      <td className="py-1.5 text-[var(--ink-muted)]">
                        {String(r.action)}
                      </td>
                      <td className="py-1.5 text-[var(--ink-muted)]">
                        {String(r.changed_by)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Sheet>

        <Sheet title="Agent query log" description="Every question executed against Postgres">
          {(agentLog.data?.rows ?? []).length === 0 ? (
            <p className="py-6 text-sm text-[var(--ink-muted)]">
              No questions asked yet. Open Ask the data in the bottom right to run a role-scoped query.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--ink-muted)]">
                    <th className="py-2 text-left font-semibold">Time</th>
                    <th className="py-2 text-left font-semibold">Role</th>
                    <th className="py-2 text-left font-semibold">Question</th>
                    <th className="py-2 text-left font-semibold">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {(agentLog.data?.rows ?? []).map((r, i) => (
                    <tr key={i}>
                      <td className="py-1.5 type-data text-[var(--ink-muted)]">
                        {String(r.asked_at)}
                      </td>
                      <td className="py-1.5 text-[var(--ink-muted)]">
                        {String(r.role_name).replace("dept_", "")}
                      </td>
                      <td className="max-w-[16rem] truncate py-1.5 text-[var(--ink)]">
                        {String(r.question)}
                      </td>
                      <td className="py-1.5 text-[var(--ink-muted)]">
                        {String(r.outcome)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Sheet>
      </div>
    </div>
  );
}
