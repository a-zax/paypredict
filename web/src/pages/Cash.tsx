import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Segmented, Skeleton } from "../components/ui";
import { api, type ForecastWeek } from "../lib/api";
import { d, inrShort } from "../lib/format";
import { usePageTitle } from "../lib/theme";

const tip = { borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };

export function Cash() {
  usePageTitle("Cash flow");
  const [weeks, setWeeks] = useState<"6" | "12">("12");
  const { data } = useQuery<{ weeks: ForecastWeek[]; outstanding: number }>({ queryKey: ["forecast", Number(weeks)], queryFn: () => api(`/forecast?weeks=${weeks}`) });
  if (!data) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-96" /></div>;
  const rows = data.weeks.map((w) => ({ ...w, label: d(w.week), band: [w.cum_low / 1e5, w.cum_high / 1e5], ce: w.cum_expected / 1e5, ca: w.cum_assumed / 1e5, e: w.expected / 1e5, a: w.assumed / 1e5 }));
  const last = data.weeks[data.weeks.length - 1];
  const w4 = data.weeks[Math.min(3, data.weeks.length - 1)];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight ink sm:text-3xl">Cash flow forecast</h1>
          <p className="mt-1 ink-2">When your {inrShort(data.outstanding)} of unpaid invoices will actually turn into cash.</p>
        </div>
        <Segmented value={weeks} onChange={setWeeks} options={[{ value: "6", label: "6 weeks" }, { value: "12", label: "12 weeks" }]} />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-5"><div className="text-sm ink-2">In 4 weeks, due dates say</div><div className="mt-1 text-2xl font-semibold num ink-2 line-through decoration-rose-400/60">{inrShort(w4.cum_assumed)}</div></Card>
        <Card className="p-5"><div className="text-sm ink-2">PayPredict expects</div><div className="mt-1 text-2xl font-semibold num text-brand-600 dark:text-brand-200">{inrShort(w4.cum_expected)}</div>
          <div className="text-xs ink-3">likely {inrShort(w4.cum_low)} - {inrShort(w4.cum_high)}</div></Card>
        <Card className="p-5"><div className="text-sm ink-2">By {d(last.week)}, still waiting on</div><div className="mt-1 text-2xl font-semibold num text-amber-600">{inrShort(data.outstanding - last.cum_expected)}</div></Card>
      </div>

      <Card className="mt-4 p-5 sm:p-6" data-tour="cash-chart">
        <h3 className="font-semibold ink">Cumulative cash in (₹ lakh)</h3>
        <p className="text-xs ink-3">Shaded band = likely range from 1,000 simulated futures of your invoices.</p>
        <div className="mt-4 h-80">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ left: -10, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v)}`} />
              <Tooltip contentStyle={tip} formatter={(v: any, n: string) => [Array.isArray(v) ? `${inrShort(v[0] * 1e5)} - ${inrShort(v[1] * 1e5)}` : inrShort(v * 1e5), n]} />
              <Legend />
              <Area dataKey="band" name="Likely range" stroke="none" fill="#6366f1" fillOpacity={0.15} />
              <Line dataKey="ca" name="If everyone paid on the due date" stroke="#94a3b8" strokeDasharray="5 5" strokeWidth={2} dot={false} />
              <Line dataKey="ce" name="PayPredict expected" stroke="#6366f1" strokeWidth={3} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="mt-4 p-5 sm:p-6">
        <h3 className="font-semibold ink">Week by week (₹ lakh)</h3>
        <div className="mt-4 h-64">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ left: -10, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tip} formatter={(v: number, n: string) => [inrShort(v * 1e5), n]} />
              <Legend />
              <Bar dataKey="a" name="Due that week" fill="#cbd5e1" radius={[6, 6, 0, 0]} />
              <Bar dataKey="e" name="Expected to arrive" fill="#6366f1" radius={[6, 6, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-3 text-sm ink-2">This week's grey bar includes everything already overdue - that money is <em>owed</em> now, but PayPredict expects it to trickle in over the coming weeks.</p>
      </Card>
    </div>
  );
}
