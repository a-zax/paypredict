import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Copy, MessageSquareText, ScanSearch, Shapes, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { toast } from "sonner";
import { axisTick, tooltipProps } from "../lib/chart";
import { api, type InvoiceDetail } from "../lib/api";
import { cx, d, inr, inrShort, pct } from "../lib/format";
import { useDrawers } from "./Drawers";
import { Badge, Button, Card, Skeleton } from "./ui";

// ------------------------------------------------------------------ types
export type Persona = { key: string; label: string; strategy: string; color: string; customers: number; owed: number; profile: Record<string, number>; examples: string[] };
export type Personas = { available: boolean; reason?: string; groups: Persona[]; points: { id: number; name: string; persona: string; x: number; y: number; owed: number }[];
  silhouette: number | null; features: string[]; explained: number[]; n: number; by_customer: Record<string, string> };
export type Anomaly = { invoice_id: number; number: string; customer_id: number; name: string; amount: number; score: number; reasons: string[] };
type Health = { available: boolean; status: "stable" | "watch" | "retrain"; drift: { feature: string; label: string; psi: number; status: string }[];
  calibration?: { predicted: number; actual: number; n: number }[] | null; brier?: number | null; ece?: number | null;
  late_rate_recent: number | null; late_rate_before: number | null; n_recent: number; n_reference: number };
type ReplyRead = {
  intent: string; label: string; confidence: number; alternatives: { intent: string; label: string; p: number }[];
  when: string | null; when_phrase: string; amount: number | null; partial: boolean; reference: string | null; lang: string;
  p_keep?: number | null; p_model?: number | null; promises_kept?: number; promises_total?: number; days_vs_forecast?: number;
  discount_cost?: number; waiting_cost?: number; discount_worth_it?: boolean;
  next_step: string; reply: string; apply: { kind: string; when?: string; note?: string; label: string }[];
};

export const usePersonas = () => useQuery<Personas>({ queryKey: ["personas"], queryFn: () => api("/ai/personas"), staleTime: 300_000 });
export const useAnomalies = () => useQuery<Anomaly[]>({ queryKey: ["anomalies"], queryFn: () => api("/ai/anomalies"), staleTime: 300_000 });

const INTENT_TONE: Record<string, "green" | "amber" | "red" | "blue" | "gray"> = {
  PROMISE: "blue", PAID: "green", DISPUTE: "red", DOCS: "amber", CASH_CRUNCH: "amber", DISCOUNT: "amber", ACK: "gray",
};
const EXAMPLES = ["Will pay by next Friday", "NEFT done, UTR 452198763321", "Material damaged, quantity short", "kal tak payment ho jayega", "Can you give 2% discount?"];

// ------------------------------------------------------------------ 1. reply reader (invoice panel)
/** Paste what the customer wrote back; Munim classifies it, extracts the date / amount / bank reference,
 *  estimates whether a promise will hold, and drafts the reply. */
