const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Persona = {
  token: string;
  label: string;
  dept: "FINANCE" | "OPS" | "SALES";
  description: string;
};

export const PERSONAS: Persona[] = [
  { token: "demo-finance", label: "Finance Director", dept: "FINANCE",
    description: "P&L, budget variance, aged debt, revenue assurance" },
  { token: "demo-ops", label: "Head of Operations", dept: "OPS",
    description: "Occupancy, compliance, maintenance, assets — all sites" },
  { token: "demo-ops-london", label: "London Regional Manager", dept: "OPS",
    description: "Same screens, row-level-scoped to London sites only" },
  { token: "demo-sales", label: "Partnerships Lead", dept: "SALES",
    description: "Pipeline, conversion, churn risk" },
];

export type Row = Record<string, unknown>;

async function req(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const fetchMe = (token: string) => req("/api/me", token);
export const fetchViews = (token: string) =>
  req("/api/views", token) as Promise<{ role: string; views: string[] }>;
export const fetchView = (token: string, view: string, limit = 500) =>
  req(`/api/view/${view}?limit=${limit}`, token) as Promise<{ rows: Row[] }>;
export const fetchGrants = (token: string) =>
  req("/api/system/grants", token) as Promise<{
    roles: string[]; matrix: Row[]; core_tables: number; core_readable_by_roles: number;
  }>;
export const fetchAudit = (token: string) =>
  req("/api/system/audit?limit=12", token) as Promise<{ rows: Row[] }>;
export const fetchAgentLog = (token: string) =>
  req("/api/system/agent-log?limit=8", token) as Promise<{ rows: Row[] }>;

export const askAgent = (token: string, question: string) =>
  req("/api/agent/ask", token, {
    method: "POST",
    body: JSON.stringify({ question }),
  }) as Promise<{
    answer: string;
    queries: { sql: string; purpose: string; rows: Row[]; error?: string }[];
    outcome: string;
  }>;

// ---------------------------------------------------------------- charts/agg
export type Point = Record<string, string | number | null>;

/** Group rows by `key`, summing each of `sums`; sorted by key. */
export function groupSum(rows: Row[], key: string, sums: string[]): Point[] {
  const acc = new Map<string, Point>();
  for (const r of rows) {
    const k = String(r[key] ?? "");
    const entry = acc.get(k) ?? { [key]: k, ...Object.fromEntries(sums.map((s) => [s, 0])) };
    for (const s of sums) entry[s] = Number(entry[s]) + Number(r[s] ?? 0);
    acc.set(k, entry);
  }
  return [...acc.values()].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

/** Drop the newest period from a time series. The current month is always
 *  partial — invoices raised but not yet collected — and plotting it makes a
 *  cliff that reads as a data error rather than as "the month isn't over". */
export function excludePartialPeriod(points: Point[]): Point[] {
  return points.length > 1 ? points.slice(0, -1) : points;
}

export const monthLabel = (iso: unknown) => {
  const d = new Date(String(iso));
  return isNaN(d.getTime()) ? String(iso) :
    d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
};

export const gbp = (v: unknown) =>
  typeof v === "number"
    ? v.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 })
    : String(v ?? "—");
