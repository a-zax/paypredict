import { motion } from "motion/react";
import { BadgeCheck, CalendarCheck2, Check, ChevronRight, CircleDollarSign, Clock3, Landmark, Mail, MoreHorizontal, Scale, FileWarning, MessageCircleWarning, BellRing, Percent } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Invoice } from "../lib/api";
import { cx, d, inr, inrShort } from "../lib/format";
import { useT } from "../lib/i18n";
import { useInvoiceActions } from "../lib/useInvoiceActions";
import { PromiseModal, PaidModal } from "./StatusModals";
import { Avatar, Badge, Button, RiskPill, Term } from "./ui";

export const ACTION_ICON: Record<string, ReactNode> = {
  REMINDER: <BellRing className="size-4" />, EARLY_PAY_OFFER: <Percent className="size-4" />, LEGAL_NUDGE: <Scale className="size-4" />,
  SAMADHAAN: <Landmark className="size-4" />, TREDS: <CircleDollarSign className="size-4" />, RESOLVE_DISPUTE: <MessageCircleWarning className="size-4" />,
  FIX_DOCS: <FileWarning className="size-4" />, MONITOR: <Check className="size-4" />, CONFIRM_PAYMENT: <BadgeCheck className="size-4" />,
};
const TONE_BG: Record<string, string> = {
  red: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  blue: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  violet: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
};

/** Adds jargon tooltips to rationale text. */
export function withTerms(text: string | null) {
  if (!text) return null;
  const parts = text.split(/(TReDS|MSMED Act|MSMED|43B\(h\)|MSME Samadhaan)/g);
  return parts.map((p, i) => {
    if (p === "TReDS") return <Term key={i} k="TReDS" />;
    if (p === "MSMED Act" || p === "MSMED") return <Term key={i} k="MSMED">{p}</Term>;
    if (p === "43B(h)") return <Term key={i} k="43B(h)" />;
    if (p === "MSME Samadhaan") return <Term key={i} k="Samadhaan">MSME Samadhaan</Term>;
    return <span key={i}>{p}</span>;
  });
}

export function statusLine(inv: Invoice) {
  if (inv.claim_at && !inv.paid_date) return <Badge tone="green" icon={<BadgeCheck className="size-3" />}>Says paid{inv.claim_ref ? ` · ${inv.claim_ref}` : ""}</Badge>;
  if (inv.promise_date) return <Badge tone="brand" icon={<CalendarCheck2 className="size-3" />}>Promised {d(inv.promise_date)}</Badge>;
  if (inv.days_overdue > 0) return <Badge tone={inv.days_overdue > 30 ? "red" : "amber"} icon={<Clock3 className="size-3" />}>{inv.days_overdue} days overdue</Badge>;
  return <Badge tone="gray" icon={<Clock3 className="size-3" />}>Due {inv.days_to_due === 0 ? "today" : `in ${inv.days_to_due} days`}</Badge>;
}

