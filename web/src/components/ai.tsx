import { AnimatePresence, motion } from "motion/react";
import { Brain, ChevronDown, Cpu, Eye, Search, Sparkles, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "../lib/format";

export type AgentStep = { thought: string; action: string; observation: string; ms: number };
export type AgentLink = { type: "invoice" | "customer"; id: number; label: string };
export type AgentReply = {
  engine: "local" | "claude"; intent?: string; confidence?: number; steps?: AgentStep[]; reply: string;
  links?: AgentLink[]; suggestions?: string[]; ms?: number; tools_used?: string[];
};

/** Minimal, safe markdown: **bold**, _italic_, bullets, numbered lines. No HTML injection. */
export function Md({ text, className }: { text: string; className?: string }) {
  const inline = (line: string) => line.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((p, j) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={j} className="font-semibold">{p.slice(2, -2)}</strong>
      : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <em key={j} className="opacity-80">{p.slice(1, -1)}</em> : <span key={j}>{p}</span>);
  return (
    <div className={cx("space-y-1.5", className)}>
      {text.split("\n").map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        const bullet = line.match(/^\s*[-*•]\s+(.*)/);
        const num = line.match(/^\s*(\d+)\.\s+(.*)/);
        if (bullet) return <div key={i} className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-current opacity-50" /><span>{inline(bullet[1])}</span></div>;
        if (num) return <div key={i} className="flex gap-2"><span className="w-4 shrink-0 font-semibold opacity-60">{num[1]}.</span><span>{inline(num[2])}</span></div>;
        return <p key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}

const STEP_ICON = [<Search key="s" className="size-3.5" />, <Wrench key="w" className="size-3.5" />, <Eye key="e" className="size-3.5" />];

/**
 * The agent's Thought -> Action -> Observation trace. `animate` reveals steps one by one
 * (the steps really ran on the server; pacing only makes the reasoning readable).
 */
export function ReasoningTrace({ steps, animate = false, defaultOpen = false, ms, engine = "local" }:
  { steps: AgentStep[]; animate?: boolean; defaultOpen?: boolean; ms?: number; engine?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const [shown, setShown] = useState(animate ? 0 : steps.length);
  useEffect(() => {
    if (!animate || !open) { setShown(steps.length); return; }
    setShown(0);
    const t = setInterval(() => setShown((n) => { if (n >= steps.length) { clearInterval(t); return n; } return n + 1; }), 380);
    return () => clearInterval(t);
  }, [animate, open, steps.length]);
  if (!steps.length) return null;
  return (
    <div className="rounded-xl border border-violet-200/70 bg-violet-50/50 dark:border-violet-500/20 dark:bg-violet-500/5">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-violet-700 dark:text-violet-300">
        <Brain className="size-3.5" />
        <span className="flex-1">How the AI worked this out · {steps.length} steps{ms != null ? ` · ${ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}` : ""}</span>
        <EngineBadge engine={engine} small />
        <ChevronDown className={cx("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="relative space-y-2.5 overflow-hidden px-3 pb-3">
            {steps.slice(0, shown).map((s, i) => (
              <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="relative flex gap-2.5">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-violet-600 text-[11px] font-semibold text-white">{i + 1}</span>
                <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
                  <div className="ink"><span className="font-semibold text-violet-700 dark:text-violet-300">Thought · </span>{s.thought}</div>
                  <div className="mt-1 flex items-start gap-1.5 font-mono text-[11px] ink-2">{STEP_ICON[1]}<span className="break-all">{s.action}</span>{s.ms > 0 && <span className="ml-auto shrink-0 ink-3">{s.ms} ms</span>}</div>
                  <div className="mt-1 flex items-start gap-1.5 ink-2">{STEP_ICON[2]}<span>{s.observation}</span></div>
                </div>
              </motion.li>
            ))}
            {shown < steps.length && (
              <li className="flex items-center gap-2 pl-1 text-xs text-violet-600"><span className="size-3 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />thinking…</li>
            )}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}

export function EngineBadge({ engine, small }: { engine?: string; small?: boolean }) {
  const claude = engine === "claude";
  return (
    <span title={claude ? "Answered by Claude using tools over your data" : "Munim AI on-device ReAct agent: intent model + planner + tools over your data"}
      className={cx("inline-flex items-center gap-1 rounded-full font-medium ring-1 ring-inset",
        small ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]",
        claude ? "bg-amber-50 text-amber-800 ring-amber-600/20" : "bg-violet-100 text-violet-700 ring-violet-600/20 dark:bg-violet-500/15 dark:text-violet-200")}>
      {claude ? <Sparkles className="size-3" /> : <Cpu className="size-3" />}{claude ? "Claude" : "On-device"}
    </span>
  );
}
