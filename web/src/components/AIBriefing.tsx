import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Bot, MessageCircleQuestion, Radar, TrendingUp } from "lucide-react";
import { Link, useOutletContext } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { api, type ForecastWeek } from "../lib/api";
import { cx } from "../lib/format";
import { Md, ReasoningTrace, type AgentReply } from "./ai";
import { useDrawers } from "./Drawers";
import { Card, Skeleton } from "./ui";

type Alert = { kind: "slowing" | "unusual" | "concentration"; customer_id: number; name: string; text: string };

/** Hero card on Today: the agent's own write-up of the day, with its reasoning one click away. */
export function AIBriefingCard({ weeks }: { weeks?: ForecastWeek[] }) {
  const { data, isLoading } = useQuery<AgentReply>({ queryKey: ["briefing"], queryFn: () => api("/briefing"), staleTime: 60_000 });
  const ctx = useOutletContext<{ openAssistant?: () => void } | undefined>();
  const { openInvoice } = useDrawers();
  return (
    <div data-tour="headline" className="mt-5">
      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-brand-700 via-brand-600 to-violet-700 p-6 text-white sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-10 size-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center gap-2 text-xs font-medium text-white/85">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1"><Bot className="size-3.5" />AI briefing</span>
          <span className="text-white/65">written by the PayPredict Agent from your ledger{data?.ms != null ? ` · ${data.ms < 1000 ? `${data.ms} ms` : `${(data.ms / 1000).toFixed(1)} s`}` : ""}</span>
        </div>
        <div className="relative mt-4 grid gap-6 md:grid-cols-[1fr_240px]">
          <div className="min-w-0 text-[15px] leading-relaxed [&_strong]:font-semibold">
            {isLoading || !data ? (
              <div className="space-y-2"><Skeleton className="h-5 w-4/5 !bg-white/15" /><Skeleton className="h-4 w-3/5 !bg-white/15" /><Skeleton className="h-4 w-2/3 !bg-white/15" /></div>
            ) : <Md text={data.reply} />}
          </div>
          {weeks && (
            <div className="flex flex-col justify-end">
              <div className="h-24"><ResponsiveContainer>
                <AreaChart data={weeks}>
                  <Area dataKey="cum_assumed" stroke="rgba(255,255,255,0.5)" strokeDasharray="4 4" fill="none" strokeWidth={2} isAnimationActive={false} />
                  <Area dataKey="cum_expected" stroke="#fff" fill="rgba(255,255,255,0.18)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer></div>
              <div className="mt-1 flex gap-4 text-[11px] text-white/75"><span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-white" />Expected</span><span className="flex items-center gap-1.5"><i className="h-0 w-4 border-t-2 border-dashed border-white/60" />Due dates</span></div>
              <Link to="/cash" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-white hover:underline">Cash forecast <ArrowRight className="size-4" /></Link>
            </div>
          )}
        </div>
        {!!data?.links?.length && (
          <div className="relative mt-4 flex flex-wrap gap-1.5">
            {data.links.map((l) => (
              <button key={l.id} onClick={() => openInvoice(l.id)} className="focus-ring rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/25">{l.label}</button>
            ))}
            {ctx?.openAssistant && (
              <button onClick={ctx.openAssistant} className="focus-ring ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1 text-xs font-semibold text-brand-700 hover:bg-white/90">
                <MessageCircleQuestion className="size-3.5" />Ask a follow-up
              </button>
            )}
          </div>
        )}
      </Card>
      {data?.steps && <div className="mt-2"><ReasoningTrace steps={data.steps} ms={data.ms} engine={data.engine} animate /></div>}
    </div>
  );
}

const ICON = { slowing: <TrendingUp className="size-4" />, unusual: <AlertTriangle className="size-4" />, concentration: <Radar className="size-4" /> };
const LABEL = { slowing: "Paying slower", unusual: "Unusual for them", concentration: "Concentration risk" };

/** Behaviour-change detection: customers whose recent payments break from their own habit. */
export function AIAlertsCard() {
  const { data } = useQuery<Alert[]>({ queryKey: ["alerts"], queryFn: () => api("/alerts"), staleTime: 60_000 });
  const { openCustomer } = useDrawers();
  if (!data?.length) return null;
  return (
    <Card className="mt-4 p-4 sm:p-5" data-tour="alerts">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Radar className="size-4" /></span>
        <div className="flex-1"><div className="font-semibold ink">AI early warnings</div>
          <div className="text-xs ink-3">The AI compares each customer's latest payments with their own long-run habit</div></div>
      </div>
      <ul className="mt-3 divide-y line">
        {data.slice(0, 4).map((a) => (
          <li key={a.kind + a.customer_id}>
            <button onClick={() => openCustomer(a.customer_id)} className="focus-ring flex w-full items-start gap-3 rounded-lg px-1 py-2.5 text-left hover:bg-[var(--surface-2)]">
              <span className={cx("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full",
                a.kind === "slowing" ? "bg-rose-50 text-rose-600 dark:bg-rose-500/10" : a.kind === "unusual" ? "bg-amber-50 text-amber-600 dark:bg-amber-500/10" : "bg-sky-50 text-sky-600 dark:bg-sky-500/10")}>{ICON[a.kind]}</span>
              <span className="min-w-0 flex-1"><span className="block text-[11px] font-semibold uppercase tracking-wide ink-3">{LABEL[a.kind]}</span>
                <span className="block text-sm ink">{a.text}</span></span>
              <ArrowRight className="mt-1 size-4 shrink-0 ink-3" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
