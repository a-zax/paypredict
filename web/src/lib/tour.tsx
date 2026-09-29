import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type TourStep = {
  title: string;
  body: ReactNode;
  route?: string;          // page the step lives on
  target?: string;         // [data-tour="..."] element to spotlight; none = centred card
  click?: string;          // [data-tour] element to click when entering (e.g. open a drawer)
  escape?: boolean;        // close drawers/panels when entering
  optional?: boolean;      // skip silently if the target isn't on screen
};

type Ctx = { start: (from?: number) => void; active: boolean };
const TourCtx = createContext<Ctx>({ start: () => {}, active: false });
export const useTour = () => useContext(TourCtx);

const visible = (sel: string): HTMLElement | null => {
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${sel}"]`));
  return els.find((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden") ?? null;
};
const pressEscape = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

export function TourProvider({ steps, storageKey, children }: { steps: TourStep[]; storageKey: string; children: ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const dir = useRef(1);
  const step = index !== null ? steps[index] : null;

  const finish = useCallback((completed: boolean) => {
    setIndex(null); setRect(null);
    pressEscape();
    try { localStorage.setItem(storageKey, completed ? "done" : "skipped"); } catch { /* private mode */ }
  }, [storageKey]);

  const go = useCallback((i: number) => {
    if (i < 0) return;
    if (i >= steps.length) return finish(true);
    dir.current = index === null || i >= index ? 1 : -1;
    setReady(false); setRect(null); setIndex(i);
  }, [steps.length, finish, index]);

  const start = useCallback((from = 0) => { dir.current = 1; setReady(false); setIndex(from); }, []);

  // Enter a step: navigate, run its side-effect, then wait for the target to appear.
  useEffect(() => {
    if (!step) return;
    if (step.route && loc.pathname !== step.route) { pressEscape(); nav(step.route); return; }
    let cancelled = false;
    if (step.escape) pressEscape();
    if (step.click) setTimeout(() => visible(step.click!)?.click(), 150);
    if (!step.target) { setReady(true); return; }
    const t0 = Date.now();
    const find = () => {
      if (cancelled) return;
      const el = visible(step.target!);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(() => { if (!cancelled) { setRect(el.getBoundingClientRect()); setReady(true); } }, 350);
      } else if (Date.now() - t0 > 4000) {
        if (step.optional) go(index! + dir.current); else setReady(true);   // fall back to a centred card
      } else setTimeout(find, 120);
    };
    find();
    return () => { cancelled = true; };
  }, [step, loc.pathname]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the spotlight glued to the element while the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!step?.target || !ready) return;
    let raf = 0;
    const tick = () => {
      const el = visible(step.target!);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((old) => (old && Math.abs(old.top - r.top) < 0.5 && Math.abs(old.left - r.left) < 0.5 && Math.abs(old.height - r.height) < 0.5 ? old : r));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, ready]);

  useEffect(() => {
    if (index === null) return;
    const h = (e: KeyboardEvent) => {
      if (!e.isTrusted) return;
      if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); go(index + 1); }
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "Escape") finish(false);
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [index, go, finish]);

  return (
    <TourCtx.Provider value={{ start, active: index !== null }}>
      {children}
      <AnimatePresence>
        {step && ready && <TourOverlay key="tour" step={step} index={index!} total={steps.length} rect={rect}
          onNext={() => go(index! + 1)} onBack={() => go(index! - 1)} onSkip={() => finish(false)} />}
      </AnimatePresence>
    </TourCtx.Provider>
  );
}

