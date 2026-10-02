import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Brain, CalendarCheck2, Check, Copy, FileText, FileWarning, Link2, Mail, MessageCircleWarning, Phone, Scale, Sparkles, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { toast } from "sonner";
import { tooltipProps } from "../lib/chart";
import { api, type Customer, type Invoice, type InvoiceDetail, type Lang } from "../lib/api";
import { useMe } from "../lib/auth";
import { cx, d, inr, inrShort, lateness, pct } from "../lib/format";
import { LANGS } from "../lib/i18n";
import { useInvoiceActions } from "../lib/useInvoiceActions";
import { ACTION_ICON, statusLine, withTerms } from "./ActionCard";
import { PaidModal, PromiseModal } from "./StatusModals";
import { Avatar, Badge, Button, Card, Drawer, Grade, Input, RiskPill, Segmented, Skeleton, Term, Toggle } from "./ui";

type Ctx = { openInvoice: (id: number) => void; openCustomer: (id: number) => void };
const DrawerCtx = createContext<Ctx>({ openInvoice: () => {}, openCustomer: () => {} });
export const useDrawers = () => useContext(DrawerCtx);

export function DrawerProvider({ children }: { children: ReactNode }) {
  // Deep links: ?invoice=123 or ?customer=45 open that panel directly (shareable, bookmarkable).
  const [inv, setInv] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get("invoice")) || null);
  const [cust, setCust] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get("customer")) || null);
  return (
    <DrawerCtx.Provider value={{ openInvoice: (id) => { setCust(null); setInv(id); }, openCustomer: (id) => { setInv(null); setCust(id); } }}>
      {children}
      <Drawer open={inv !== null} onClose={() => setInv(null)}>{inv !== null && <InvoicePanel id={inv} onCustomer={(id) => { setInv(null); setCust(id); }} />}</Drawer>
      <Drawer open={cust !== null} onClose={() => setCust(null)}>{cust !== null && <CustomerPanel id={cust} onInvoice={(id) => { setCust(null); setInv(id); }} />}</Drawer>
    </DrawerCtx.Provider>
  );
}

const BIN_LABELS = ["On time", "1-7d", "8-15d", "16-30d", "31-45d", "46-60d", "61-90d", "90d+"];
const localIso = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const dayNum = (iso: string) => new Date(iso + "T00:00:00").getTime() / 86400000;

function PaymentTimeline({ inv }: { inv: InvoiceDetail }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0 = dayNum(inv.invoice_date);
  const tToday = today.getTime() / 86400000;
  const end = Math.max(dayNum(inv.range_end ?? inv.due_date), tToday + 7) + 4;
  const pos = (x: number) => `${Math.min(100, Math.max(0, ((x - t0) / (end - t0)) * 100))}%`;
  const due = dayNum(inv.due_date), exp = dayNum(inv.expected_pay_date!), lo = dayNum(inv.range_start!), hi = dayNum(inv.range_end!);
  const marks = [
    { x: t0, label: "Raised", date: inv.invoice_date, cls: "bg-slate-400" },
    { x: due, label: "Due", date: inv.due_date, cls: "bg-slate-700 dark:bg-slate-300" },
    { x: tToday, label: "Today", date: localIso(today), cls: "bg-brand-600" },
  ];
  return (
    <div className="pt-8 pb-10">
      <div className="relative h-2.5 rounded-full surface-2">
        <div className="absolute inset-y-0 rounded-full bg-rose-200/70 dark:bg-rose-500/25" style={{ left: pos(due), width: `calc(${pos(Math.max(tToday, due))} - ${pos(due)})` }} />
        <div className="absolute inset-y-[-3px] rounded-full bg-brand-200/80 dark:bg-brand-500/30" style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }} />
        {marks.map((m) => (
          <div key={m.label} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: pos(m.x) }}>
            <div className={cx("size-3 rounded-full ring-4 ring-[var(--surface)]", m.cls)} />
            <div className="absolute top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-[11px] ink-3">{m.label}<div className="ink-2 font-medium">{d(m.date)}</div></div>
          </div>
        ))}
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: pos(exp) }}>
          <div className="size-4 rounded-full bg-emerald-500 ring-4 ring-[var(--surface)]" />
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white shadow">Expected {d(inv.expected_pay_date)}</div>
        </div>
      </div>
    </div>
  );
}

