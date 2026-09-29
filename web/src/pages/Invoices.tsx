import { useQuery } from "@tanstack/react-query";
import { Download, FileSearch, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";
import { statusLine } from "../components/ActionCard";
import { useDrawers } from "../components/Drawers";
import { Avatar, Badge, Button, Card, Empty, RiskPill, Segmented, Skeleton } from "../components/ui";
import { api, type Invoice } from "../lib/api";
import { cx, d, inr, inrShort } from "../lib/format";
import { usePageTitle } from "../lib/theme";

const FILTERS = [
  { value: "open", label: "All unpaid" }, { value: "overdue", label: "Overdue" },
  { value: "high", label: "High risk" }, { value: "paid", label: "Paid" },
] as const;
type F = (typeof FILTERS)[number]["value"];
const PAGE = 50;

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function Invoices() {
  usePageTitle("Invoices");
  const { openInvoice } = useDrawers();
  const [filter, setFilter] = useState<F>("open");
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const [sort, setSort] = useState("priority");
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [filter, dq, sort]);
  const base = { status: filter === "high" ? "open" : filter, q: dq, sort: filter === "paid" ? "recent" : sort, ...(filter === "high" ? { risk: "high" } : {}) };
  const params = new URLSearchParams({ ...base, limit: String(limit) });
  const { data, isLoading, isFetching } = useQuery<{ total: number; amount: number; items: Invoice[] }>({
    queryKey: ["invoices", params.toString()], queryFn: () => api(`/invoices?${params}`), placeholderData: (prev) => prev,
  });
  const { data: counts } = useQuery<Record<F, number>>({ queryKey: ["invoices", "counts"], queryFn: () => api("/invoices/counts") });

  async function exportCsv() {
    const all = await api<{ items: Invoice[] }>(`/invoices?${new URLSearchParams({ ...base, limit: "100000" })}`);
    const head = ["Invoice", "Customer", "Invoice date", "Due date", "Amount", "Status", "Days overdue", "Chance of 15+ days late", "Expected payment", "Next step", "Paid on"];
    const rows = all.items.map((i) => [i.number, i.buyer_name, i.invoice_date, i.due_date, i.amount, i.status, i.days_overdue,
      i.paid_date ? "" : `${Math.round(i.risk * 100)}%`, i.expected_pay_date ?? "", i.paid_date ? "" : i.action_short, i.paid_date ?? ""]);
    const csv = "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");   // BOM so Excel shows ₹ and Hindi names
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `paypredict-${filter}-invoices.csv` });
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${all.items.length} invoices`, { description: "Opens in Excel or Google Sheets." });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight ink sm:text-3xl">Invoices</h1>
          <p className="mt-1 ink-2">{data ? <>{data.total.toLocaleString("en-IN")} invoices · {inrShort(data.amount)}</> : "Loading…"}</p>
        </div>
        <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={!data?.total}>Export</Button>
      </div>
      <div data-tour="inv-filters" className="mt-6 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({
            value: f.value, label: <>{f.label}{counts && <span className="ml-1.5 rounded-full bg-[var(--surface-2)] px-1.5 text-[11px] num ink-3">{counts[f.value].toLocaleString("en-IN")}</span>}</>,
          }))} />
        </div>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer or invoice number" aria-label="Search invoices"
            className="focus-ring h-10 w-full rounded-xl border line bg-[var(--surface)] pl-10 pr-9 text-sm ink placeholder:text-[var(--ink-3)]" />
          {q && <button onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg ink-3 hover:bg-[var(--surface-2)]"><X className="size-3.5" /></button>}
        </div>
        {filter !== "paid" && (
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className="focus-ring h-10 rounded-xl border line bg-[var(--surface)] px-3 text-sm ink">
            <option value="priority">Sort: most urgent</option><option value="amount">Sort: largest</option>
            <option value="due">Sort: due date</option><option value="risk">Sort: highest risk</option>
          </select>
        )}
      </div>

      <Card className={cx("mt-4 overflow-hidden transition-opacity", isFetching && !isLoading && "opacity-70")}>
        {isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          : !data?.items.length ? (
            <Empty icon={<FileSearch className="size-6" />} title={q ? `No invoices match “${q}”` : "Nothing here"}
              body={q ? "Check the spelling, or search by invoice number." : filter === "overdue" ? "No overdue invoices - great work!" : "Try a different filter."}
              action={q ? <Button onClick={() => setQ("")}>Clear search</Button> : undefined} />
          ) : (
            <div className="divide-y line">
              <div className="hidden grid-cols-[2fr_1fr_1fr_1.3fr_1.6fr] gap-4 px-5 py-3 text-xs font-medium uppercase tracking-wide ink-3 md:grid">
                <span>Customer</span><span className="text-right">Amount</span><span>Due</span><span>Status</span><span>{filter === "paid" ? "Paid on" : "Next step"}</span>
              </div>
              {data.items.map((i) => {
                const lateBy = i.paid_date ? Math.round((+new Date(i.paid_date) - +new Date(i.due_date)) / 864e5) : 0;
                return (
                  <button key={i.id} onClick={() => openInvoice(i.id)}
                    className="focus-ring grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)] md:grid-cols-[2fr_1fr_1fr_1.3fr_1.6fr] md:px-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={i.buyer_name} size={36} />
                      <div className="min-w-0"><div className="truncate text-sm font-medium ink">{i.buyer_name}</div><div className="text-xs ink-3">{i.number}</div></div>
                    </div>
                    <div className="text-right text-sm font-semibold num ink">{inr(i.amount)}</div>
                    <div className="hidden text-sm ink-2 md:block">{d(i.due_date)}</div>
                    <div className="col-span-2 flex flex-wrap gap-1 md:col-span-1">
                      {i.paid_date ? <Badge tone={lateBy > 15 ? "red" : lateBy > 0 ? "amber" : "green"}>{lateBy > 0 ? `Paid ${lateBy}d late` : "Paid on time"}</Badge>
                        : <>{statusLine(i)}<span className="md:hidden"><RiskPill band={i.risk_band} risk={i.risk} overdue={i.days_overdue} /></span></>}
                    </div>
                    <div className={cx("hidden text-sm md:block", i.paid_date ? "ink-2" : "ink")}>
                      {i.paid_date ? d(i.paid_date, { day: "numeric", month: "short", year: "numeric" }) : <><div className="truncate">{i.action_short}</div><div className="text-xs ink-3">Expected {d(i.expected_pay_date)}</div></>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
      </Card>
      {data && data.total > data.items.length && (
        <div className="mt-4 flex flex-col items-center gap-1">
          <Button onClick={() => setLimit((l) => l + PAGE * 2)} loading={isFetching}>Show more</Button>
          <span className="text-xs ink-3">Showing {data.items.length.toLocaleString("en-IN")} of {data.total.toLocaleString("en-IN")}</span>
        </div>
      )}
    </div>
  );
}
