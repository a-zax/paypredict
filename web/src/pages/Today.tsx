import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, Clock, PartyPopper, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ActionCard } from "../components/ActionCard";
import { useDrawers } from "../components/Drawers";
import { Card, Empty, Skeleton, Stat, Term } from "../components/ui";
import { api, type ForecastWeek, type Impact, type Invoice, type Summary } from "../lib/api";
import { useMe } from "../lib/auth";
import { d, greeting, inrShort } from "../lib/format";
import { useT } from "../lib/i18n";
import { usePageTitle } from "../lib/theme";
import { SetupChecklist } from "../components/SetupChecklist";
import { AIAlertsCard, AIBriefingCard } from "../components/AIBriefing";

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 22, c = 2 * Math.PI * r, p = total ? done / total : 0;
  return (
    <div className="relative size-14">
      <svg viewBox="0 0 56 56" className="size-14 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
        <motion.circle cx="28" cy="28" r={r} fill="none" stroke="#6366f1" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} animate={{ strokeDashoffset: c * (1 - p) }} transition={{ type: "spring", damping: 20 }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-sm font-semibold num ink">{done}/{total}</div>
    </div>
  );
}

export function Today() {
  const { t } = useT();
  const { data: me } = useMe();
  const { openInvoice } = useDrawers();
  usePageTitle("Today");
  const { data, isLoading } = useQuery<{ summary: Summary; actions: Invoice[]; impact: Impact; date: string }>({ queryKey: ["today"], queryFn: () => api("/today") });
  const { data: fc } = useQuery<{ weeks: ForecastWeek[] }>({ queryKey: ["forecast", 6], queryFn: () => api("/forecast?weeks=6") });

  // Track how many of today's initial actions have been completed in this session.
  const initial = useRef<number | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  useEffect(() => {
    if (!data) return;
    if (initial.current === null) initial.current = data.actions.length;
    setDoneCount(Math.max(0, initial.current - data.actions.length));
  }, [data]);

  if (isLoading || !data) {
    return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-40" /><div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div><Skeleton className="h-48" /></div>;
  }
  const s = data.summary;
  const total = initial.current ?? data.actions.length;

  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <p className="text-sm ink-3">{d(data.date, { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight ink sm:text-3xl">{greeting()}{me && !me.org.is_demo ? `, ${me.user.name.split(" ")[0]}` : ""} 👋</h1>
      </motion.div>

      {/* Headline insight */}
      <AIBriefingCard weeks={fc?.weeks} />

      <div data-tour="kpis" className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label={t("owed")} value={inrShort(s.outstanding)} hint={`${s.open_count} unpaid invoices`} icon={<Wallet className="size-4" />} />
        <Stat label={t("overdue")} value={inrShort(s.overdue)} hint={`${s.overdue_count} invoices past due`} tone="red" icon={<Clock className="size-4" />} />
        <Stat label={t("likely_late")} value={inrShort(s.at_risk)} hint={`${s.high_risk_count} high-risk invoices`} tone="amber" icon={<TrendingDown className="size-4" />} />
        {/* Counted from the invoice date (MSMED s.15), not the due date - so it can exceed "Overdue". The label says so. */}
        <Stat label={<Term k="MSMED">Past 45-day legal limit</Term>} value={inrShort(s.past_45_amount)} tone="red"
          hint={`${s.past_45_count} invoices · 45+ days since invoice`} icon={<AlertTriangle className="size-4" />} />
      </div>

      <AIAlertsCard />

      <SetupChecklist />

      {/* Only once there's something to show - a row of ₹0s reads as "this did nothing". */}
      {(data.impact.collected_after_action > 0 || data.impact.days_saved >= 1 || data.impact.interest_saved >= 1) && (
        <Link to="/impact" className="focus-ring mt-4 block">
          <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4 transition hover:border-emerald-300 sm:px-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><TrendingUp className="size-4" />Your PayPredict impact</div>
            {([
              [data.impact.collected_after_action > 0, inrShort(data.impact.collected_after_action), `collected after ${data.impact.actions_taken} actions`],
              [data.impact.days_saved >= 1, `${Math.round(data.impact.days_saved)} days`, "sooner than the AI's forecast"],
              [data.impact.interest_saved >= 1, inrShort(data.impact.interest_saved), "interest saved"],
            ] as const).filter(([show]) => show).map(([, v, l]) => <div key={l}><span className="font-semibold num ink">{v}</span> <span className="text-sm ink-2">{l}</span></div>)}
            <ArrowRight className="ml-auto size-4 ink-3" />
          </Card>
        </Link>
      )}

      {/* Actions */}
      <div data-tour="actions" className="mt-10 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold ink">{t("your_actions")}</h2>
          <p className="text-sm ink-2">Most urgent first - weighing the amount, how late it is and how likely it is to slip. One tap each.</p>
        </div>
        {total > 0 && <div className="flex items-center gap-3"><div className="hidden text-right text-xs ink-3 sm:block">{doneCount} {t("done_today")}</div><ProgressRing done={doneCount} total={total} /></div>}
      </div>
      <div className="mt-4 space-y-3">
        <AnimatePresence mode="popLayout">
          {data.actions.map((inv, i) => <ActionCard key={inv.id} inv={inv} index={i} onOpen={() => openInvoice(inv.id)} />)}
        </AnimatePresence>
        {data.actions.length === 0 && (
          <Card><Empty icon={<PartyPopper className="size-6" />} title={t("all_clear")}
            body="Nothing urgent right now. PayPredict re-checks every invoice daily and will bring anything risky back here."
            action={<Link to="/invoices" className="text-sm font-medium text-brand-600">Browse all invoices →</Link>} /></Card>
        )}
      </div>
    </div>
  );
}
