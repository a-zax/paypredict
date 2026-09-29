import { AnimatePresence, motion } from "motion/react";
import { HelpCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "../lib/format";

// ------------------------------------------------------------------ Button
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "whatsapp" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  loading?: boolean;
};
export function Button({ variant = "secondary", size = "md", icon, loading, className, children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20",
    secondary: "bg-[var(--surface)] border line ink hover:bg-[var(--surface-2)]",
    ghost: "ink-2 hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
    whatsapp: "bg-[#1faa53] text-white hover:bg-[#178f45] shadow-sm shadow-green-700/20",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  }[variant];
  const s = { sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg", md: "h-10 px-4 text-sm gap-2 rounded-xl", lg: "h-12 px-5 text-[15px] gap-2 rounded-xl" }[size];
  return (
    <button {...rest} disabled={disabled || loading}
      className={cx("focus-ring inline-flex items-center justify-center font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap", v, s, className)}>
      {loading ? <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ Badge / pills
const TONES: Record<string, string> = {
  red: "bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-300",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-300",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/15 dark:bg-violet-500/10 dark:text-violet-300",
  gray: "bg-slate-100 text-slate-700 ring-slate-500/15 dark:bg-slate-500/15 dark:text-slate-300",
  brand: "bg-brand-50 text-brand-700 ring-brand-600/15 dark:bg-brand-500/15 dark:text-brand-200",
};
export function Badge({ tone = "gray", children, className, icon }: { tone?: string; children: ReactNode; className?: string; icon?: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", TONES[tone] ?? TONES.gray, className)}>{icon}{children}</span>;
}
export function RiskPill({ band, risk, overdue }: { band: string; risk: number; overdue?: number }) {
  if (overdue && overdue > 15) return null; // the overdue status chip already says it
  const tone = band === "high" ? "red" : band === "medium" ? "amber" : "green";
  const label = band === "high" ? "Likely late" : band === "medium" ? "Might be late" : "On track";
  return <Badge tone={tone}>{label} · {Math.round(risk * 100)}%</Badge>;
}
export function Grade({ g, size = "md" }: { g: string | null; size?: "md" | "lg" }) {
  const c = { A: "bg-emerald-500", B: "bg-sky-500", C: "bg-amber-500", D: "bg-rose-500" }[g ?? ""] ?? "bg-slate-400";
  return <span className={cx("inline-grid place-items-center rounded-lg font-bold text-white", c, size === "lg" ? "size-11 text-lg" : "size-7 text-sm")}>{g ?? "-"}</span>;
}

// ------------------------------------------------------------------ Cards, stats
export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx("card", className)}>{children}</div>;
}
export function Stat({ label, value, hint, tone, icon }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "red" | "amber" | "green"; icon?: ReactNode }) {
  const toneCls = tone === "red" ? "text-rose-600 dark:text-rose-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : tone === "green" ? "text-emerald-600" : "ink";
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-2 text-[13px] ink-2">{icon}{label}</div>
      <div className={cx("mt-1.5 text-2xl sm:text-[28px] font-semibold num", toneCls)}>{value}</div>
      {hint && <div className="mt-1 text-xs ink-3">{hint}</div>}
    </Card>
  );
}
export function Skeleton({ className }: { className?: string }) { return <div className={cx("skeleton", className)} />; }
export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      <div className="grid place-items-center size-14 rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-200">{icon}</div>
      <h3 className="mt-4 font-semibold ink">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm ink-2">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Jargon explainer
export const TERMS: Record<string, string> = {
  TReDS: "Trade Receivables Discounting System - an RBI-approved online marketplace where you can sell an unpaid invoice from a large buyer and get the money in 1-2 days, usually cheaper than an overdraft.",
  MSMED: "The MSMED Act, 2006 says buyers must pay registered micro & small suppliers within 45 days. After that, they owe you compound interest at 3× the RBI bank rate.",
  "43B(h)": "Income-tax rule (since 2024): if a company pays a micro/small supplier after 45 days, it can't claim that expense as a tax deduction until the year it actually pays. A strong reason for buyers to pay on time.",
  Samadhaan: "MSME Samadhaan is the government portal where micro & small businesses can file a case against buyers who pay late. The state council (MSEFC) then mediates.",
  DSO: "Days Sales Outstanding - on average, how many days of sales are still unpaid. Lower is better.",
  Udyam: "Udyam registration is the government's MSME certificate. It unlocks the 45-day payment protection.",
};
export function Term({ k, children }: { k: keyof typeof TERMS | string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="focus-ring inline-flex items-center gap-0.5 underline decoration-dotted decoration-[var(--ink-3)] underline-offset-2">
        {children ?? k}<HelpCircle className="size-3 ink-3" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="absolute left-1/2 top-full z-50 mt-2 w-72 -translate-x-1/2 rounded-xl bg-slate-900 p-3 text-left text-xs font-normal leading-relaxed text-slate-100 shadow-[var(--shadow-pop)]">
            {TERMS[k] ?? k}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

// ------------------------------------------------------------------ Drawer & modal
/** Escape-to-close, focus moves into the panel on open and returns to the trigger on close. */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", h);
    const t = setTimeout(() => ref.current?.focus({ preventScroll: true }), 50);
    return () => { window.removeEventListener("keydown", h); clearTimeout(t); prev?.focus?.({ preventScroll: true }); };
  }, [open]);
  return ref;
}

