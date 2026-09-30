import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Copy, OctagonAlert, Search, ShieldAlert, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, Grade, Input, Segmented } from "../components/ui";
import { api, type Customer, type Lang } from "../lib/api";
import { LANGS } from "../lib/i18n";
import { cx, d, inr, inrShort, pct } from "../lib/format";
import { useMe } from "../lib/auth";
import { usePageTitle } from "../lib/theme";

type Result = {
  verdict: "APPROVE" | "CONDITIONS" | "HOLD"; headline: string; conditions: string[]; advance_pct: number; message: string | null;
  customer: string; grade: string | null; model: string; p_late: number; expected_days_late: number; range: [number, number];
  expected_pay_date: string; expected_days_to_cash: number; delay_cost: number; price_cushion: number; open_amount: number;
  overdue_amount: number; oldest_overdue_days: number; exposure_after: number; suggested_limit: number | null;
  monthly_billing: number; reasons: string[]; message_lang: Lang;
};
const V = {
  APPROVE: { cls: "from-emerald-500 to-emerald-600", icon: <CheckCircle2 className="size-7" /> },
  CONDITIONS: { cls: "from-amber-500 to-orange-500", icon: <ShieldAlert className="size-7" /> },
  HOLD: { cls: "from-rose-500 to-rose-600", icon: <OctagonAlert className="size-7" /> },
};

