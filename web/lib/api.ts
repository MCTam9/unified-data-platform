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
export const askAgent = (token: string, question: string) =>
  req("/api/agent/ask", token, {
    method: "POST",
    body: JSON.stringify({ question }),
  }) as Promise<{
    answer: string;
    queries: { sql: string; purpose: string; rows: Row[]; error?: string }[];
    outcome: string;
  }>;

export const gbp = (v: unknown) =>
  typeof v === "number"
    ? v.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 })
    : String(v ?? "—");
