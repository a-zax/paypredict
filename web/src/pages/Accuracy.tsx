import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Database, PiggyBank, RefreshCw, Smartphone, Target, Timer, TrendingUp, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisTick, legendProps, tooltipProps } from "../lib/chart";
import { toast } from "sonner";
import { Badge, Button, Card, Empty, Skeleton, Term } from "../components/ui";
import { api, type Impact } from "../lib/api";
import { d, inrShort, pct } from "../lib/format";
import { usePageTitle } from "../lib/theme";
import { AnomalyList, ModelHealth, PersonaMap } from "../components/AILab";

type ModelInfo = {
  kind: "own" | "starter" | null; trained_at: string | null;
  metrics: Record<string, any>;
  ai?: { model: string; features_used: number; periods: string[]; sample: number;
    importance: { feature: string; label: string; days: number }[]; curves: { reliable: number[]; risky: number[] } };
  insights: { actions: { kind: string; title: string; sent: number; success_rate: number | null; avg_days_to_pay: number | null }[]; actions_taken: number; recovered_after_action: number };
};


function ImpactSection() {
  const { data: im } = useQuery<Impact>({ queryKey: ["impact"], queryFn: () => api("/impact") });
  if (!im) return <Skeleton className="mt-6 h-40" />;
  const trend = (im.trend ?? []).map((t) => ({ ...t, dso: t.dso == null ? null : Math.round(t.dso), late: t.late_share == null ? null : Math.round(t.late_share * 100) }));
  const first = trend.find((t) => t.dso != null), last = [...trend].reverse().find((t) => t.dso != null);
  // Four ₹0 tiles read as "this did nothing" - until there's a result, say what will appear and when.
  const hasResults = im.collected_after_action > 0 || im.days_saved >= 1 || im.interest_saved >= 1 || im.upi_collected > 0;
  return (
    <>
      {!hasResults ? (
        <Card data-tour="impact-cards" className="mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"><Wallet className="size-6" /></span>
          <div className="flex-1">
            <div className="font-semibold ink">{im.actions_taken ? `${im.actions_taken} actions taken - results usually show within 10 days` : "Your results will appear here"}</div>
            <p className="text-sm ink-2">Money collected after each reminder, days saved against the AI's forecast, overdraft interest saved and UPI payments - measured from the moment you act, not claimed for every payment.</p>
          </div>
        </Card>
      ) : (
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
      )}
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
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={axisTick} />
              <YAxis yAxisId="d" tickLine={false} axisLine={false} unit="d" tick={{ ...axisTick, fill: "#818cf8" }} />
              <YAxis yAxisId="p" orientation="right" tickLine={false} axisLine={false} unit="%" tick={{ ...axisTick, fill: "#fb7185" }} />
              <Tooltip {...tooltipProps} />
              <Legend {...legendProps} />
              <Bar yAxisId="p" dataKey="late" name="% paid 15+ days late" fill="#fb7185" fillOpacity={0.3} radius={[6, 6, 0, 0]} />
              <Line yAxisId="d" dataKey="dso" name="Collection time (days)" stroke="#6366f1" strokeWidth={3} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}

const STAGES = [
  ["Predict", "A survival model learns each customer's habits and gives every unpaid invoice a date, range and risk."],
  ["Explain", "Re-runs the model with each factor at a typical value to show how many days each one adds."],
  ["Decide", "Compares the cost of waiting with each lever and escalates when reminders are ignored."],
  ["Converse", "Munim AI (a ReAct agent) understands questions, plans, calls tools and shows its reasoning."],
  ["Read replies", "NLP reads customer replies: promise, dispute, paid, documents - and how likely a promise is to hold."],
  ["Group", "K-means clusters customers into payment personas, each with its own strategy."],
  ["Watch", "Behaviour-change alerts, Isolation-Forest anomaly scan, Monte-Carlo cash simulation."],
  ["Self-check", "Measures calibration and data drift, so you know when to trust it - and when to retrain."],
];

function HowAIWorks({ ai, paid }: { ai: NonNullable<ModelInfo["ai"]>; paid?: number }) {
  const imp = ai.importance.slice(0, 8);
  const max = Math.max(...imp.map((f) => f.days), 1);
  const curves = ai.periods.map((p, i) => ({ p, reliable: Math.round(ai.curves.reliable[i] * 100), risky: Math.round(ai.curves.risky[i] * 100) }));
  return (
    <section className="mt-6" data-tour="ai-how">
      <div className="flex items-center gap-2"><Brain className="size-5 text-violet-600" /><h2 className="text-xl font-semibold ink">How the AI works</h2></div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map(([t, b], i) => (
          <li key={t} className="card relative p-3.5">
            <span className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-violet-600 text-xs font-bold text-white">{i + 1}</span>
            <div className="mt-2 text-sm font-semibold ink">{t}</div>
            <p className="mt-0.5 text-xs leading-snug ink-2">{b}</p>
          </li>
        ))}
      </ol>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-semibold ink">What the model pays most attention to</h3>
          <p className="text-xs ink-3">Average days of delay each factor adds, across {ai.sample} of your open invoices</p>
          <div className="mt-4 space-y-2.5">
            {imp.map((f, i) => (
              <div key={f.feature} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_44px] items-center gap-3 text-sm">
                <span className="truncate ink-2" title={f.label}>{f.label}</span>
                <span className="h-2.5 overflow-hidden rounded-full surface-2"><span className="block h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500" style={{ width: `${(f.days / max) * 100}%`, opacity: 1 - i * 0.07 }} /></span>
                <span className="text-right font-semibold num ink">+{f.days.toFixed(1)}d</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold ink">What a prediction looks like</h3>
          <p className="text-xs ink-3">Chance of payment in each period after the due date, for a reliable vs a risky invoice</p>
          <div className="mt-3 h-52">
            <ResponsiveContainer>
              <BarChart data={curves} margin={{ left: -18, right: 4, top: 6 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="p" tick={axisTick} tickLine={false} axisLine={false} interval={0} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} unit="%" />
                <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [`${v}%`, n === "reliable" ? "Reliable" : "Risky"]} />
                <Legend {...legendProps} formatter={(v: string) => (v === "reliable" ? "Reliable customer" : "Risky customer")} />
                <Bar dataKey="reliable" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="risky" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <p className="mt-2 text-xs ink-3">
        Model: discrete-time survival model with gradient-boosted trees · {ai.features_used} features{paid ? ` · trained on ${paid.toLocaleString("en-IN")} paid invoices` : ""} ·
        {ai.model === "own" ? " personalised to your ledger" : " starter model until you have enough history"}. Munim AI (left menu) can explain any of this in plain words.
      </p>
    </section>
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
          <h1 className="text-2xl font-semibold tracking-tight ink sm:text-3xl">AI &amp; impact</h1>
          <p className="mt-1 ink-2">How the AI makes its predictions, how far you can trust them, and what they have done for your cash flow.</p>
        </div>
        <Button icon={<RefreshCw className="size-4" />} loading={retrain.isPending} onClick={() => retrain.mutate()}>Retrain now</Button>
      </div>

      {data.ai?.importance && <HowAIWorks ai={data.ai} paid={m.paid_invoices} />}

      <h2 className="mt-10 text-xl font-semibold ink" data-tour="ai-personas">Customer personas (unsupervised learning)</h2>
      <p className="text-sm ink-2">No labels needed: the AI finds groups of customers who pay alike, and suggests a strategy for each.</p>
      <PersonaMap />

      <h2 className="mt-10 text-xl font-semibold ink">Model health</h2>
      <p className="text-sm ink-2">An AI that checks itself: are its probabilities honest, and does today's data still look like what it learned from?</p>
      <ModelHealth />

      <h2 className="mt-10 text-xl font-semibold ink">Unusual invoices</h2>
      <p className="text-sm ink-2">An Isolation Forest flags unpaid invoices whose amount, credit period or timing is out of character for that customer - often a typo or a duplicate.</p>
      <AnomalyList />

      <h2 className="mt-10 text-xl font-semibold ink">What it has done for you</h2>
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
          <div className="divide-y divide-[var(--line)]">
            {data.insights.actions.map((a) => (
              <div key={a.kind} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1"><div className="text-sm font-medium ink">{a.title}</div><div className="text-xs ink-3">{a.sent} sent</div></div>
                <div className="text-right text-sm"><div className="font-semibold num ink">{a.success_rate == null ? "Waiting…" : pct(a.success_rate)}</div><div className="text-xs ink-3">{a.success_rate == null ? "result in ~10 days" : "paid within 10 days"}</div></div>
              </div>
            ))}
            <div className="px-5 py-4 text-sm ink-2">{data.insights.actions_taken} actions taken · {inrShort(data.insights.recovered_after_action)} recorded as collected</div>
          </div>
        )}
      </Card>
    </div>
  );
}
