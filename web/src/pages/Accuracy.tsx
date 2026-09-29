import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Database, PiggyBank, RefreshCw, Smartphone, Target, Timer, TrendingUp, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Badge, Button, Card, Empty, Skeleton, Term } from "../components/ui";
import { api, type Impact } from "../lib/api";
import { d, inrShort, pct } from "../lib/format";
import { usePageTitle } from "../lib/theme";

type ModelInfo = {
  kind: "own" | "starter" | null; trained_at: string | null;
  metrics: Record<string, any>;
  insights: { actions: { kind: string; title: string; sent: number; success_rate: number | null; avg_days_to_pay: number | null }[]; actions_taken: number; recovered_after_action: number };
};

const tip = { borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };

function ImpactSection() {
  const { data: im } = useQuery<Impact>({ queryKey: ["impact"], queryFn: () => api("/impact") });
  if (!im) return <Skeleton className="mt-6 h-40" />;
  const trend = (im.trend ?? []).map((t) => ({ ...t, dso: t.dso == null ? null : Math.round(t.dso), late: t.late_share == null ? null : Math.round(t.late_share * 100) }));
  const first = trend.find((t) => t.dso != null), last = [...trend].reverse().find((t) => t.dso != null);
  return (
    <>
      <div data-tour="impact-cards" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [<Wallet key="w" className="size-5 text-emerald-500" />, inrShort(im.collected_after_action), `collected within 30 days of an action (${im.collected_count} invoices)`],
          [<Timer key="t" className="size-5 text-brand-500" />, `${Math.round(im.days_saved)} days`, im.avg_days_saved != null ? `sooner than forecast · ${im.avg_days_saved.toFixed(1)} per invoice` : "sooner than the AI forecast"],
          [<PiggyBank key="p" className="size-5 text-violet-500" />, inrShort(im.interest_saved), "overdraft interest saved"],
          [<Smartphone key="s" className="size-5 text-sky-500" />, inrShort(im.upi_collected), `paid via UPI links (${im.upi_claims} claims)`],
        ].map(([icon, v, l], i) => (
          <Card key={i} className="p-5">{icon}<div className="mt-3 text-2xl font-semibold num ink">{v}</div><div className="mt-1 text-xs ink-2">{l}</div></Card>
        ))}
      </div>
      {im.actions_taken === 0 && <p className="mt-3 text-sm ink-2">These fill up as you act on the Today list. Days saved are measured against what the AI predicted at the moment you acted - not claimed for every payment.</p>}
      <Card className="mt-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-semibold ink">Collection time over the last 12 months</h3>
            <p className="text-xs ink-3">Days of sales still unpaid (<Term k="DSO" />) and share of invoices paid 15+ days late - from your ledger.</p>
          </div>
          {first && last && first.dso != null && last.dso != null && (
            <Badge tone={last.dso <= first.dso ? "green" : "red"}>{last.dso <= first.dso ? "↓" : "↑"} {Math.abs(last.dso - first.dso)} {Math.abs(last.dso - first.dso) === 1 ? "day" : "days"} vs {first.month}</Badge>
          )}
        </div>
        <div className="mt-4 h-60">
          <ResponsiveContainer>
            <ComposedChart data={trend} margin={{ left: -16, right: 0, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis yAxisId="d" tickLine={false} axisLine={false} unit="d" />
              <YAxis yAxisId="p" orientation="right" tickLine={false} axisLine={false} unit="%" />
              <Tooltip contentStyle={tip} />
              <Legend />
              <Bar yAxisId="p" dataKey="late" name="% paid 15+ days late" fill="#fda4af" radius={[6, 6, 0, 0]} />
              <Line yAxisId="d" dataKey="dso" name="Collection time (days)" stroke="#6366f1" strokeWidth={3} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}

export function Accuracy() {
  usePageTitle("Impact & accuracy");
  const qc = useQueryClient();
  const { data } = useQuery<ModelInfo>({ queryKey: ["model"], queryFn: () => api("/model") });
  const retrain = useMutation({
    mutationFn: () => api("/model/retrain", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries(); toast.success("AI retrained on your latest data"); },
  });
  if (!data) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
  const m = data.metrics;
  const bars = m.available ? [
    { name: "Assume due date", v: m.mae_days_due_date, c: "#cbd5e1" },
    { name: "Customer's average", v: m.mae_days_baseline, c: "#a5b4fc" },
    { name: "PayPredict AI", v: m.mae_days, c: "#6366f1" },
  ] : [];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight ink sm:text-3xl">Impact & accuracy</h1>
          <p className="mt-1 ink-2">What PayPredict has done for your cash flow - and how far you can trust its predictions.</p>
        </div>
        <Button icon={<RefreshCw className="size-4" />} loading={retrain.isPending} onClick={() => retrain.mutate()}>Retrain now</Button>
      </div>

      <ImpactSection />

      <h2 className="mt-10 text-xl font-semibold ink">How accurate is the AI?</h2>
      <Card className="mt-4 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-200"><Brain className="size-6" /></span>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 font-semibold ink">
            {data.kind === "own" ? "Trained on your own ledger" : "Using the starter model"}
            <Badge tone={data.kind === "own" ? "green" : "amber"}>{data.kind === "own" ? "Personalised" : "Benchmark"}</Badge>
          </div>
          <p className="text-sm ink-2">
            {data.kind === "own" ? `${m.paid_invoices?.toLocaleString("en-IN")} paid invoices from ${m.customers} customers · last trained ${d(data.trained_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : m.note}
          </p>
        </div>
        <div className="text-xs ink-3">Time-to-payment (survival) model · gradient-boosted trees</div>
      </Card>

      {m.available ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Card className="p-5">
              <Target className="size-5 text-brand-500" />
              <div className="mt-3 text-3xl font-semibold num ink">±{Math.round(m.mae_days)} days</div>
              <div className="mt-1 text-sm ink-2">Typical error in predicted payment date - vs ±{Math.round(m.mae_days_due_date)} days if you just assume the due date.</div>
            </Card>
            <Card className="p-5">
              <TrendingUp className="size-5 text-emerald-500" />
              <div className="mt-3 text-3xl font-semibold num ink">{pct(m.late_amount_top20)}</div>
              <div className="mt-1 text-sm ink-2">of late money is in the AI's top-20% riskiest invoices (customer averages alone catch {pct(m.late_amount_top20_baseline)}).</div>
            </Card>
            <Card className="p-5">
              <Database className="size-5 text-violet-500" />
              <div className="mt-3 text-3xl font-semibold num ink">{pct(m.coverage_90)}</div>
              <div className="mt-1 text-sm ink-2">of payments landed inside the "likely range" we show you.</div>
            </Card>
          </div>
          <Card className="mt-4 p-5 sm:p-6">
            <h3 className="font-semibold ink">Average error in payment-date prediction (days, lower is better)</h3>
            <p className="text-xs ink-3">Tested on {m.n_test?.toLocaleString("en-IN")} invoices raised after {d(m.split_date, { month: "short", year: "numeric" })}; trained on {m.n_train?.toLocaleString("en-IN")} earlier ones. Ranking quality (AUC): {m.auc?.toFixed(2)} vs {m.auc_baseline?.toFixed(2)} for customer averages.</p>
            <div className="mt-4 h-56">
              <ResponsiveContainer>
                <BarChart data={bars} layout="vertical" margin={{ left: 40, right: 40 }}>
                  <CartesianGrid horizontal={false} stroke="var(--line)" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={130} />
                  <Bar dataKey="v" radius={[0, 8, 8, 0]} barSize={30}>
                    {bars.map((b) => <Cell key={b.name} fill={b.c} />)}
                    <LabelList dataKey="v" position="right" formatter={(v: number) => `${v.toFixed(1)} d`} className="fill-[var(--ink)] text-sm font-semibold" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      ) : (
        <Card className="mt-4"><Empty icon={<Target className="size-6" />} title="Not enough history to back-test yet" body={m.reason} /></Card>
      )}

      <h2 className="mt-10 text-xl font-semibold ink">What's working</h2>
      <p className="text-sm ink-2">PayPredict tracks every action you take and whether the customer paid within 10 days. If gentle reminders keep getting ignored by a customer, it automatically steps up.</p>
      <Card className="mt-4 overflow-hidden">
        {data.insights.actions.length === 0 ? (
          <Empty icon={<TrendingUp className="size-6" />} title="No actions yet" body="Send a few reminders from the Today page - results will show up here." />
        ) : (
          <div className="divide-y line">
            {data.insights.actions.map((a) => (
              <div key={a.kind} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1"><div className="text-sm font-medium ink">{a.title}</div><div className="text-xs ink-3">{a.sent} sent</div></div>
                <div className="text-right text-sm"><div className="font-semibold num ink">{a.success_rate == null ? "Waiting…" : pct(a.success_rate)}</div><div className="text-xs ink-3">paid within 10 days</div></div>
              </div>
            ))}
            <div className="px-5 py-4 text-sm ink-2">{data.insights.actions_taken} actions taken · {inrShort(data.insights.recovered_after_action)} recorded as collected</div>
          </div>
        )}
      </Card>
    </div>
  );
}