function InvoicePanel({ id, onCustomer }: { id: number; onCustomer: (id: number) => void }) {
  const demo = !!useMe().data?.org.is_demo;   // shared demo: no real phone numbers saved where other visitors can see them
  const [lang, setLang] = useState<Lang | null>(null);   // null = the customer's language, else the business default
  const { data: inv, isLoading } = useQuery<InvoiceDetail>({ queryKey: ["invoice", id, lang], queryFn: () => api(`/invoices/${id}${lang ? `?lang=${lang}` : ""}`) });
  const act = useInvoiceActions();
  const [text, setText] = useState("");
  const [modal, setModal] = useState<"promise" | "paid" | null>(null);
  const [phone, setPhone] = useState("");
  useEffect(() => { if (inv?.message) setText(inv.message); }, [inv?.message]);
  const qc = useQueryClient();

  if (isLoading || !inv) return <div className="space-y-4 p-6 pt-16"><Skeleton className="h-20" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  const open = !inv.paid_date;
  const pmf = inv.pmf.map((p, i) => ({ name: BIN_LABELS[i], p: Math.round(p * 100) }));

  async function savePhone() {
    try {
      await api(`/buyers/${inv!.buyer_id}`, { method: "PATCH", json: { phone } });
      toast.success("WhatsApp number saved");
      qc.invalidateQueries({ queryKey: ["invoice", id] });
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-5 sm:p-7">
      <div className="flex items-center gap-3 pr-10">
        <Avatar name={inv.buyer_name} size={48} />
        <div className="min-w-0">
          <button onClick={() => onCustomer(inv.buyer_id)} className="focus-ring truncate text-left text-lg font-semibold ink hover:text-brand-600">{inv.buyer_name}</button>
          <div className="text-sm ink-3">Invoice {inv.number} · raised {d(inv.invoice_date, { day: "numeric", month: "short", year: "numeric" })}</div>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <div className="text-4xl font-semibold tracking-tight num ink">{inr(inv.amount)}</div>
        <div className="flex flex-wrap gap-1.5">
          {inv.paid_date ? <Badge tone="green" icon={<Check className="size-3" />}>Paid {d(inv.paid_date)}</Badge> : <>{statusLine(inv)}<RiskPill band={inv.risk_band} risk={inv.risk} overdue={inv.days_overdue} /></>}
          {inv.disputed && <Badge tone="amber">Disputed</Badge>}
          {inv.docs_pending && <Badge tone="amber">Paperwork pending</Badge>}
        </div>
      </div>

      {open && inv.expected_pay_date && (
        <Card className="mt-6 p-5" data-tour="drawer-when">
          <h3 className="font-semibold ink">When will this be paid?</h3>
          <p className="mt-1 text-sm ink-2">
            Most likely around <strong className="ink">{d(inv.expected_pay_date)}</strong> - somewhere between {d(inv.range_start)} and {d(inv.range_end)}.
          </p>
          <PaymentTimeline inv={inv} />
          <div className="mt-2 text-xs font-medium ink-2">Chance of payment, by days after the due date</div>
          <div className="mt-2 h-36">
            <ResponsiveContainer>
              <BarChart data={pmf} margin={{ left: -24, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip {...tooltipProps} formatter={(v: number) => [`${v}%`, "Chance"]} />
                <Bar dataKey="p" radius={[6, 6, 0, 0]}>{pmf.map((e, i) => <Cell key={i} fill={i >= 3 ? "#f43f5e" : i >= 1 ? "#f59e0b" : "#10b981"} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {open && inv.claim_at && (
        <Card className="mt-4 flex flex-col gap-3 border-emerald-300 bg-emerald-50 p-5 sm:flex-row sm:items-center dark:bg-emerald-500/10">
          <BadgeCheck className="size-8 shrink-0 text-emerald-600" />
          <div className="flex-1 text-sm">
            <div className="font-semibold ink">Customer says they've paid via UPI</div>
            <div className="ink-2">{inv.claim_ref ? `Reference ${inv.claim_ref} · ` : ""}{d(inv.claim_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. Check your bank, then confirm.</div>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => setModal("paid")}>Received</Button>
            <Button onClick={() => act.rejectClaim(inv.id)}>Not found</Button>
          </div>
        </Card>
      )}

      {open && inv.interest?.applies && (
        <Card className="mt-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 font-semibold ink"><Scale className="size-4 text-rose-500" />Interest they legally owe you</h3>
              <p className="mt-1 text-sm ink-2">
                Under the <Term k="MSMED">MSMED Act</Term> (Sec 16): {inv.interest.days} days since {d(inv.interest.from)} at {(inv.interest.rate * 100).toFixed(2)}% a year
                (3× RBI bank rate), compounded monthly.
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold num text-rose-600">{inr(inv.interest.interest)}</div>
              <div className="text-xs ink-3">Total claim {inr(inv.interest.total)}</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon={<FileText className="size-4" />} onClick={() => window.open(`/notice/${inv.buyer_id}`, "_blank")}>Generate legal notice</Button>
            <span className="self-center text-xs ink-3">Covers all of this customer's overdue invoices. Review with your CA before sending.</span>
          </div>
        </Card>
      )}

      {open && <AIExplain id={inv.id} reasons={inv.reasons} />}

      {open && inv.action && (
        <Card className="mt-4 overflow-hidden" data-tour="drawer-message">
          <div className="border-b line bg-gradient-to-br from-brand-50 to-violet-50 p-5 dark:from-brand-500/10 dark:to-violet-500/10">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-200"><Sparkles className="size-3.5" />Recommended next step</div>
            <div className="mt-2 flex items-center gap-2 text-lg font-semibold ink">{ACTION_ICON[inv.action]}{inv.action_title}</div>
            <p className="mt-1 text-sm leading-relaxed ink-2">{withTerms(inv.rationale)}</p>
            {inv.value > 0 && <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">Worth about {inr(inv.value)} to act now</p>}
          </div>
          <div className="p-5">
            {inv.internal_action ? (
              <>
                <p className="text-sm ink-2">{inv.message}</p>
                <Button className="mt-4" variant="primary" icon={<Check className="size-4" />} onClick={() => act.done(inv, inv.action === "TREDS" ? "treds" : "manual")}>Mark as done</Button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium ink">Message</span>
                  <Segmented size="sm" value={lang ?? inv.message_lang ?? "en"} onChange={setLang} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
                </div>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8}
                  className="focus-ring mt-3 w-full rounded-xl border line bg-[var(--bg)] p-3.5 text-sm leading-relaxed ink" />
                {!inv.buyer_phone && !demo && (
                  <div className="mt-3">
                    <div className="flex items-end gap-2">
                      <div className="flex-1"><Input label="Their WhatsApp number" placeholder="98xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                      <Button className="h-11" onClick={savePhone} disabled={phone.replace(/\D/g, "").length < 10} icon={<Phone className="size-4" />}>Save</Button>
                    </div>
                    <span className="mt-1 block text-xs ink-3">Saved to this customer for next time</span>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="whatsapp" onClick={() => act.sendWhatsApp(inv as Invoice, text)}>Send on WhatsApp</Button>
                  <Button icon={<Mail className="size-4" />} onClick={() => act.sendEmail(inv as Invoice, text)}>Email</Button>
                  <Button variant="ghost" icon={<Copy className="size-4" />} onClick={() => act.copy(inv as Invoice, text)}>Copy</Button>
                </div>
                {inv.pay_url ? (
                  <div className="mt-4 flex items-center gap-2 rounded-xl surface-2 p-2.5 text-xs">
                    <Link2 className="size-4 shrink-0 text-brand-500" />
                    <span className="ink-2">UPI pay link included -</span>
                    <a href={inv.pay_url} target="_blank" rel="noreferrer" className="truncate font-medium text-brand-600 hover:underline">preview what the customer sees</a>
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl surface-2 p-2.5 text-xs ink-2">Tip: add your UPI ID in Settings and every message will include a one-tap payment link.</p>
                )}
                <p className="mt-3 text-xs ink-3">You review every message before it's sent. Not legal advice - confirm formal notices with your CA.</p>
              </>
            )}
          </div>
        </Card>
      )}

      {open && (
        <Card className="mt-4 p-5" data-tour="drawer-status">
          <h3 className="font-semibold ink">Update status</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button icon={<CalendarCheck2 className="size-4" />} onClick={() => setModal("promise")}>Promised a date</Button>
            <Button icon={<Check className="size-4" />} onClick={() => setModal("paid")}>Payment received</Button>
            <Button icon={<MessageCircleWarning className="size-4" />} onClick={() => act.toggle(inv.id, inv.disputed ? "DISPUTE_RESOLVED" : "DISPUTE", inv.disputed ? "Dispute marked resolved" : "Dispute recorded - advice updated")}>{inv.disputed ? "Dispute resolved" : "They raised a dispute"}</Button>
            <Button icon={<FileWarning className="size-4" />} onClick={() => act.toggle(inv.id, inv.docs_pending ? "DOCS_OK" : "DOCS_PENDING", inv.docs_pending ? "Paperwork marked complete" : "Paperwork marked pending")}>{inv.docs_pending ? "Paperwork done" : "Paperwork pending"}</Button>
          </div>
        </Card>
      )}

      {inv.buyer && (
        <Card className="mt-4 p-5">
          <div className="flex items-center gap-3">
            <Grade g={inv.buyer.grade} size="lg" />
            <div className="flex-1">
              <div className="font-semibold ink">Customer grade {inv.buyer.grade ?? "-"}</div>
              <div className="text-sm ink-2">{inv.buyer.advice}</div>
            </div>
            <Button variant="ghost" onClick={() => onCustomer(inv.buyer_id)}>View</Button>
          </div>
        </Card>
      )}

      <Card className="mt-4 p-5">
        <h3 className="font-semibold ink">Activity</h3>
        <ol className="mt-3 space-y-3 border-l line pl-4">
          {inv.timeline.map((e, i) => (
            <li key={i} className="relative text-sm">
              <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-[var(--surface)] ring-2 ring-brand-500" />
              <span className="ink">{e.note || e.kind.replace(/_/g, " ").toLowerCase()}</span>
              {e.channel && <span className="ink-3"> · via {e.channel}</span>}
              <span className="block text-xs ink-3">{d(e.at, { day: "numeric", month: "short", year: "numeric" })}</span>
            </li>
          ))}
        </ol>
      </Card>
      <PromiseModal open={modal === "promise"} onClose={() => setModal(null)} onSave={(w) => act.promise(inv.id, w)} />
      <PaidModal open={modal === "paid"} onClose={() => setModal(null)} amount={inv.amount} onSave={(w) => act.paid(inv.id, w)} />
    </div>
  );
}

function CustomerPanel({ id, onInvoice }: { id: number; onInvoice: (id: number) => void }) {
  const demo = !!useMe().data?.org.is_demo;
  const qc = useQueryClient();
  const { data: buyers } = useQuery<Customer[]>({ queryKey: ["buyers"], queryFn: () => api("/buyers") });
  const { data: hist } = useQuery<{ number: string; invoice_date: string; amount: number; days_late: number }[]>({ queryKey: ["buyer-history", id], queryFn: () => api(`/buyers/${id}/history`) });
  const { data: open } = useQuery<{ items: Invoice[] }>({ queryKey: ["invoices", "buyer", id], queryFn: () => api(`/invoices?status=open&buyer_id=${id}`) });
  const c = buyers?.find((b) => b.id === id);
  const [phone, setPhone] = useState(""); const [email, setEmail] = useState("");
  useEffect(() => { if (c) { setPhone(c.phone); setEmail(c.email); } }, [c?.id]);
  if (!c) return <div className="space-y-4 p-6 pt-16"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>;
  const patch = async (body: object, msg = "Saved") => {
    try {
      await api(`/buyers/${id}`, { method: "PATCH", json: body });
      toast.success(msg);
      qc.invalidateQueries();
    } catch (e: any) { toast.error(e.message); }
  };
  const points = (hist ?? []).map((h) => ({ x: dayNum(h.invoice_date), y: h.days_late, z: h.amount, n: h.number }));
  const TrendIcon = c.trend === "worse" ? TrendingUp : c.trend === "better" ? TrendingDown : Minus;

  return (
    <div className="p-5 sm:p-7">
      <div className="flex items-center gap-4 pr-10">
        <Grade g={c.grade} size="lg" />
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold ink">{c.name}</h2>
          <p className="text-sm ink-2">{c.advice}</p>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["They owe you", inrShort(c.open_amount)], ["Usually pays", lateness(c.avg_days_late)],
          ["Paid 15+ days late", pct(c.pct_late15)], ["Invoices (12 m)", String(c.invoices_12m)],
        ].map(([l, v]) => <Card key={l} className="p-3.5"><div className="text-xs ink-3">{l}</div><div className="mt-1 text-lg font-semibold num ink">{v}</div></Card>)}
      </div>
      {c.trend && (
        <div className={cx("mt-3 flex items-center gap-2 rounded-xl p-3 text-sm", c.trend === "worse" ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" : c.trend === "better" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "surface-2 ink-2")}>
          <TrendIcon className="size-4" />
          {c.trend === "worse" ? `Getting slower - last 3 payments averaged ${lateness(c.recent_days_late, true)}.` : c.trend === "better" ? `Improving - last 3 payments averaged ${lateness(c.recent_days_late, true)}.` : "Payment behaviour is steady."}
        </div>
      )}
      {c.overdue_amount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button icon={<FileText className="size-4" />} onClick={() => window.open(`/notice/${c.id}`, "_blank")}>Legal notice with interest</Button>
          <span className="text-xs ink-3">{inrShort(c.overdue_amount)} overdue</span>
        </div>
      )}
      <Card className="mt-4 p-5">
        <h3 className="font-semibold ink">Payment history</h3>
        <p className="text-xs ink-3">Each dot is an invoice: how many days after the due date it was paid.</p>
        <div className="mt-3 h-52">
          <ResponsiveContainer>
            <ScatterChart margin={{ left: -16, right: 8, top: 8 }}>
              <CartesianGrid stroke="var(--line)" />
              <XAxis type="number" dataKey="x" domain={["dataMin", "dataMax"]} tickFormatter={(v) => new Date(v * 86400000).toLocaleDateString("en-IN", { month: "short", year: "numeric" })} tick={{ fontSize: 11 }} />
              <YAxis type="number" dataKey="y" tick={{ fontSize: 11 }} unit="d" />
              <ZAxis type="number" dataKey="z" range={[30, 220]} />
              <ReferenceLine y={0} stroke="#10b981" strokeDasharray="4 4" />
              <ReferenceLine y={15} stroke="#f43f5e" strokeDasharray="4 4" />
              <Tooltip {...tooltipProps} formatter={(v: number, n: string) => (n === "y" ? [lateness(v, true), "Paid"] : n === "z" ? [inr(v), "Amount"] : [v, n])} labelFormatter={() => ""} />
              <Scatter data={points} fill="#6366f1" fillOpacity={0.7} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
      {open && open.items.length > 0 && (
        <Card className="mt-4 p-2">
          <h3 className="px-3 pt-3 font-semibold ink">Unpaid invoices</h3>
          {open.items.map((i) => (
            <button key={i.id} onClick={() => onInvoice(i.id)} className="focus-ring flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-[var(--surface-2)]">
              <div><div className="text-sm font-medium ink">{i.number}</div><div className="text-xs ink-3">{i.action_title}</div></div>
              <div className="text-right"><div className="text-sm font-semibold num ink">{inr(i.amount)}</div>{statusLine(i)}</div>
            </button>
          ))}
        </Card>
      )}
      <Card className="mt-4 space-y-4 p-5">
        <h3 className="font-semibold ink">Contact & settings</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="WhatsApp number" value={phone} disabled={demo} onChange={(e) => setPhone(e.target.value)} onBlur={() => phone !== c.phone && patch({ phone }, "WhatsApp number saved")} />
          <Input label="Accounts email" value={email} disabled={demo} onChange={(e) => setEmail(e.target.value)} onBlur={() => email !== c.email && patch({ email }, "Email saved")} />
          {demo && <p className="text-xs ink-3 sm:col-span-2">Contact details can't be saved in the shared demo. WhatsApp still opens so you can pick any chat to preview the message.</p>}
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium ink">Message language</span>
          <Segmented<Lang | ""> value={c.language ?? ""} onChange={(v) => patch({ language: v }, "Message language saved")}
            options={[{ value: "", label: "Business default" }, ...LANGS.map((l) => ({ value: l.code, label: l.label }))]} />
          <span className="mt-1 block text-xs ink-3">Reminders to this customer are drafted in this language.</span>
        </div>
        <Toggle checked={c.is_government} onChange={(v) => patch({ is_government: v })} label="Government department"
          hint="The 45-day law still applies; the 43B(h) tax lever doesn't." />
        <Toggle checked={c.treds_onboarded} onChange={(v) => patch({ treds_onboarded: v })}
          label={<>Registered on <Term k="TReDS" /></>} hint="Lets PayPredict suggest getting paid today by selling their invoices." />
      </Card>
    </div>
  );
}

type Explain = { predicted_days: number; typical_days: number; factors: { feature: string; label: string; days: number }[]; model: string };

/** Explainable AI: how many days of delay each factor adds to this invoice's forecast vs a typical invoice. */
function AIExplain({ id, reasons }: { id: number; reasons: string[] }) {
  const { data } = useQuery<Explain>({ queryKey: ["explain", id], queryFn: () => api(`/invoices/${id}/explain`), staleTime: 300_000 });
  const fx = (data?.factors ?? []).filter((f) => Math.abs(f.days) >= 0.5).slice(0, 6);
  const max = Math.max(1, ...fx.map((f) => Math.abs(f.days)));
  return (
    <Card className="mt-4 p-5" data-tour="drawer-why">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><Brain className="size-4" /></span>
        <div className="flex-1">
          <h3 className="font-semibold ink">Why the AI expects this timing</h3>
          {data ? (
            <p className="text-xs ink-2">A typical invoice is paid <b className="ink">{lateness(data.typical_days, true)}</b>. For this one the model expected
              {" "}<b className="ink">{lateness(data.predicted_days, true)}</b> when it was raised. Each bar shows how much a factor moves that.</p>
          ) : <Skeleton className="mt-1 h-3 w-3/4" />}
        </div>
      </div>
      {data && fx.length > 0 && (
        <div className="mt-4 space-y-2">
          {fx.map((f) => (
            <div key={f.feature} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_52px] items-center gap-3 text-sm">
              <span className="truncate ink-2" title={f.label}>{f.label}</span>
              <span className="h-2.5 overflow-hidden rounded-full surface-2">
                <span className={cx("block h-full rounded-full", f.days > 0 ? "bg-gradient-to-r from-rose-400 to-rose-500" : "bg-emerald-500")} style={{ width: `${(Math.abs(f.days) / max) * 100}%` }} />
              </span>
              <span className={cx("text-right font-semibold num", f.days > 0 ? "text-rose-600" : "text-emerald-600")}>{f.days > 0 ? "+" : "-"}{Math.abs(f.days).toFixed(0)}d</span>
            </div>
          ))}
        </div>
      )}
      {reasons.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t line pt-3">
          {reasons.map((r) => <li key={r} className="flex gap-2.5 text-sm ink-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-violet-500" />{r}</li>)}
        </ul>
      )}
      <p className="mt-3 text-[11px] ink-3">Measured by re-running the time-to-payment model with each factor set to a typical value (ablation). Bars are approximate and don't add up exactly.</p>
    </Card>
  );
}
