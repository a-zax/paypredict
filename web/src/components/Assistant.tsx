import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Bot, FileText, Mic, MicOff, RotateCcw, User2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { EngineBadge, Md, ReasoningTrace, type AgentReply } from "./ai";
import { useDrawers } from "./Drawers";

type Msg = { role: "user" | "assistant"; content: string; meta?: AgentReply };

const STARTERS = [
  { q: "Brief me on today", hint: "Summary, priorities and warnings" },
  { q: "Who should I call first?", hint: "Ranked by money at stake" },
  { q: "How much cash will come in this month?", hint: "1,000 simulated futures" },
  { q: "Any warnings? Who is getting slower?", hint: "Behaviour-change detection" },
  { q: "Should I accept an order of 5 lakh from Deccan Electricals?", hint: "Credit check before dispatch" },
  { q: "Kaveri replied: will pay by next Friday", hint: "Reads replies, checks if the promise will hold" },
  { q: "What types of customers do I have?", hint: "Personas by clustering (K-means)" },
  { q: "Any unusual invoices?", hint: "Anomaly detection (Isolation Forest)" },
  { q: "किसे कॉल करूं? मेसेज हिंदी में लिखो", hint: "Hindi / Hinglish / Marathi" },
];

const VOICE_LANG = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" } as const;

