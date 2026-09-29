import { AnimatePresence, motion } from "motion/react";
import { BookOpen, Compass, HelpCircle, Keyboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/format";
import { useTour } from "../lib/tour";
import { Modal, TERMS } from "./ui";

const SHORTCUTS: [string[], string][] = [
  [["Ctrl", "K"], "Search anything / run a command"],
  [["/"], "Search"],
  [["?"], "Show keyboard shortcuts"],
  [["G", "T"], "Go to Today"], [["G", "I"], "Go to Invoices"], [["G", "C"], "Go to Customers"],
  [["G", "F"], "Go to Cash flow"], [["G", "O"], "Check a new order"],
  [["A"], "Ask PayPredict AI"],
  [["Esc"], "Close any panel"],
];
const GLOSSARY: Record<string, string> = {
  ...TERMS,
  "Likely range": "The window in which the payment will most probably arrive. In back-tests, about 86% of payments landed inside it.",
  "Grade (A-D)": "How reliably a customer paid over the last 12 months. A = pays on time, D = often very late.",
  "Days saved": "How much sooner an invoice was paid than the AI predicted at the moment you acted. Only counted when you took an action.",
};

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-grid min-w-6 place-items-center rounded-md border line bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] font-medium ink">{children}</kbd>;
}

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="divide-y line">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between py-2.5 text-sm">
            <span className="ink-2">{label}</span>
            <span className="flex items-center gap-1">{keys.map((k, i) => <span key={i} className="flex items-center gap-1">{i > 0 && <span className="text-xs ink-3">then</span>}<Kbd>{k}</Kbd></span>)}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function GlossaryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="What these terms mean">
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {Object.entries(GLOSSARY).map(([k, v]) => (
          <div key={k}><div className="text-sm font-semibold ink">{k}</div><p className="mt-0.5 text-sm leading-relaxed ink-2">{v}</p></div>
        ))}
      </div>
    </Modal>
  );
}

/** "?" button: tour, shortcuts, glossary. `compact` = icon-only (mobile header). */
export function HelpMenu({ compact, onShortcuts, onGlossary }: { compact?: boolean; onShortcuts: () => void; onGlossary: () => void }) {
  const [open, setOpen] = useState(false);
  const { start } = useTour();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const items = [
    { icon: <Compass className="size-4" />, label: "Take the guided tour", sub: "2 minutes, every feature", run: () => start(0) },
    { icon: <Keyboard className="size-4" />, label: "Keyboard shortcuts", sub: "Work faster", run: onShortcuts },
    { icon: <BookOpen className="size-4" />, label: "What terms mean", sub: "TReDS, 43B(h), DSO…", run: onGlossary },
  ];
  return (
    <div ref={ref} className="relative">
      <button data-tour="help" onClick={() => setOpen((o) => !o)} aria-label="Help" aria-expanded={open}
        className={cx("focus-ring flex items-center gap-3 rounded-xl text-sm font-medium ink-2 hover:bg-[var(--surface-2)] hover:text-[var(--ink)]", compact ? "grid size-9 place-items-center" : "w-full px-3 py-2.5")}>
        <HelpCircle className={compact ? "size-4" : "size-[18px]"} />{!compact && "Help & tour"}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={cx("card absolute z-50 w-64 p-1.5 shadow-[var(--shadow-pop)]", compact ? "right-0 top-11" : "bottom-12 left-0")}>
            {items.map((it) => (
              <button key={it.label} onClick={() => { setOpen(false); it.run(); }}
                className="focus-ring flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--surface-2)]">
                <span className="mt-0.5 text-brand-600 dark:text-brand-200">{it.icon}</span>
                <span><span className="block text-sm font-medium ink">{it.label}</span><span className="block text-xs ink-3">{it.sub}</span></span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
