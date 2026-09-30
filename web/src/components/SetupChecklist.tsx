import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Compass, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { cx } from "../lib/format";
import { useTour } from "../lib/tour";
import { Card } from "./ui";

type Setup = { upi: boolean; legal_details: boolean; phones: number; phones_needed: number; first_action: boolean; customers: number };
const flag = (k: string) => { try { return !!localStorage.getItem(k); } catch { return false; } };

/** Getting-started checklist. Ticks come from real data (UPI saved, numbers added...), not manual checkboxes. */
export function SetupChecklist() {
  const { data: me } = useMe();
  const { start } = useTour();
  const uid = me?.user.id ?? "anon";
  const hideKey = `pp_setup_hidden_${uid}`;
  const [hidden, setHidden] = useState(() => flag(hideKey));
  const [collapsed, setCollapsed] = useState(false);
  const { data } = useQuery<Setup>({ queryKey: ["setup"], queryFn: () => api("/setup") });
  if (!data || hidden) return null;

  const tourDone = flag(`pp_tour_${uid}`);
  const creditDone = flag(`pp_credit_checked_${uid}`);
  const items = [
    { done: tourDone, title: "Take the 2-minute tour", sub: "See every feature on your own data", cta: <button onClick={() => start(0)} className="inline-flex items-center gap-1 text-brand-600"><Compass className="size-3.5" />Start</button> },
    { done: data.upi, title: "Add your UPI ID", sub: "Every reminder gets a one-tap payment link", cta: <Link to="/settings" className="text-brand-600">Add</Link> },
    // Contact details can't be saved in the shared demo, so don't ask for them there.
    ...(me?.org.is_demo ? [] : [{ done: data.phones_needed > 0 && data.phones >= Math.min(5, data.phones_needed), title: "Add WhatsApp numbers for your top customers",
      sub: `${data.phones} of your ${data.phones_needed} biggest customers have a number`, cta: <Link to="/customers" className="text-brand-600">Add</Link> }]),
    { done: data.first_action, title: "Send your first reminder", sub: "Use a card below - it takes one tap", cta: null },
    { done: creditDone, title: "Check a new order before dispatch", sub: "Know the risk before you give credit", cta: <Link to="/credit-check" className="text-brand-600">Try</Link> },
    { done: data.legal_details, title: "Add Udyam number & address", sub: "Needed for legal notices with interest", cta: <Link to="/settings" className="text-brand-600">Add</Link> },
  ];
  const n = items.filter((i) => i.done).length;
  const hide = () => { setHidden(true); try { localStorage.setItem(hideKey, "1"); } catch { /* ignore */ } };

  return (
    <Card className="mt-4 overflow-hidden" data-tour="checklist">
      <div className="flex items-center gap-4 p-4 sm:px-5">
        <div className="relative size-11 shrink-0">
          <svg viewBox="0 0 44 44" className="size-11 -rotate-90"><circle cx="22" cy="22" r="18" fill="none" stroke="var(--line)" strokeWidth="4" />
            <circle cx="22" cy="22" r="18" fill="none" stroke="#10b981" strokeWidth="4" strokeLinecap="round" strokeDasharray={113} strokeDashoffset={113 * (1 - n / items.length)} className="transition-all duration-700" /></svg>
          <span className="absolute inset-0 grid place-items-center text-xs font-semibold num ink">{n}/{items.length}</span>
        </div>
        <div className="flex-1">
          <div className="font-semibold ink">{n === items.length ? "You're fully set up 🎉" : "Get the most out of PayPredict"}</div>
          <div className="text-sm ink-2">{n === items.length ? "Nice work. You can hide this now." : "A few quick steps - each one ticks itself when done."}</div>
        </div>
        <button onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand" : "Collapse"} className="focus-ring grid size-8 place-items-center rounded-lg ink-3 hover:bg-[var(--surface-2)]">
          <ChevronDown className={cx("size-4 transition-transform", collapsed && "-rotate-90")} /></button>
        <button onClick={hide} aria-label="Hide checklist" title="Hide" className="focus-ring grid size-8 place-items-center rounded-lg ink-3 hover:bg-[var(--surface-2)]"><X className="size-4" /></button>
      </div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.ul initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="divide-y divide-[var(--line)] overflow-hidden border-t line">
            {/* Only what's left gets a full row; finished steps fold into one line so the Today actions stay high on the page. */}
            {items.filter((it) => !it.done).map((it) => (
              <li key={it.title} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span className="size-6 shrink-0 rounded-full border-2 line" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium ink">{it.title}</div>
                  <div className="text-xs ink-3">{it.sub}</div>
                </div>
                {it.cta && <span className="text-sm font-medium">{it.cta}</span>}
              </li>
            ))}
            {n > 0 && (
              <li className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500 text-white"><Check className="size-3.5" /></span>
                <div className="min-w-0 flex-1 truncate text-xs ink-3">
                  <span className="font-medium ink-2">Done:</span> {items.filter((it) => it.done).map((it) => it.title).join(" · ")}
                </div>
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </Card>
  );
}