export function Assistant({ open, onClose, initialQuestion }: { open: boolean; onClose: () => void; initialQuestion?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const { openInvoice, openCustomer } = useDrawers();
  const { lang } = useT();
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);
  const SR = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  // Voice questions in English, Hindi or Marathi (browser speech recognition; the transcript goes to Munim like typed text).
  function toggleVoice() {
    if (listening) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = VOICE_LANG[lang]; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (e: any) => {
      const txt = Array.from(e.results).map((x: any) => x[0].transcript).join(" ");
      setInput(txt);
      if (e.results[e.results.length - 1].isFinal) { r.stop(); send(txt); }
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r; setListening(true); r.start();
  }
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => { if (open) setTimeout(() => box.current?.focus(), 250); }, [open]);
  const asked = useRef(false);
  useEffect(() => {
    if (open && initialQuestion && !asked.current) { asked.current = true; send(initialQuestion); }
  }, [open, initialQuestion]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next = [...msgs, { role: "user" as const, content: text.trim() }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await api<AgentReply>("/assistant", { method: "POST", json: { messages: next.map(({ role, content }) => ({ role, content })) } });
      setMsgs([...next, { role: "assistant", content: r.reply, meta: r }]);
    } catch (e: any) {
      setMsgs([...next, { role: "assistant", content: `Sorry - ${e.message}` }]);
    } finally { setBusy(false); }
  }
  const lastId = msgs.length - 1;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-slate-950/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.section role="dialog" aria-label="Munim AI" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="absolute right-0 top-0 flex h-full w-full max-w-lg flex-col bg-[var(--bg)] shadow-[var(--shadow-pop)]">
            <header className="flex items-center gap-3 border-b line bg-[var(--surface)] px-5 py-3.5">
              <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-violet-600 text-white shadow-md shadow-violet-600/30"><Bot className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-semibold ink">Munim AI <EngineBadge engine={msgs.at(-1)?.meta?.engine ?? "local"} small /></div>
                <div className="truncate text-xs ink-3">Your AI munim · plans, uses tools on your ledger, shows its reasoning</div>
              </div>
              {msgs.length > 0 && <button onClick={() => setMsgs([])} aria-label="New conversation" title="New conversation" className="focus-ring grid size-9 place-items-center rounded-full ink-3 hover:bg-[var(--surface-2)]"><RotateCcw className="size-4" /></button>}
              <button onClick={onClose} aria-label="Close" className="focus-ring grid size-9 place-items-center rounded-full ink-2 hover:bg-[var(--surface-2)]"><X className="size-4" /></button>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {msgs.length === 0 && (
                <div>
                  <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-violet-50 p-4 dark:from-brand-500/10 dark:to-violet-500/10">
                    <div className="text-sm font-semibold ink">Namaste! I'm Munim, your AI credit manager.</div>
                    <p className="mt-1 text-xs leading-relaxed ink-2">Like a trusted munim, I know who owes what. Ask in English, Hinglish, हिंदी or मराठी - or tap the mic. For every question I make a plan, call tools on your real invoices
                      (predictions, forecasts, grades, credit checks) and show each step, so you can see exactly why I answer the way I do.</p>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {STARTERS.map((s) => (
                      <button key={s.q} onClick={() => send(s.q)}
                        className="focus-ring card group flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:border-violet-300">
                        <span><span className="block text-sm ink">{s.q}</span><span className="block text-[11px] ink-3">{s.hint}</span></span>
                        <ArrowUp className="size-4 rotate-45 text-violet-500 opacity-0 transition group-hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => m.role === "user" ? (
                <div key={i} className="flex justify-end gap-2">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white">{m.content}</div>
                  <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full surface-2 ink-3"><User2 className="size-3.5" /></span>
                </div>
              ) : (
                <div key={i} className="flex gap-2">
                  <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-violet-600 text-white"><Bot className="size-3.5" /></span>
                  <div className="min-w-0 flex-1 space-y-2.5">
                    {m.meta?.steps && <ReasoningTrace steps={m.meta.steps} ms={m.meta.ms} engine={m.meta.engine} animate={i === lastId} defaultOpen={i === lastId} />}
                    <div className="card rounded-tl-md px-4 py-3 text-sm leading-relaxed ink"><Md text={m.content} /></div>
                    {!!m.meta?.links?.length && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.meta.links.map((l) => (
                          <button key={l.type + l.id} onClick={() => { onClose(); setTimeout(() => (l.type === "invoice" ? openInvoice : openCustomer)(l.id), 200); }}
                            className="focus-ring inline-flex items-center gap-1 rounded-lg border line bg-[var(--surface)] px-2 py-1 text-xs ink-2 hover:border-brand-300 hover:text-brand-600">
                            <FileText className="size-3" />{l.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {i === lastId && !!m.meta?.suggestions?.length && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.meta.suggestions.map((s) => (
                          <button key={s} onClick={() => send(s)} className="focus-ring rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-300">{s}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex gap-2">
                  <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-violet-600 text-white"><Bot className="size-3.5" /></span>
                  <div className="card inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm ink-2">
                    <span className="flex gap-1">{[0, 1, 2].map((k) => <span key={k} className="size-1.5 animate-bounce rounded-full bg-violet-500" style={{ animationDelay: `${k * 120}ms` }} />)}</span>
                    Planning and checking your ledger…
                  </div>
                </div>
              )}
              <div ref={end} />
            </div>

            <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t line bg-[var(--surface)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex items-end gap-2 rounded-2xl border line bg-[var(--bg)] p-2 focus-within:border-violet-400">
                <textarea ref={box} value={input} onChange={(e) => setInput(e.target.value)} rows={1}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                  placeholder={listening ? "Listening…" : "Ask in English, हिंदी or मराठी…"} aria-label="Ask the AI"
                  className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm ink outline-none placeholder:text-[var(--ink-3)]" />
                {SR && (
                  <button type="button" onClick={toggleVoice} aria-label={listening ? "Stop listening" : "Ask by voice"} title={`Ask by voice (${VOICE_LANG[lang]})`}
                    className={`focus-ring grid size-9 place-items-center rounded-xl ${listening ? "animate-pulse bg-rose-500 text-white" : "ink-2 hover:bg-[var(--surface-2)]"}`}>
                    {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                  </button>
                )}
                <button type="submit" disabled={!input.trim() || busy} aria-label="Send"
                  className="focus-ring grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-violet-600 text-white disabled:opacity-40"><ArrowUp className="size-4" /></button>
              </div>
              <p className="mt-1.5 px-1 text-[10.5px] ink-3">Answers use only your data. Guidance, not legal advice.</p>
            </form>
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
}
