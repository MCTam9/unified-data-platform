"use client";
import { useRouter } from "next/navigation";
import { PERSONAS } from "@/lib/api";

const ROLE_BY_DEPT: Record<string, string> = {
  FINANCE: "dept_finance",
  OPS: "dept_ops",
  SALES: "dept_sales",
};

export default function Home() {
  const router = useRouter();

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-3xl space-y-6">
        <section className="plinth rounded-2xl p-7 sm:p-9 ring-1 ring-white/[0.08]">
          <div className="flex items-center gap-2.5 text-xs text-[var(--ink-muted)]">
            <span className="inline-flex size-6 items-center justify-center rounded-md bg-[#eef2f6] text-xs font-bold text-[#0f172a]">
              E
            </span>
            <span>Encore · Illustrative demo (synthetic data)</span>
          </div>
          <h1 className="type-display mt-4 text-3xl sm:text-4xl">
            Unified Data Platform
          </h1>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-[var(--ink-muted)]">
            One Postgres database across Finance, Operations, and Partnerships.
            Each persona connects through its own database role — grants and
            row-level security shape the app, the BI layer, and the AI agent.
          </p>
        </section>

        <section
          aria-label="Choose a persona"
          className="grid gap-3.5 sm:grid-cols-2"
        >
          {PERSONAS.map((p) => (
            <button
              key={p.token}
              type="button"
              onClick={() => {
                localStorage.setItem("demo_token", p.token);
                router.push("/dashboard");
              }}
              className="group flex flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-left transition-colors duration-150 hover:border-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="type-heading text-base text-[var(--ink)]">
                    {p.label}
                  </span>
                  <code className="rounded-md bg-[var(--subtle)] px-2 py-0.5 font-mono text-[11px] text-[var(--ink-muted)]">
                    {ROLE_BY_DEPT[p.dept]}
                  </code>
                </div>
                <p className="text-sm leading-relaxed text-[var(--ink-muted)]">
                  {p.description}
                </p>
              </div>
              <span className="mt-4 text-xs font-semibold text-[var(--ink)] opacity-70 transition-opacity group-hover:opacity-100">
                Open briefing
              </span>
            </button>
          ))}
        </section>
      </div>
    </main>
  );
}
