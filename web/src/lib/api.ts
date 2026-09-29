const TOKEN_KEY = "pp_token";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = opts.body;
  if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.json); }
  const res = await fetch(`/api${path}`, { ...opts, headers, body });
  if (res.status === 401 && token) { setToken(null); window.location.href = "/login"; }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: any) => d.msg).join(", ") : msg;
    } catch { /* not json */ }
    if (/valid email/i.test(msg)) msg = "Please enter a valid email address.";
    if (/at least 8 characters/i.test(msg)) msg = "Password must be at least 8 characters.";
    throw new ApiError(res.status, msg || "Something went wrong");
  }
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("json") ? res.json() : res.text()) as Promise<T>;
}

// ---------- types
export type Org = {
  id: number; name: string; sender_name: string; udyam_registered: boolean; cost_of_capital: number;
  treds_rate: number; early_pay_discount: number; relationship_first: boolean; language: Lang; onboarded: boolean;
  upi_id: string; udyam_number: string; gstin: string; address: string; contact_phone: string; bank_rate: number;
};
export type Interest = { applies: boolean; from: string; days: number; rate: number; interest: number; total: number };
export type Impact = {
  since: string; actions_taken: number; invoices_actioned: number; collected_after_action: number; collected_count: number;
  days_saved: number; avg_days_saved: number | null; interest_saved: number; upi_claims: number; upi_collected: number;
  trend?: { month: string; dso: number | null; late_share: number | null }[];
};
export type Lang = "en" | "hi" | "mr";
export type Me = { user: { id: number; name: string; email: string }; org: Org; assistant_enabled: boolean };

export type Invoice = {
  id: number; number: string; buyer_id: number; buyer_name: string; amount: number;
  invoice_date: string; due_date: string; paid_date: string | null; status: "open" | "overdue" | "paid";
  days_overdue: number; days_to_due: number; disputed: boolean; docs_pending: boolean;
  promise_date: string | null; snoozed_until: string | null; risk: number; risk_band: "high" | "medium" | "low";
  expected_pay_date: string | null; range_start: string | null; range_end: string | null;
  action: string | null; action_title: string; action_short: string; action_tone: string;
  rationale: string | null; value: number; reasons: string[]; priority: number;
  buyer_phone: string; buyer_email: string;
  other_open_count?: number; other_open_amount?: number;
  claim_at: string | null; claim_ref: string; interest?: Interest | null; pay_url?: string;
  message?: string; message_lang?: Lang; internal_action?: boolean; whatsapp_url?: string; email_url?: string;
};
export type InvoiceDetail = Invoice & {
  timeline: { kind: string; at: string; note: string; channel?: string }[];
  pmf: number[]; buyer: Customer | null;
};
export type Summary = {
  outstanding: number; open_count: number; overdue: number; overdue_count: number; at_risk: number;
  high_risk_count: number; past_45_amount: number; past_45_count: number; interest_cost: number;
  cash_gap_4w: number; expected_4w: number; assumed_4w: number; gap_date: string | null; dso: number | null;
};
export type Customer = {
  id: number; name: string; phone: string; email: string; segment: string; is_government: boolean;
  treds_onboarded: boolean; invoices_12m: number; avg_days_late: number | null; pct_late15: number | null;
  recent_days_late: number | null; trend: "worse" | "better" | "steady" | null; score: number | null;
  grade: "A" | "B" | "C" | "D" | null; advice: string; open_amount: number; open_count: number;
  at_risk: number; overdue_amount: number;
};
export type ForecastWeek = {
  week: string; assumed: number; expected: number; cum_assumed: number; cum_expected: number;
  cum_low: number; cum_high: number;
};