export function CreditCheck() {
  usePageTitle("Check a new order");
  const { data: me } = useMe();
  const { data: buyers } = useQuery<Customer[]>({ queryKey: ["buyers"], queryFn: () => api("/buyers") });
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Customer | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState<"15" | "30" | "45" | "60">("30");
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hi, setHi] = useState(0);   // highlighted suggestion; matches.length = the "New customer" row

  const matches = useMemo(() => (q && !picked ? (buyers ?? []).filter((b) => b.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : []), [q, picked, buyers]);
  const amt = Number(amount.replace(/[^\d.]/g, ""));
  const open = !!q && !picked && !isNew;

  function choose(i: number) {
    if (i < matches.length) { setPicked(matches[i]); setQ(matches[i].name); } else setIsNew(true);
  }
  function onKey(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = matches.length + 1;
      setHi((h) => (h + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") { e.preventDefault(); choose(hi); }
    else if (e.key === "Escape") setQ("");
  }

  async function check(o: { buyer?: Customer | null; amount?: number; lang?: Lang } = {}) {
    const buyer = o.buyer !== undefined ? o.buyer : isNew ? null : picked;
    setErr(""); setBusy(true);
    if (!o.lang) setRes(null);
    try {
      setRes(await api<Result>("/credit-check", { method: "POST", json: { buyer_id: buyer?.id ?? null, new_customer: buyer ? null : q,
        amount: o.amount ?? amt, credit_days: Number(days), lang: o.lang ?? null } }));
      try { localStorage.setItem(`pp_credit_checked_${me?.user.id ?? "anon"}`, "1"); } catch { /* ignore */ }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  // One click to see a real verdict: the customer with the most money overdue, ordering ₹3 lakh.
  function example() {
    const b = [...(buyers ?? [])].sort((x, y) => y.overdue_amount - x.overdue_amount)[0];
    if (!b) return;
    setPicked(b); setQ(b.name); setIsNew(false); setAmount("300000"); setDays("30");
    check({ buyer: b, amount: 300000 });
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight ink sm:text-3xl">Check a new order</h1>
      <p className="mt-1 ink-2">Before you dispatch on credit, see whether this customer is likely to pay on time - and on what terms to accept.</p>

      <Card className="mt-6 p-5 sm:p-6" data-tour="credit-form">
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div className="relative">
            <span className="mb-1.5 block text-sm font-medium ink">Customer</span>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 ink-3" />
              <input value={picked ? picked.name : q} onChange={(e) => { setQ(e.target.value); setPicked(null); setIsNew(false); setRes(null); setHi(0); }}
                onKeyDown={onKey} role="combobox" aria-expanded={open} aria-controls="credit-customers" aria-autocomplete="list"
                aria-activedescendant={open ? `credit-opt-${hi}` : undefined} aria-label="Customer"
                placeholder="Search your customers or type a new name"
                className="focus-ring h-11 w-full rounded-xl border line bg-[var(--surface)] pl-10 pr-3 text-sm ink placeholder:text-[var(--ink-3)]" />
            </div>
            {open && (
              <div id="credit-customers" role="listbox" className="card absolute z-20 mt-1 w-full overflow-hidden p-1 shadow-[var(--shadow-pop)]">
                {matches.map((b, i) => (
                  <button key={b.id} id={`credit-opt-${i}`} role="option" aria-selected={hi === i} onMouseEnter={() => setHi(i)} onClick={() => choose(i)}
                    className={cx("focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left", hi === i && "bg-[var(--surface-2)]")}>
                    <Grade g={b.grade} /><span className="flex-1 truncate text-sm ink">{b.name}</span><span className="text-xs ink-3">owes {inrShort(b.open_amount)}</span>
                  </button>
                ))}
                <button id={`credit-opt-${matches.length}`} role="option" aria-selected={hi === matches.length} onMouseEnter={() => setHi(matches.length)} onClick={() => choose(matches.length)}
                  className={cx("focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-brand-600", hi === matches.length && "bg-[var(--surface-2)]")}>
                  <UserPlus className="size-4" />New customer: “{q}”
                </button>
              </div>
            )}
            {isNew && <p className="mt-1.5 text-xs ink-3">New customer - no payment history yet.</p>}
          </div>
          <Input label="Order value (₹)" inputMode="numeric" placeholder="e.g. 3,00,000" value={amount}
            onChange={(e) => { setAmount(e.target.value); setRes(null); }} hint={amt ? inr(amt) : undefined} />
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-full">
            <span className="mb-1.5 block text-sm font-medium ink">Credit they're asking for</span>
            {/* "15d" on phones so all four fit without a scroll container */}
            <Segmented value={days} onChange={(v) => { setDays(v); setRes(null); }} options={["15", "30", "45", "60"].map((x) => ({ value: x as "15",
              label: <>{x}<span className="sm:hidden">d</span><span className="hidden sm:inline"> days</span></> }))} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!res && <Button variant="ghost" onClick={example} disabled={!buyers?.length || busy}>Try an example</Button>}
            <Button variant="primary" size="lg" loading={busy} disabled={!amt || (!picked && !(isNew && q))} onClick={() => check()}>Check this order</Button>
          </div>
        </div>
        {Number(days) > 45 && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Note: for micro & small suppliers, credit beyond 45 days isn't protected by the MSMED Act.</p>}
        {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}
      </Card>

      <AnimatePresence>
        {res && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="mt-4 overflow-hidden">
              <div className={cx("flex items-center gap-4 bg-gradient-to-br p-5 text-white sm:p-6", V[res.verdict].cls)}>
                {V[res.verdict].icon}
                <div className="flex-1">
                  <div className="text-xl font-semibold">{res.headline}</div>
                  <div className="text-sm text-white/85">{res.customer} · {inr(amt)} on {days}-day credit</div>
                </div>
                {res.grade && <div className="rounded-xl bg-white/20 px-3 py-1.5 text-center" title="Grade from their past payments. The verdict also weighs what they owe today."><div className="text-[11px] uppercase tracking-wide text-white/80">Grade</div><div className="text-xl font-bold">{res.grade}</div></div>}
              </div>
              <div className="grid gap-px bg-[var(--line)] sm:grid-cols-3">
                {[
                  ["Expected payment", `~${d(res.expected_pay_date)}`, `${Math.round(res.expected_days_to_cash)} days to cash`],
                  ["Chance of paying 15+ days late", pct(res.p_late), res.model === "starter" ? "starter model" : "from their history"],
                  ["Cost of the expected delay", inr(res.delay_cost), res.price_cushion > 0.001 ? `≈ ${pct(res.price_cushion, 1)} of order value` : "negligible"],
                ].map(([l, v, h]) => (
                  <div key={l} className="bg-[var(--surface)] p-5"><div className="text-xs ink-3">{l}</div><div className="mt-1 text-2xl font-semibold num ink">{v}</div><div className="text-xs ink-3">{h}</div></div>
                ))}
              </div>
              <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-2">
                <div>
                  <h3 className="font-semibold ink">What to do</h3>
                  <ul className="mt-3 space-y-2">
                    {res.conditions.map((c) => <li key={c} className="flex gap-2.5 text-sm ink-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-500" />{c}</li>)}
                  </ul>
                  {res.reasons.length > 0 && (<><h3 className="mt-5 font-semibold ink">Why</h3>
                    <ul className="mt-2 space-y-1.5">{res.reasons.map((r) => <li key={r} className="text-sm ink-2">· {r}</li>)}</ul></>)}
                </div>
                <div>
                  <h3 className="font-semibold ink">Exposure to this customer</h3>
                  {res.suggested_limit ? (
                    <>
                      <div className="mt-3 h-3 overflow-hidden rounded-full surface-2">
                        <div className={cx("h-full rounded-full", res.exposure_after > res.suggested_limit ? "bg-rose-500" : "bg-brand-500")}
                          style={{ width: `${Math.min(100, (res.exposure_after / res.suggested_limit) * 100)}%` }} />
                      </div>
                      <div className="mt-2 flex justify-between text-xs ink-2"><span>After this order: <strong className="ink">{inrShort(res.exposure_after)}</strong></span><span>Safe limit {inrShort(res.suggested_limit)}</span></div>
                      <p className="mt-2 text-xs ink-3">Safe limit ≈ their average monthly billing ({inrShort(res.monthly_billing)}) × a multiple for grade {res.grade}.</p>
                    </>
                  ) : <p className="mt-2 text-sm ink-2">No billing history yet to set a limit.</p>}
                  {res.overdue_amount > 0 && <Badge tone="red" className="mt-3">{inrShort(res.overdue_amount)} already overdue · oldest {res.oldest_overdue_days} days</Badge>}
                </div>
              </div>
              {res.message && (
                <div className="border-t line p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold ink">Message to the customer</h3>
                    <Segmented size="sm" value={res.message_lang} onChange={(l: Lang) => check({ lang: l })} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap rounded-xl surface-2 p-4 font-sans text-sm ink">{res.message}</pre>
                  <div className="mt-3 flex gap-2">
                    <a href={`https://wa.me/${(picked?.phone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(res.message)}`} target="_blank" rel="noreferrer"
                      className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl bg-[#1faa53] px-4 text-sm font-medium text-white hover:bg-[#178f45]">Send on WhatsApp</a>
                    <Button icon={<Copy className="size-4" />} onClick={() => { navigator.clipboard.writeText(res.message!); toast.success("Copied"); }}>Copy</Button>
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