export function Drawer({ open, onClose, children, width = "max-w-2xl", label = "Details" }: { open: boolean; onClose: () => void; children: ReactNode; width?: string; label?: string }) {
  const ref = useDialog(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className={cx("absolute right-0 top-0 h-full w-full overflow-y-auto bg-[var(--bg)] shadow-[var(--shadow-pop)] outline-none", width)}>
            <button onClick={onClose} aria-label="Close" title="Close (Esc)" className="focus-ring absolute right-4 top-4 z-10 grid size-9 place-items-center rounded-full bg-[var(--surface)] border line ink-2 hover:ink"><X className="size-4" /></button>
            {children}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useDialog(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-slate-950/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
            initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
            className="card relative w-full max-w-md p-6 shadow-[var(--shadow-pop)] outline-none">
            <button onClick={onClose} aria-label="Close" className="focus-ring absolute right-4 top-4 grid size-8 place-items-center rounded-full ink-3 hover:bg-[var(--surface-2)]"><X className="size-4" /></button>
            <h3 className="pr-8 text-lg font-semibold ink">{title}</h3>
            <div className="mt-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ------------------------------------------------------------------ form bits
export function Input({ label, hint, className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: ReactNode }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium ink">{label}</span>}
      <input {...rest} className={cx("focus-ring h-11 w-full rounded-xl border line bg-[var(--surface)] px-3.5 text-sm ink placeholder:text-[var(--ink-3)] transition-shadow", className)} />
      {hint && <span className="mt-1 block text-xs ink-3">{hint}</span>}
    </label>
  );
}
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="focus-ring flex w-full items-start justify-between gap-4 rounded-xl text-left">
      <span><span className="block text-sm font-medium ink">{label}</span>{hint && <span className="mt-0.5 block text-xs ink-2">{hint}</span>}</span>
      <span className={cx("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600")}>
        <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
      </span>
    </button>
  );
}
export function Segmented<T extends string>({ value, onChange, options, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-xl surface-2 p-1 border line">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cx("focus-ring relative whitespace-nowrap rounded-lg font-medium transition-colors", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
            value === o.value ? "ink" : "ink-2 hover:text-[var(--ink)]")}>
          {value === o.value && <motion.span layoutId={`seg-${options.map((x) => x.value).join()}`} className="absolute inset-0 rounded-lg bg-[var(--surface)] shadow-sm border line" transition={{ type: "spring", damping: 30, stiffness: 400 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.replace(/[^A-Za-z\s]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "#";
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-xl font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${hue} 65% 55%), hsl(${(hue + 40) % 360} 65% 45%))` }}>
      {initials}
    </span>
  );
}