function TourOverlay({ step, index, total, rect, onNext, onBack, onSkip }: {
  step: TourStep; index: number; total: number; rect: DOMRect | null; onNext: () => void; onBack: () => void; onSkip: () => void;
}) {
  const nextBtn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState({ x: 0, y: 0 });
  useEffect(() => { nextBtn.current?.focus({ preventScroll: true }); }, [index]);
  // After layout, keep the whole card inside the viewport (short screens, wide targets, zoomed browsers).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const baseL = r.left - nudge.x, baseT = r.top - nudge.y, m = 12;
    const x = baseL + r.width > window.innerWidth - m ? window.innerWidth - m - r.width - baseL : baseL < m ? m - baseL : 0;
    const y = baseT + r.height > window.innerHeight - m ? window.innerHeight - m - r.height - baseT : baseT < m ? m - baseT : 0;
    if (Math.abs(x - nudge.x) > 1 || Math.abs(y - nudge.y) > 1) setNudge({ x, y });
  });
  const vw = window.innerWidth, vh = window.innerHeight;
  const mobile = vw < 640;
  const pad = 8;
  const hole = rect && { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  const W = Math.min(360, vw - 32);

  let card: React.CSSProperties;
  if (!hole) card = { top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: Math.min(440, vw - 32) };
  else if (mobile) card = hole.top + hole.height / 2 > vh / 2 ? { left: 12, right: 12, top: 12 } : { left: 12, right: 12, bottom: 12 };   // dock away from the spotlight
  else {
    const below = vh - (hole.top + hole.height) > 240;
    const top = below ? hole.top + hole.height + 12 : Math.max(16, hole.top - 12);
    const left = Math.min(Math.max(16, hole.left + hole.width / 2 - W / 2), vw - W - 16);
    card = below ? { top, left, width: W } : { top, left, width: W, transform: "translateY(-100%)" };
    if (!below && hole.top < 260) card = { top: Math.min(Math.max(16, hole.top), vh - 300), left: hole.left + hole.width + 16 + W < vw ? hole.left + hole.width + 16 : Math.max(16, hole.left - W - 16), width: W };
  }

  return (
    <motion.div className="fixed inset-0 z-[100]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label={step.title}>
      {/* click-blocker + dim */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />
      {hole ? (
        <motion.div className="pointer-events-none absolute rounded-2xl ring-2 ring-brand-400"
          style={{ boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.58), 0 0 0 6px rgba(99,102,241,0.25)" }}
          animate={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} transition={{ type: "spring", damping: 30, stiffness: 300 }} />
      ) : <div className="absolute inset-0 bg-slate-950/60" />}

      {/* outer div owns position/transform; inner motion div owns the animation (motion overwrites `transform`) */}
      <div ref={box} className="absolute" style={{ ...card, marginLeft: nudge.x, marginTop: nudge.y }}>
      <motion.div key={index} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="card p-5 shadow-[var(--shadow-pop)]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-brand-600 dark:text-brand-200">Step {index + 1} of {total}</span>
          <button onClick={onSkip} aria-label="Close tour" className="focus-ring grid size-7 place-items-center rounded-lg ink-3 hover:bg-[var(--surface-2)]"><X className="size-4" /></button>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full surface-2"><div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${((index + 1) / total) * 100}%` }} /></div>
        <h3 className="mt-3 text-base font-semibold ink">{step.title}</h3>
        <div className="mt-1.5 text-sm leading-relaxed ink-2">{step.body}</div>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={onSkip} className="focus-ring rounded-lg px-2 py-1 text-xs ink-3 hover:ink-2">Skip tour</button>
          <div className="ml-auto flex gap-2">
            {index > 0 && <button onClick={onBack} className="focus-ring inline-flex h-9 items-center gap-1 rounded-xl border line px-3 text-sm ink hover:bg-[var(--surface-2)]"><ArrowLeft className="size-4" />Back</button>}
            <button ref={nextBtn} onClick={onNext} className="focus-ring inline-flex h-9 items-center gap-1 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
              {index + 1 === total ? "Finish" : <>Next<ArrowRight className="size-4" /></>}
            </button>
          </div>
        </div>
        {!mobile && index === 0 && <p className="mt-3 text-[11px] ink-3">Tip: use ← → keys to move, Esc to exit.</p>}
      </motion.div>
      </div>
    </motion.div>
  );
}
