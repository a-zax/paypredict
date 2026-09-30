import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDrawers } from "../components/Drawers";
import { Card, Segmented, Skeleton } from "../components/ui";
import { axisTick, legendProps, tooltipProps } from "../lib/chart";
import { api, type Forecast } from "../lib/api";
import { d, inrShort } from "../lib/format";
import { usePageTitle } from "../lib/theme";

/** One screen, no scrolling: KPI strip, one chart with two views, and a side panel explaining the gap. */
export function Cash() {
  usePageTitle("Cash flow");
  const { openCustomer } = useDrawers();
  const [weeks, setWeeks] = useState<"6" | "12">("12");
  const [view, setView] = useState<"cum" | "week">("cum");
  const { data } = useQuery<Forecast>({ queryKey: ["forecast", Number(weeks)], queryFn: () => api(`/forecast?weeks=${weeks}`) });
  if (!data) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-20" /><Skeleton className="h-96" /></div>;

  const L = (x: number) => x / 1e5;
  const rows = data.weeks.map((w) => ({
    ...w, label: d(w.week), band: [L(w.cum_low), L(w.cum_high)], gap: [L(w.cum_expected), L(w.cum_assumed)],
    ce: L(w.cum_expected), ca: L(w.cum_assumed), e: L(w.expected), a: L(w.assumed),
  }));
  const last = data.weeks[data.weeks.length - 1];
  const hw = Math.min(data.gap_weeks, rows.length) - 1;           // the 4-week horizon
  const w4 = data.weeks[hw];
  const shortfall = Math.max(w4.cum_assumed - w4.cum_expected, 0);
  const maxGap = Math.max(...data.gap_by_customer.map((g) => g.gap), 1);
  const topShare = data.gap_total ? data.gap_by_customer.reduce((a, g) => a + g.gap, 0) / data.gap_total : 0;
  // This week's "due" includes everything already overdue, so the tightest week is looked for from next week on.
  const ahead = rows.slice(1).map((r) => ({ ...r, short: r.assumed - r.expected })).sort((a, b) => b.short - a.short)[0];

  const kpis: [string, string, string?, string?][] = [
    [`Due in the next ${data.gap_weeks} weeks`, inrShort(w4.cum_assumed), "if everyone pays on time", "ink-2 line-through decoration-rose-400/60"],
    ["PayPredict expects", inrShort(w4.cum_expected), `likely ${inrShort(w4.cum_low)} - ${inrShort(w4.cum_high)}`, "text-brand-600 dark:text-brand-200"],
    ["Shortfall", inrShort(shortfall), "arriving later than promised", "text-rose-600 dark:text-rose-400"],
    [`Still unpaid by ${d(last.week)}`, inrShort(data.outstanding - last.cum_expected), `of ${inrShort(data.outstanding)} outstanding`, "text-amber-600"],
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight ink sm:text-3xl">Cash flow forecast</h1>
          <p className="mt-1 ink-2">When your {inrShort(data.outstanding)} of unpaid invoices will actually turn into cash.</p>
        </div>
        <Segmented value={weeks} onChange={setWeeks} options={[{ value: "6", label: "6 weeks" }, { value: "12", label: "12 weeks" }]} />
      </div>

      <Card className="mt-5 grid grid-cols-2 gap-px overflow-hidden bg-[var(--line)] lg:grid-cols-4">
        {kpis.map(([l, v, h, cls]) => (
          <div key={l} className="bg-[var(--surface)] px-4 py-3 sm:px-5">
            <div className="text-xs ink-3">{l}</div>
            <div className={`mt-0.5 text-xl font-semibold num sm:text-2xl ${cls}`}>{v}</div>
            {h && <div className="truncate text-[11px] ink-3">{h}</div>}
          </div>
        ))}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="flex flex-col p-5" data-tour="cash-chart">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold ink">{view === "cum" ? "Cumulative cash in (₹ lakh)" : "Cash in, week by week (₹ lakh)"}</h3>
              <p className="text-xs ink-3">{view === "cum"
                ? "Red area = money arriving later than its due date. Band = likely range from 1,000 simulated futures."
                : "This week's grey bar includes everything already overdue - owed now, expected to trickle in."}</p>
            </div>
            <Segmented size="sm" value={view} onChange={setView} options={[{ value: "cum", label: "Cumulative" }, { value: "week", label: "Week by week" }]} />
          </div>
          <div className="mt-3 min-h-[300px] flex-1">
            <ResponsiveContainer>
              {view === "cum" ? (
                <ComposedChart data={rows} margin={{ left: -10, right: 12, top: 12 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} />
                  <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v) => `${Math.round(v)}`} domain={[0, (max: number) => Math.ceil((max * 1.05) / 50) * 50]} />
                  <Tooltip {...tooltipProps} formatter={(v: any, n: string) => [Array.isArray(v) ? `${inrShort(v[0] * 1e5)} - ${inrShort(v[1] * 1e5)}` : inrShort(v * 1e5), n]} />
                  <Legend {...legendProps} />
                  <Area dataKey="gap" name="Arriving late" stroke="none" fill="#f43f5e" fillOpacity={0.14} legendType="square" />
                  <Area dataKey="band" name="Likely range" stroke="#818cf8" strokeOpacity={0.5} strokeWidth={1} fill="#6366f1" fillOpacity={0.3} legendType="square" />
                  <Line dataKey="ca" name="If everyone paid on the due date" stroke="#94a3b8" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                  <Line dataKey="ce" name="PayPredict expected" stroke="#6366f1" strokeWidth={2.5} dot={false} />
                  <ReferenceLine x={rows[hw].label} stroke="var(--ink-3)" strokeDasharray="2 4" />
                  {shortfall > 0 && (
                    <ReferenceDot x={rows[hw].label} y={(rows[hw].ca + rows[hw].ce) / 2} r={0}
                      label={{ value: `${inrShort(shortfall)} late`, position: "right", fill: "#fb7185", fontSize: 12, fontWeight: 600 }} />
                  )}
                </ComposedChart>
              ) : (
                <ComposedChart data={rows} margin={{ left: -10, right: 8, top: 12 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} />
                  <YAxis tickLine={false} axisLine={false} tick={axisTick} />
                  <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [inrShort(v * 1e5), n]} />
                  <Legend {...legendProps} />
                  <Bar dataKey="a" name="Due that week" fill="#cbd5e1" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="e" name="Expected to arrive" fill="#6366f1" radius={[6, 6, 0, 0]} />
                </ComposedChart>
              )}
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h3 className="font-semibold ink">Who's holding your cash</h3>
            <p className="text-xs ink-3">Customers whose late payments make up the next {data.gap_weeks} weeks' shortfall.</p>
            {data.gap_by_customer.length === 0 ? <p className="mt-4 text-sm ink-2">Nobody - everything due is expected on time.</p> : (
              <ul className="mt-3 space-y-1">
                {data.gap_by_customer.map((g) => (
                  <li key={g.buyer_id}>
                    <button onClick={() => openCustomer(g.buyer_id)} className="focus-ring group w-full rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-2)]">
                      <div className="flex items-start justify-between gap-2 text-sm">
                        <span className="min-w-0 leading-snug ink">{g.name}</span>
                        <span className="flex shrink-0 items-center gap-0.5 font-semibold num text-rose-600 dark:text-rose-400">{inrShort(g.gap)}<ChevronRight className="size-3.5 ink-3 opacity-0 transition group-hover:opacity-100" /></span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full surface-2"><div className="h-full rounded-full bg-rose-500/70" style={{ width: `${(g.gap / maxGap) * 100}%` }} /></div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {topShare > 0 && <p className="mt-3 text-xs ink-3">These {data.gap_by_customer.length} account for {Math.round(topShare * 100)}% of the money arriving late.</p>}
          </Card>

          {ahead && ahead.short > 0 && (
            <Card className="p-5">
              <div className="flex items-center gap-2 text-sm font-semibold ink"><CalendarClock className="size-4 text-amber-500" />Tightest week ahead</div>
              <p className="mt-1 text-xs ink-3">Week of {ahead.label}: plan supplier payments and salaries around it.</p>
              <div className="mt-3 space-y-2 text-xs">
                {[["Due", ahead.assumed, "bg-slate-300 dark:bg-slate-500"], ["Expected", ahead.expected, "bg-brand-500"]].map(([l, v, c]) => (
                  <div key={l as string} className="flex items-center gap-2">
                    <span className="w-14 ink-3">{l}</span>
                    <div className="h-2 flex-1 rounded-full surface-2"><div className={`h-full rounded-full ${c}`} style={{ width: `${((v as number) / Math.max(ahead.assumed, ahead.expected, 1)) * 100}%` }} /></div>
                    <span className="w-14 text-right font-semibold num ink">{inrShort(v as number)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{inrShort(ahead.short)} short that week</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
