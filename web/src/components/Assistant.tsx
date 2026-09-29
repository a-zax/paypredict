import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, KeyRound, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { cx } from "../lib/format";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };

const SUGGESTIONS = [
  "Who should I call first today?",
  "How much cash will come in over the next 4 weeks?",
  "Which customers should I stop giving credit to?",
  "Draft a firm but polite note for my biggest overdue invoice",
  "मेरे सबसे ज़्यादा देर से भुगतान करने वाले ग्राहक कौन हैं?",
];
const TOOL_LABEL: Record<string, string> = {
  get_business_summary: "Checked your summary", list_invoices: "Looked up invoices", get_customer: "Read customer history",
  list_customers: "Ranked customers", cash_forecast: "Ran cash forecast", draft_message: "Drafted a message",
};

/** Minimal, safe markdown: **bold**, bullet lines, line breaks. No HTML injection. */
function Md({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      {text.split("\n").map((line, i) => {
        const bullet = /^\s*[-*•]\s+/.test(line);
        const parts = line.replace(/^\s*[-*•]\s+/, "").split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
          p.startsWith("**") && p.endsWith("**") ? <strong key={j} className="font-semibold">{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>);
        if (!line.trim()) return <div key={i} className="h-1" />;
        return bullet ? <div key={i} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-current opacity-50" /><span>{parts}</span></div>
          : <p key={i}>{parts}</p>;
      })}
    </div>
  );
}

export function Assistant({ open, onClose, enabled }: { open: boolean; onClose: () => void; enabled: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next = [...msgs, { role: "user" as const, content: text.trim() }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const r = await api<{ reply: string; tools_used: string[] }>("/assistant", {
        method: "POST", json: { messages: next.map(({ role, content }) => ({ role, content })) },
      });
      setMsgs([...next, { role: "assistant", content: r.reply, tools: [...new Set(r.tools_used)] }]);
    } catch (e: any) {
      setMsgs([...next, { role: "assistant", content: `Sorry - ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-slate-950/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.section initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-[var(--bg)] shadow-[var(--shadow-pop)]">
            <header className="flex items-center gap-3 border-b line bg-[var(--surface)] px-5 py-4">
              <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-violet-600 text-white"><Sparkles className="size-4" /></span>
              <div className="flex-1">
                <div className="font-semibold ink">Ask PayPredict</div>
                <div className="text-xs ink-3">Answers from your own ledger · powered by Claude</div>
              </div>
              <button onClick={onClose} aria-label="Close" className="focus-ring grid size-9 place-items-center rounded-full ink-2 hover:bg-[var(--surface-2)]"><X className="size-4" /></button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {!enabled && (
                <div className="card flex gap-3 p-4 text-sm">
                  <KeyRound className="mt-0.5 size-5 shrink-0 text-amber-500" />
                  <div className="ink-2">
                    <div className="font-medium ink">AI assistant not switched on yet</div>
                    Add an <code className="rounded bg-[var(--surface-2)] px-1">ANTHROPIC_API_KEY</code> to the server environment and restart.
                    Every other part of PayPredict works without it.
                  </div>
                </div>
              )}
              {msgs.length === 0 && (
                <div>
                  <p className="text-sm ink-2">Ask anything about your receivables. I look up your real numbers before answering.</p>
                  <div className="mt-4 flex flex-col gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => send(s)} disabled={!enabled}
                        className="focus-ring card px-4 py-3 text-left text-sm ink transition-colors hover:border-brand-300 disabled:opacity-50">{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cx("max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                    m.role === "user" ? "bg-brand-600 text-white rounded-br-md" : "card ink rounded-bl-md")}>
                    {m.tools && m.tools.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1">
                        {m.tools.map((t) => <span key={t} className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] ink-2">✓ {TOOL_LABEL[t] ?? t}</span>)}
                      </div>
                    )}
                    {m.role === "assistant" ? <Md text={m.content} /> : m.content}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="card inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm ink-2">
                  <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-brand-500" style={{ animationDelay: `${i * 120}ms` }} />)}</span>
                  Checking your ledger…
                </div>
              )}
              <div ref={end} />
            </div>

            <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t line bg-[var(--surface)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex items-end gap-2 rounded-2xl border line bg-[var(--bg)] p-2">
                <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} disabled={!enabled}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                  placeholder={enabled ? "Ask in English, हिंदी or मराठी…" : "Assistant is off"}
                  className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm ink outline-none placeholder:text-[var(--ink-3)]" />
                <button type="submit" disabled={!input.trim() || busy || !enabled} aria-label="Send"
                  className="focus-ring grid size-9 place-items-center rounded-xl bg-brand-600 text-white disabled:opacity-40"><ArrowUp className="size-4" /></button>
              </div>
            </form>
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
}
