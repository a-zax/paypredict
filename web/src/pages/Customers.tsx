import { useQuery } from "@tanstack/react-query";
import { Search, TrendingDown, TrendingUp, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useDrawers } from "../components/Drawers";
import { Card, Empty, Grade, Skeleton } from "../components/ui";
import { api, type Customer } from "../lib/api";
import { cx, inrShort } from "../lib/format";
import { usePageTitle } from "../lib/theme";

const GRADE_INFO = {
  A: ["Reliable", "bg-emerald-500"], B: ["Slightly late", "bg-sky-500"], C: ["Often late", "bg-amber-500"], D: ["High risk", "bg-rose-500"],
} as const;

export function Customers() {
  usePageTitle("Customers");
  const [sort, setSort] = useState<"risk" | "owed" | "slow" | "grade">("risk");
  const { openCustomer } = useDrawers();
  const { data, isLoading } = useQuery<Customer[]>({ queryKey: ["buyers"], queryFn: () => api("/buyers") });
  const [grade, setGrade] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const counts = useMemo(() => {
    const c: Record<string, { n: number; amt: number }> = { A: { n: 0, amt: 0 }, B: { n: 0, amt: 0 }, C: { n: 0, amt: 0 }, D: { n: 0, amt: 0 } };
    data?.forEach((b) => { if (b.grade) { c[b.grade].n++; c[b.grade].amt += b.open_amount; } });
    return c;
  }, [data]);
  const rows = (data ?? []).filter((b) => (!grade || b.grade === grade) && (!q || b.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sort === "owed" ? b.open_amount - a.open_amount : sort === "slow" ? (b.avg_days_late ?? -99) - (a.avg_days_late ?? -99)
      : sort === "grade" ? (a.grade ?? "Z").localeCompare(b.grade ?? "Z") : b.at_risk - a.at_risk);
  const totalOpen = Object.values(counts).reduce((a, c) => a + c.amt, 0) || 1;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight ink sm:text-3xl">Customers</h1>
      <p className="mt-1 ink-2">Every customer graded on how they actually pay - so you know who deserves credit.</p>

      <div data-tour="grades" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(Object.keys(GRADE_INFO) as (keyof typeof GRADE_INFO)[]).map((g) => (
          <button key={g} onClick={() => setGrade(grade === g ? null : g)}
            className={cx("focus-ring card p-4 text-left transition", grade === g ? "ring-2 ring-brand-500" : "hover:-translate-y-0.5")}>
            <div className="flex items-center gap-3"><Grade g={g} /><div><div className="text-sm font-medium ink">{GRADE_INFO[g][0]}</div><div className="text-xs ink-3">{counts[g].n} customers</div></div></div>
            <div className="mt-3 text-lg font-semibold num ink">{inrShort(counts[g].amt)} <span className="text-xs font-normal ink-3">owed</span></div>
            <div className="mt-2 h-1.5 rounded-full surface-2"><div className={cx("h-full rounded-full", GRADE_INFO[g][1])} style={{ width: `${(counts[g].amt / totalOpen) * 100}%` }} /></div>
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers" aria-label="Search customers"
            className="focus-ring h-10 w-full rounded-xl border line bg-[var(--surface)] pl-10 pr-3 text-sm ink placeholder:text-[var(--ink-3)]" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort customers" className="focus-ring h-10 rounded-xl border line bg-[var(--surface)] px-3 text-sm ink">
          <option value="risk">Sort: most money at risk</option><option value="owed">Sort: owes the most</option>
          <option value="slow">Sort: slowest payers</option><option value="grade">Sort: best grade first</option>
        </select>
      </div>
      {grade && <div className="mt-2 text-sm ink-2">Showing grade {grade} only · <button onClick={() => setGrade(null)} className="font-medium text-brand-600">show all</button></div>}

      <Card className="mt-4 overflow-hidden">
        {isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          : !rows.length ? <Empty icon={<Users className="size-6" />} title="No customers match" />
          : (
            <div className="divide-y line">
              <div className="hidden grid-cols-[2.2fr_1fr_1fr_1fr_2fr] gap-4 px-5 py-3 text-xs font-medium uppercase tracking-wide ink-3 md:grid">
                <span>Customer</span><span className="text-right">Owes you</span><span className="text-right">At risk</span><span className="text-right">Usually pays</span><span>What to do</span>
              </div>
              {rows.slice(0, 150).map((b) => (
                <button key={b.id} onClick={() => openCustomer(b.id)}
                  className="focus-ring grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 text-left hover:bg-[var(--surface-2)] md:grid-cols-[2.2fr_1fr_1fr_1fr_2fr] md:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Grade g={b.grade} />
                    <div className="min-w-0"><div className="truncate text-sm font-medium ink">{b.name}</div><div className="text-xs ink-3">{b.open_count} unpaid · {b.invoices_12m} paid this year</div></div>
                  </div>
                  <div className="text-right text-sm font-semibold num ink">{inrShort(b.open_amount)}</div>
                  <div className="hidden text-right text-sm num text-amber-600 md:block">{inrShort(b.at_risk)}</div>
                  <div className="hidden items-center justify-end gap-1 text-right text-sm num ink-2 md:flex">
                    {b.avg_days_late == null ? "-" : `${Math.round(b.avg_days_late)}d late`}
                    {b.trend === "worse" && <TrendingUp className="size-3.5 text-rose-500" />}{b.trend === "better" && <TrendingDown className="size-3.5 text-emerald-500" />}
                  </div>
                  <div className="col-span-2 truncate text-xs ink-2 md:col-span-1 md:text-sm">{b.advice}</div>
                </button>
              ))}
            </div>
          )}
      </Card>
    </div>
  );
}
