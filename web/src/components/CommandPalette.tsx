import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { BarChart3, Compass, CornerDownLeft, FileText, Moon, Search, Settings, ShieldCheck, Sparkles, Target, Users, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Customer, type Invoice } from "../lib/api";
import { cx, inrShort } from "../lib/format";
import { useTheme } from "../lib/theme";
import { useTour } from "../lib/tour";
import { useDrawers } from "./Drawers";
import { Grade } from "./ui";

type Item = { id: string; group: string; label: string; hint?: string; icon: ReactNode; run: () => void };

export function CommandPalette({ open, onClose, onAsk }: { open: boolean; onClose: () => void; onAsk: () => void }) {
  const nav = useNavigate();
  const { openInvoice, openCustomer } = useDrawers();
  const { toggle } = useTheme();
  const { start } = useTour();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { data: buyers } = useQuery<Customer[]>({ queryKey: ["buyers"], queryFn: () => api("/buyers"), enabled: open });
  const { data: invs } = useQuery<{ items: Invoice[] }>({ queryKey: ["invoices", "palette"], queryFn: () => api("/invoices?status=open&limit=1000"), enabled: open });

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => nav(to);
    const pages: Item[] = [
      { id: "p-today", group: "Pages", label: "Today", icon: <Zap className="size-4" />, run: go("/") },
      { id: "p-inv", group: "Pages", label: "Invoices", icon: <FileText className="size-4" />, run: go("/invoices") },
      { id: "p-cust", group: "Pages", label: "Customers", icon: <Users className="size-4" />, run: go("/customers") },
      { id: "p-cash", group: "Pages", label: "Cash flow forecast", icon: <BarChart3 className="size-4" />, run: go("/cash") },
      { id: "p-order", group: "Pages", label: "Check a new order", hint: "credit check", icon: <ShieldCheck className="size-4" />, run: go("/credit-check") },
      { id: "p-impact", group: "Pages", label: "Impact & accuracy", icon: <Target className="size-4" />, run: go("/impact") },
      { id: "p-set", group: "Pages", label: "Settings", hint: "UPI, Udyam, rates", icon: <Settings className="size-4" />, run: go("/settings") },
      { id: "c-ask", group: "Commands", label: "Ask PayPredict AI", icon: <Sparkles className="size-4" />, run: onAsk },
      { id: "c-tour", group: "Commands", label: "Take the guided tour", icon: <Compass className="size-4" />, run: () => start(0) },
      { id: "c-dark", group: "Commands", label: "Toggle dark mode", icon: <Moon className="size-4" />, run: toggle },
    ];
    const s = q.trim().toLowerCase();
    if (!s) return pages;
    const match = (t: string) => t.toLowerCase().includes(s);
    const cust = (buyers ?? []).filter((b) => match(b.name)).slice(0, 6).map<Item>((b) => ({
      id: `b-${b.id}`, group: "Customers", label: b.name, hint: `owes ${inrShort(b.open_amount)}`, icon: <Grade g={b.grade} />, run: () => openCustomer(b.id),
    }));
    const inv = (invs?.items ?? []).filter((i) => match(i.number) || match(i.buyer_name)).slice(0, 6).map<Item>((i) => ({
      id: `i-${i.id}`, group: "Invoices", label: `${i.number} · ${i.buyer_name}`, hint: inrShort(i.amount), icon: <FileText className="size-4" />, run: () => openInvoice(i.id),
    }));
    return [...pages.filter((p) => match(p.label) || match(p.hint ?? "")), ...cust, ...inv];
  }, [q, buyers, invs, nav, onAsk, start, toggle, openCustomer, openInvoice]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { list.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const run = (it?: Item) => { if (!it) return; onClose(); setTimeout(it.run, 10); };
  let lastGroup = "";

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
          <motion.div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div role="dialog" aria-label="Search" initial={{ opacity: 0, scale: 0.97, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
            className="card relative w-full max-w-xl overflow-hidden shadow-[var(--shadow-pop)]"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(i + 1, items.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); run(items[sel]); }
              else if (e.key === "Escape") onClose();
            }}>
            <div className="flex items-center gap-3 border-b line px-4">
              <Search className="size-4 ink-3" />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers, invoices, pages…"
                className="h-14 flex-1 bg-transparent text-[15px] ink outline-none placeholder:text-[var(--ink-3)]" aria-label="Search" />
              <kbd className="rounded-md border line px-1.5 py-0.5 text-[11px] ink-3">Esc</kbd>
            </div>
            <div ref={list} className="max-h-[55vh] overflow-y-auto p-2">
              {items.length === 0 && <div className="px-3 py-10 text-center text-sm ink-3">No matches for “{q}”</div>}
              {items.map((it, i) => {
                const header = it.group !== lastGroup ? (lastGroup = it.group) : null;
                return (
                  <div key={it.id}>
                    {header && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide ink-3">{header}</div>}
                    <button data-idx={i} onMouseEnter={() => setSel(i)} onClick={() => run(it)}
                      className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm", i === sel ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200" : "ink")}>
                      <span className="grid size-7 shrink-0 place-items-center">{it.icon}</span>
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.hint && <span className="text-xs ink-3">{it.hint}</span>}
                      {i === sel && <CornerDownLeft className="size-3.5 opacity-60" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
