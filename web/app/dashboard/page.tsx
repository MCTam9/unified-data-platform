"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CatalogueEntry,
  PERSONAS,
  billLicence,
  fetchCatalogue,
  fetchView,
  gbp,
} from "@/lib/api";
import { usePolled } from "@/lib/usePolled";
import { DataTable, Sheet, TableSkeleton } from "@/components/ui";
import {
  FinanceOverview,
  OpsOverview,
  SalesOverview,
} from "@/components/Overview";
import { SystemPanel } from "@/components/System";
import { AgentDock } from "@/components/AgentPanel";

const POLL_MS = 15000;

type Tab = "briefing" | "registers" | "system";

const ROLE_LABEL: Record<string, string> = {
  FINANCE: "dept_finance",
  OPS: "dept_ops",
  SALES: "dept_sales",
};

const SHORT_PERSONA: Record<string, string> = {
  "demo-finance": "Finance",
  "demo-ops": "Operations",
  "demo-ops-london": "London Ops",
  "demo-sales": "Partnerships",
};

export default function Dashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("briefing");
  const [selectedView, setSelectedView] = useState<string>("");
  const [agentOpen, setAgentOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; isError?: boolean } | null>(null);

  const persona = PERSONAS.find((p) => p.token === token);

  useEffect(() => {
    const t = localStorage.getItem("demo_token");
    if (!t) {
      router.replace("/");
      return;
    }
    setToken(t);
  }, [router]);

  const notify = useCallback((text: string, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => setToast(null), 6000);
  }, []);

  // Granted views and display names come straight from Postgres core.catalogue.
  const grants = usePolled(
    `catalogue:${token}`,
    () => (token ? fetchCatalogue(token) : Promise.resolve(null)),
    60000,
  );
  const catalogue: CatalogueEntry[] = grants.data?.views ?? [];

  // Resolve active register view synchronously so switching personas never flashes.
  const activeView = useMemo(() => {
    if (catalogue.some((c) => c.view_name === selectedView)) return selectedView;
    return catalogue[0]?.view_name ?? "";
  }, [catalogue, selectedView]);

  const activeEntry = catalogue.find((c) => c.view_name === activeView);

  const table = usePolled(
    `view:${token}:${activeView}`,
    () =>
      token && tab === "registers" && activeView
        ? fetchView(token, activeView).then((r) => r.rows)
        : Promise.resolve(null),
    POLL_MS,
  );

  if (!token || !persona) return null;

  const lastUpdated = table.lastUpdated ?? grants.lastUpdated;
  const refreshing = table.isRefreshing || grants.isRefreshing;

  function switchPersona(t: string) {
    if (t === token) return;
    localStorage.setItem("demo_token", t);
    setToken(t);
    setSelectedView("");
  }

  function openRegister(viewName: string) {
    setSelectedView(viewName);
    setTab("registers");
  }

  // Constant font-weight & border-width: zero layout shift on click.
  const navBtn = (active: boolean) =>
    "h-8 rounded-lg px-3 text-sm font-medium transition-colors duration-150 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] " +
    (active
      ? "bg-[var(--card)] text-[var(--ink)] shadow-xs"
      : "text-[var(--ink-muted)] hover:text-[var(--ink)]");

  return (
    <div className="flex min-h-screen flex-col">
      {/* Sticky h-14 top navigation bar — calm, stationary, zero wrapping */}
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur supports-[backdrop-filter]:bg-[var(--background)]/75">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] rounded-md"
          >
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-[var(--ink)] text-xs font-bold text-[var(--card)]">
              E
            </span>
            <span className="type-heading hidden text-sm sm:inline">
              Unified Data Platform
            </span>
          </Link>

          {/* 3 primary destinations — never wraps */}
          <nav
            aria-label="Primary navigation"
            className="flex items-center gap-0.5 rounded-xl bg-[var(--subtle)] p-1"
          >
            <button
              type="button"
              onClick={() => setTab("briefing")}
              aria-current={tab === "briefing" ? "page" : undefined}
              className={navBtn(tab === "briefing")}
            >
              Briefing
            </button>
            <button
              type="button"
              onClick={() => setTab("registers")}
              aria-current={tab === "registers" ? "page" : undefined}
              className={navBtn(tab === "registers")}
            >
              Registers
              {catalogue.length > 0 && (
                <span className="ml-1.5 text-xs type-data text-[var(--ink-muted)]">
                  {catalogue.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab("system")}
              aria-current={tab === "system" ? "page" : undefined}
              className={navBtn(tab === "system")}
            >
              How it works
            </button>
          </nav>

          {/* Right cluster: 1-click persona switcher + live indicator */}
          <div className="ml-auto flex items-center gap-3">
            <div
              role="group"
              aria-label="Switch persona"
              className="hidden items-center gap-0.5 rounded-xl bg-[var(--subtle)] p-1 lg:inline-flex"
            >
              {PERSONAS.map((p) => {
                const selected = p.token === token;
                return (
                  <button
                    key={p.token}
                    type="button"
                    onClick={() => switchPersona(p.token)}
                    title={p.description}
                    aria-pressed={selected}
                    className={
                      "h-7 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition-colors duration-150 " +
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] " +
                      (selected
                        ? "bg-[var(--card)] text-[var(--ink)] shadow-xs"
                        : "text-[var(--ink-muted)] hover:text-[var(--ink)]")
                    }
                  >
                    {SHORT_PERSONA[p.token] ?? p.label}
                  </button>
                );
              })}
            </div>

            {/* Compact select on smaller screens */}
            <select
              aria-label="Switch persona"
              value={token}
              onChange={(e) => switchPersona(e.target.value)}
              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs font-medium text-[var(--ink)] lg:hidden"
            >
              {PERSONAS.map((p) => (
                <option key={p.token} value={p.token}>
                  {p.label}
                </option>
              ))}
            </select>

            <div className="hidden min-w-[116px] items-center justify-end gap-1.5 text-xs type-data text-[var(--ink-muted)] xl:flex">
              <span
                className={`inline-block size-1.5 rounded-full transition-colors ${
                  refreshing
                    ? "bg-[var(--good)]"
                    : lastUpdated
                      ? "bg-[var(--good)]/55"
                      : "bg-[var(--border-strong)]"
                }`}
              />
              <span>
                {lastUpdated
                  ? `Live · ${lastUpdated.toLocaleTimeString("en-GB")}`
                  : "Connecting…"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main canvas on the mineral plaster plane */}
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pt-5 pb-24 sm:px-6">
        {grants.error && (
          <p className="mb-4 rounded-2xl bg-[var(--blocked-soft)] px-4 py-3 text-sm text-[var(--blocked-ink)]">
            {grants.error}
          </p>
        )}

        {tab === "briefing" ? (
          persona.dept === "FINANCE" ? (
            <FinanceOverview
              token={token}
              onOpenRegister={openRegister}
              onNotify={notify}
            />
          ) : persona.dept === "OPS" ? (
            <OpsOverview token={token} onOpenRegister={openRegister} />
          ) : (
            <SalesOverview token={token} onOpenRegister={openRegister} />
          )
        ) : tab === "registers" ? (
          <div className="grid grid-cols-12 gap-5">
            {/* Granted views index from Postgres core.catalogue */}
            <aside className="col-span-12 lg:col-span-3">
              <Sheet
                title="Granted views"
                description={`Connected as ${ROLE_LABEL[persona.dept]}`}
                bodyClassName="px-3 pb-3"
              >
                <div className="flex flex-wrap gap-1 lg:flex-col">
                  {catalogue.map((c) => {
                    const selected = c.view_name === activeView;
                    return (
                      <button
                        key={c.view_name}
                        type="button"
                        onClick={() => setSelectedView(c.view_name)}
                        aria-current={selected ? "page" : undefined}
                        className={
                          "flex h-9 w-auto items-center rounded-lg px-3 text-left text-sm font-medium transition-colors duration-150 lg:w-full " +
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] " +
                          (selected
                            ? "bg-[var(--ink)] text-[var(--card)]"
                            : "text-[var(--ink-muted)] hover:bg-[var(--subtle)] hover:text-[var(--ink)]")
                        }
                      >
                        <span className="truncate">{c.display_name}</span>
                      </button>
                    );
                  })}
                </div>
              </Sheet>
            </aside>

            {/* Active register table */}
            <div className="col-span-12 min-w-0 lg:col-span-9">
              <Sheet
                title={activeEntry?.display_name ?? "Loading register…"}
                description={
                  activeEntry?.description ??
                  "Read live from your granted Postgres reporting views"
                }
              >
                {table.error && (
                  <p className="mb-3 rounded-xl bg-[var(--blocked-soft)] px-4 py-3 text-sm text-[var(--blocked-ink)]">
                    {table.error}
                  </p>
                )}
                {table.data === null && !table.error ? (
                  <TableSkeleton />
                ) : (
                  <DataTable
                    key={activeView}
                    rows={table.data ?? []}
                    exportName={activeView || "export"}
                    onNotify={notify}
                    action={
                      activeView === "vw_finance_revenue_assurance"
                        ? {
                            applies: (r) =>
                              r.exception_type === "licence_not_invoiced",
                            label: "Bill this now",
                            busyLabel: "Billing…",
                            doneLabel: "Invoiced ✓",
                            run: async (r) => {
                              const res = await billLicence(
                                token,
                                String(r.site_code),
                                String(r.unit_code),
                              );
                              table.reload();
                              return `Invoice ${res.invoice_no} raised for ${res.partner} — ${gbp(res.net_gbp)}/mo no longer leaking.`;
                            },
                          }
                        : undefined
                    }
                  />
                )}
              </Sheet>
            </div>
          </div>
        ) : (
          <SystemPanel token={token} />
        )}
      </main>

      {/* Non-shifting fixed notification toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 left-6 z-50 flex max-w-md items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
            toast.isError
              ? "bg-[var(--blocked-soft)] text-[var(--blocked-ink)]"
              : "bg-[var(--ink)] text-[var(--card)]"
          }`}
        >
          <span className="flex-1 leading-snug">{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="shrink-0 text-xs font-medium opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Adjustable floating AI agent chatbox */}
      <AgentDock
        token={token}
        dept={persona.dept}
        roleLabel={ROLE_LABEL[persona.dept]}
        open={agentOpen}
        onOpenChange={setAgentOpen}
      />
    </div>
  );
}