export function ActionCard({ inv, onOpen, index = 0 }: { inv: Invoice; onOpen: () => void; index?: number }) {
  const { t } = useT();
  const act = useInvoiceActions();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<"promise" | "paid" | null>(null);
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } finally { setBusy(false); } };

  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 60, transition: { duration: 0.25 } }}
      transition={{ delay: index * 0.04 }} className="card group p-4 sm:p-5">
      <div className="flex items-start gap-3.5">
        <Avatar name={inv.buyer_name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <button onClick={onOpen} className="focus-ring min-w-0 text-left">
              <div className="truncate font-semibold ink group-hover:text-brand-600">{inv.buyer_name}</div>
              <div className="text-xs ink-3">{inv.number} · raised {d(inv.invoice_date)}</div>
            </button>
            <div className="text-right">
              <div className="text-lg font-semibold num ink">{inr(inv.amount)}</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {statusLine(inv)}
            <RiskPill band={inv.risk_band} risk={inv.risk} overdue={inv.days_overdue} />
            {inv.expected_pay_date && <span className="text-xs ink-3">Expected ~{d(inv.expected_pay_date)}</span>}
            {!!inv.other_open_count && <span className="text-xs ink-3">· +{inv.other_open_count} more unpaid ({inrShort(inv.other_open_amount ?? 0)})</span>}
          </div>
        </div>
      </div>

      <div data-tour={index === 0 ? "action-box" : undefined} className={cx("mt-4 rounded-xl p-3.5", TONE_BG[inv.action_tone] ?? TONE_BG.blue)}>
        <div className="flex items-center gap-2 text-sm font-semibold">{ACTION_ICON[inv.action ?? ""]}{inv.action_title}</div>
        <p className="mt-1 text-[13px] leading-relaxed opacity-90">{withTerms(inv.rationale)}</p>
        {inv.reasons.length > 0 && (
          <p className="mt-2 text-xs opacity-75"><span className="font-medium">{t("why")}</span> {inv.reasons.slice(0, 2).join(" · ")}</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {inv.action === "CONFIRM_PAYMENT" ? (
          <>
            <Button variant="primary" loading={busy} icon={<Check className="size-4" />} onClick={() => setModal("paid")}>Payment received</Button>
            <Button variant="secondary" loading={busy} onClick={() => run(() => act.rejectClaim(inv.id))}>Not in my bank</Button>
          </>
        ) : inv.internal_action ? (
          <Button variant="primary" size="md" loading={busy} icon={<Check className="size-4" />} onClick={() => run(() => act.done(inv, "treds"))}>
            {inv.action === "TREDS" ? "Uploaded to TReDS" : "Done"}
          </Button>
        ) : (
          <>
            <Button data-tour={index === 0 ? "send" : undefined} variant="whatsapp" loading={busy} onClick={() => run(() => act.sendWhatsApp(inv))}
              icon={<svg viewBox="0 0 24 24" className="size-4 fill-current"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-.9 1.2-.3.2-.6.1a8.2 8.2 0 0 1-4-3.5c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.8.4 3.5 3.5 0 0 0-1.1 2.6 6 6 0 0 0 1.3 3.2 13.8 13.8 0 0 0 5.3 4.7c2 .8 2.7.9 3.7.7a3.1 3.1 0 0 0 2-1.4 2.5 2.5 0 0 0 .2-1.4c-.1-.1-.3-.2-.6-.3M12 21.8a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 1 1 12 21.8m8.4-18.2A11.8 11.8 0 0 0 1.8 17.8L.1 24l6.4-1.7a11.8 11.8 0 0 0 5.6 1.4A11.8 11.8 0 0 0 20.4 3.6"/></svg>}>
              {t("send_whatsapp")}
            </Button>
            <Button variant="secondary" icon={<Mail className="size-4" />} onClick={() => run(() => act.sendEmail(inv))} className="hidden sm:inline-flex">Email</Button>
          </>
        )}
        <Button data-tour={index === 0 ? "details-btn" : undefined} variant="ghost" onClick={onOpen} className="ml-auto">Details <ChevronRight className="size-4" /></Button>
        <div className="relative">
          <Button data-tour={index === 0 ? "more" : undefined} variant="ghost" size="md" aria-label="More options" aria-expanded={menu} onClick={() => setMenu((m) => !m)} icon={<MoreHorizontal className="size-4" />} />
          {menu && (
            <div className="card absolute bottom-12 right-0 z-20 w-56 p-1.5 shadow-[var(--shadow-pop)]" onMouseLeave={() => setMenu(false)}>
              {[
                ["They promised a date", () => setModal("promise")],
                ["Payment received", () => setModal("paid")],
                ["I called them", () => run(() => act.done(inv, "call"))],
                ["Snooze for 3 days", () => run(() => act.snooze(inv.id))],
              ].map(([label, f]) => (
                <button key={label as string} onClick={() => { setMenu(false); (f as () => void)(); }}
                  className="focus-ring block w-full rounded-lg px-3 py-2 text-left text-sm ink hover:bg-[var(--surface-2)]">{label as string}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <PromiseModal open={modal === "promise"} onClose={() => setModal(null)} onSave={(w) => act.promise(inv.id, w)} />
      <PaidModal open={modal === "paid"} onClose={() => setModal(null)} amount={inv.amount} onSave={(w) => act.paid(inv.id, w)} />
    </motion.div>
  );
}