export function ReplyReader({ inv }: { inv: InvoiceDetail }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [res, setRes] = useState<ReplyRead | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);

  async function read(t = text) {
    if (t.trim().length < 2) return;
    setBusy(true); setApplied(false);
    try {
      const r = await api<ReplyRead>(`/invoices/${inv.id}/read-reply`, { method: "POST", json: { text: t } });
      setRes(r); setReply(r.reply);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function apply() {
    if (!res) return;
    setBusy(true);
    try {
      for (const a of res.apply) await api(`/invoices/${inv.id}/log`, { method: "POST", json: { kind: a.kind, note: a.note ?? "", when: a.when ?? null } });
      for (const k of ["today", "invoices", "buyers", "forecast", "invoice", "briefing", "alerts"]) qc.invalidateQueries({ queryKey: [k] });
      setApplied(true);
      toast.success("Saved - Munim updated its advice", { description: res.apply.filter((a) => a.kind !== "NOTE").map((a) => a.label).join(" · ") || "Reply saved to the timeline" });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const wa = `https://wa.me/${(inv.buyer_phone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(reply)}`;

  return (
    <Card className="mt-4 p-5" data-tour="drawer-reply">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"><MessageSquareText className="size-4" /></span>
        <div className="flex-1">
          <h3 className="font-semibold ink">Customer replied? Let Munim read it</h3>
          <p className="text-xs ink-2">Paste their WhatsApp or email reply in any language. Munim works out what they mean, how likely a promise is to hold, and what to do next.</p>
        </div>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="e.g. Sir, payment will be released next Friday"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) read(); }}
        className="focus-ring mt-3 w-full rounded-xl border line bg-[var(--bg)] p-3 text-sm ink placeholder:text-[var(--ink-3)]" />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {EXAMPLES.map((x) => (
          <button key={x} onClick={() => { setText(x); read(x); }} className="focus-ring rounded-full surface-2 px-2.5 py-1 text-[11px] ink-2 hover:text-brand-600">{x}</button>
        ))}
        <Button className="ml-auto" size="sm" variant="primary" loading={busy && !res} disabled={text.trim().length < 2} icon={<Wand2 className="size-4" />} onClick={() => read()}>Read reply</Button>
      </div>

      {res && (
        <div className="mt-4 space-y-3 border-t line pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={INTENT_TONE[res.intent] ?? "gray"}>{res.label}</Badge>
            <span className="text-xs ink-3">{pct(res.confidence)} confident{res.alternatives[0] ? ` · next: ${res.alternatives[0].label} ${pct(res.alternatives[0].p)}` : ""}</span>
          </div>
          {(res.when || res.amount || res.reference) && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {res.when && <span className="rounded-lg bg-brand-50 px-2 py-1 text-brand-700 dark:bg-brand-500/10 dark:text-brand-200">Date: <b>{d(res.when, { weekday: "short", day: "numeric", month: "short" })}</b> <span className="opacity-70">("{res.when_phrase}")</span></span>}
              {res.amount && <span className="rounded-lg bg-brand-50 px-2 py-1 text-brand-700 dark:bg-brand-500/10 dark:text-brand-200">Amount: <b>{inr(res.amount)}</b>{res.partial ? " (part payment)" : ""}</span>}
              {res.reference && <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Bank ref: <b>{res.reference}</b></span>}
            </div>
          )}
          {res.p_keep != null && (
            <div className="rounded-xl surface-2 p-3">
              <div className="flex items-baseline justify-between gap-2 text-sm"><span className="ink-2">Chance they keep this promise</span>
                <b className={cx("text-lg num", res.p_keep >= 0.6 ? "text-emerald-600" : res.p_keep >= 0.35 ? "text-amber-600" : "text-rose-600")}>{pct(res.p_keep)}</b></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface)]">
                <div className={cx("h-full rounded-full", res.p_keep >= 0.6 ? "bg-emerald-500" : res.p_keep >= 0.35 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${res.p_keep * 100}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] ink-3">Survival model: {pct(res.p_model ?? 0)} chance of payment by then given their habits{res.promises_total ? ` · past promises kept: ${res.promises_kept} of ${res.promises_total}` : ""}.
                {res.days_vs_forecast != null && res.days_vs_forecast > 0 ? ` If kept, cash arrives ${res.days_vs_forecast} days earlier than the AI expected.` : ""}</p>
            </div>
          )}
          {res.discount_cost != null && (
            <div className="rounded-xl surface-2 p-3 text-xs ink-2">Discount costs <b className="ink">{inr(res.discount_cost)}</b> · waiting costs about <b className="ink">{inr(res.waiting_cost ?? 0)}</b> in interest → {res.discount_worth_it ? "offer it" : "decline politely"}.</div>
          )}
          <div className="flex gap-2 rounded-xl bg-violet-50 p-3 text-sm text-violet-900 dark:bg-violet-500/10 dark:text-violet-200"><Sparkles className="mt-0.5 size-4 shrink-0" />{res.next_step}</div>
          <div>
            <div className="text-xs font-medium ink-2">Suggested reply</div>
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={5} className="focus-ring mt-1.5 w-full rounded-xl border line bg-[var(--bg)] p-3 text-sm leading-relaxed ink" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy} disabled={applied} onClick={apply}>{applied ? "Saved" : res.apply.length > 1 ? `Apply: ${res.apply.filter((a) => a.kind !== "NOTE").map((a) => a.label.toLowerCase()).join(", ")}` : "Save reply to timeline"}</Button>
            <a href={wa} target="_blank" rel="noreferrer" className="focus-ring inline-flex h-10 items-center rounded-xl bg-[#1faa53] px-4 text-sm font-medium text-white hover:bg-[#178f45]">Reply on WhatsApp</a>
            <Button variant="ghost" icon={<Copy className="size-4" />} onClick={() => { navigator.clipboard.writeText(reply); toast.success("Copied"); }}>Copy</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ 2. personas
export function PersonaMap({ compact = false }: { compact?: boolean }) {
  const { data } = usePersonas();
  const { openCustomer } = useDrawers();
  if (!data) return <Skeleton className="mt-3 h-72" />;
  if (!data.available) return <Card className="mt-3 p-5 text-sm ink-2">{data.reason}</Card>;
  return (
    <div className={cx("mt-3 grid gap-3", !compact && "lg:grid-cols-[1.25fr_1fr]")}>
      <Card className="p-5">
        <h3 className="font-semibold ink">Payment personas, learned from behaviour</h3>
        <p className="text-xs ink-3">Each dot is a customer, placed by 5 behaviour signals (PCA). K-means grouped {data.n} customers into 5 personas · silhouette {data.silhouette?.toFixed(2)}</p>
        <div className="mt-3 h-64">
          <ResponsiveContainer>
            <ScatterChart margin={{ left: -24, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid stroke="var(--line)" />
              <XAxis type="number" dataKey="x" tick={false} axisLine={false} name="Behaviour axis 1" />
              <YAxis type="number" dataKey="y" tick={false} axisLine={false} name="Behaviour axis 2" />
              <ZAxis type="number" dataKey="owed" range={[18, 160]} />
              <Tooltip {...tooltipProps} cursor={false} content={({ payload }) => {
                const p = payload?.[0]?.payload as Personas["points"][number] | undefined;
                if (!p) return null;
                const g = data.groups.find((x) => x.key === p.persona);
                return <div className="card px-3 py-2 text-xs shadow-[var(--shadow-pop)]"><div className="font-semibold ink">{p.name}</div><div style={{ color: g?.color }}>{g?.label}</div><div className="ink-3">owes {inrShort(p.owed)}</div></div>;
              }} />
              {data.groups.map((g) => (
                <Scatter key={g.key} name={g.label} data={data.points.filter((p) => p.persona === g.key)} fill={g.color} fillOpacity={0.75}
                  onClick={(p: any) => openCustomer(p.id)} className="cursor-pointer" />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid content-start gap-2">
        {data.groups.map((g) => (
          <Card key={g.key} className="p-3.5">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: g.color }} />
              <span className="font-semibold ink">{g.label}</span>
              <span className="ml-auto text-xs ink-3">{g.customers} customers · owe {inrShort(g.owed)}</span>
            </div>
            <p className="mt-1 text-xs ink-2">Usually ~{Math.round(g.profile.avg_late)} days late · spread ±{Math.round(g.profile.spread)}d{g.profile.trend > 8 ? ` · ${Math.round(g.profile.trend)}d slower lately` : ""}{g.profile.festive > 8 ? ` · +${Math.round(g.profile.festive)}d in Oct-Nov` : ""}</p>
            {!compact && <p className="mt-1 text-xs ink">{g.strategy}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 3. anomalies
export function AnomalyList() {
  const { data } = useAnomalies();
  const { openInvoice } = useDrawers();
  if (!data) return <Skeleton className="mt-3 h-40" />;
  return (
    <Card className="mt-3 overflow-hidden">
      {!data.length ? <p className="p-5 text-sm ink-2">Nothing unusual - amounts, credit periods and timing look normal for every customer.</p> : (
        <ul className="divide-y line">
          {data.map((a) => (
            <li key={a.invoice_id}>
              <button onClick={() => openInvoice(a.invoice_id)} className="focus-ring flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-[var(--surface-2)]">
                <ScanSearch className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium ink">{a.name} · {a.number}</span>
                  <span className="block text-xs ink-2">{a.reasons.join(" · ")}</span></span>
                <span className="text-sm font-semibold num ink">{inrShort(a.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ 4. model health
const STATUS = { stable: ["Healthy", "green"], watch: ["Watch", "amber"], retrain: ["Retrain", "red"], shifted: ["Shifted", "red"] } as const;

export function ModelHealth() {
  const { data } = useQuery<Health>({ queryKey: ["ai-health"], queryFn: () => api("/ai/health"), staleTime: 300_000 });
  if (!data) return <Skeleton className="mt-3 h-64" />;
  if (!data.available) return null;
  const cal = (data.calibration ?? []).map((c) => ({ x: Math.round(c.predicted * 100), y: Math.round(c.actual * 100), n: c.n }));
  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="font-semibold ink">Can you trust its percentages? (calibration)</h3>
        <p className="text-xs ink-3">Unseen test invoices grouped by predicted risk: when the AI says 70%, about 70% should really be paid 15+ days late. Closer to the diagonal is better.</p>
        {cal.length ? (
          <>
            <div className="mt-3 h-52">
              <ResponsiveContainer>
                <LineChart data={cal} margin={{ left: -18, right: 10, top: 8 }}>
                  <CartesianGrid stroke="var(--line)" />
                  <XAxis type="number" dataKey="x" domain={[0, 100]} unit="%" tick={axisTick} tickLine={false} axisLine={false} name="Predicted" />
                  <YAxis type="number" domain={[0, 100]} unit="%" tick={axisTick} tickLine={false} axisLine={false} />
                  <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="var(--ink-3)" strokeDasharray="4 4" />
                  <Tooltip {...tooltipProps} formatter={(v: number) => [`${v}%`, "Actually late"]} labelFormatter={(v) => `AI predicted ${v}%`} />
                  <Line dataKey="y" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 4, fill: "#7c3aed" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-xs ink-2">Average gap between predicted and actual: <b className="ink">{pct(data.ece ?? 0, 1)}</b> · Brier score <b className="ink">{data.brier?.toFixed(3)}</b> (lower is better)</p>
          </>
        ) : <p className="mt-3 text-sm ink-2">Retrain once to compute calibration.</p>}
      </Card>
      <Card className="p-5">
        <div className="flex items-center gap-2"><h3 className="flex-1 font-semibold ink">Is the world changing? (data drift)</h3><Badge tone={STATUS[data.status][1]}>{STATUS[data.status][0]}</Badge></div>
        <p className="text-xs ink-3">Population stability index: last 90 days ({data.n_recent} invoices) vs the year before ({data.n_reference}). Under 0.10 is stable, over 0.25 means retrain.</p>
        <div className="mt-4 space-y-2.5">
          {data.drift.map((x) => (
            <div key={x.feature} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_64px] items-center gap-3 text-sm">
              <span className="truncate ink-2">{x.label}</span>
              <span className="h-2 overflow-hidden rounded-full surface-2"><span className={cx("block h-full rounded-full", x.psi < 0.1 ? "bg-emerald-500" : x.psi < 0.25 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${Math.min(100, (x.psi / 0.3) * 100)}%`, minWidth: 4 }} /></span>
              <span className="text-right text-xs num ink-2">{x.psi.toFixed(2)}</span>
            </div>
          ))}
        </div>
        {data.late_rate_recent != null && data.late_rate_before != null && (
          <p className="mt-4 rounded-xl surface-2 p-3 text-xs ink-2"><Activity className="mr-1 inline size-3.5" />Share paid 15+ days late: <b className="ink">{pct(data.late_rate_recent)}</b> recently vs {pct(data.late_rate_before)} before.</p>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ 5. what-if (credit check)
export type WhatIf = { credit_days: number; p_late: number; days_to_cash: number; cost: number }[];

export function WhatIfTerms({ rows, current }: { rows: WhatIf; current: number }) {
  if (!rows?.length) return null;
  const max = Math.max(...rows.map((r) => r.days_to_cash));
  return (
    <div className="border-t line p-5 sm:p-6">
      <h3 className="flex items-center gap-2 font-semibold ink"><Shapes className="size-4 text-violet-500" />What if you change the credit period?</h3>
      <p className="text-xs ink-3">The same model re-scores this order under each credit period. Longer credit rarely makes a slow payer faster - it just pushes cash further out.</p>
      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.credit_days} className={cx("grid grid-cols-[64px_minmax(0,1fr)_86px_76px] items-center gap-3 rounded-lg px-2 py-1.5 text-sm", r.credit_days === current && "bg-violet-50 dark:bg-violet-500/10")}>
            <span className="font-medium ink">{r.credit_days} days</span>
            <span className="h-2.5 overflow-hidden rounded-full surface-2"><span className="block h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500" style={{ width: `${(r.days_to_cash / max) * 100}%` }} /></span>
            <span className="text-right text-xs ink-2">cash in ~{Math.round(r.days_to_cash)}d</span>
            <span className="text-right text-xs ink-3" title="Interest cost of waiting for the cash">{inrShort(r.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


