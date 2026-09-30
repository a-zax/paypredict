import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, Check, Eye, EyeOff, Languages, Moon, ShieldCheck, Sparkles, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Segmented } from "../components/ui";
import { useAuthActions } from "../lib/auth";
import { cx } from "../lib/format";
import { useTheme, usePageTitle } from "../lib/theme";

type Mode = "login" | "signup";

// ------------------------------------------------------------------ live product preview (left panel)
// One invoice going round the whole loop: predict -> remind (in 3 languages) -> pay by UPI -> paid. Fictional names.
type L3 = "en" | "hi" | "mr";
const MSG: Record<L3, string> = {
  en: "Dear Kaveri Foods team,\nA gentle reminder that invoice INV-2041 for ₹4,85,100 is due on 12 Sep. Kindly schedule the payment.",
  hi: "नमस्ते Kaveri Foods टीम,\nविनम्र स्मरण: इनवॉइस INV-2041 (₹4,85,100) की भुगतान तिथि 12 सितंबर है। कृपया भुगतान निर्धारित करें।",
  mr: "नमस्कार Kaveri Foods टीम,\nनम्र आठवण: इनव्हॉइस INV-2041 (₹4,85,100) ची देय तारीख 12 सप्टेंबर आहे. कृपया पेमेंट नियोजित करा.",
};
const PAY_LINE: Record<L3, string> = { en: "Pay instantly by UPI", hi: "UPI से तुरंत भुगतान करें", mr: "UPI द्वारे लगेच पेमेंट करा" };
const STEPS = ["Predict", "Remind", "Pay", "Paid"];
const STEP_MS = 3800;

function QrGlyph() {   // decorative only - not a scannable code
  const cells = "1110111010110101101011100100111011010101101100110111000101110101101001011011101010111001101";
  return (
    <svg viewBox="0 0 11 11" className="size-16 rounded-md bg-white p-1" aria-hidden="true">
      {cells.split("").map((c, i) => {
        const x = i % 11, y = Math.floor(i / 11);
        const corner = (x < 4 && y < 4) || (x > 6 && y < 4) || (x < 4 && y > 6);   // keep the three finder corners clean
        return c === "1" && !corner && <rect key={i} x={x} y={y} width="1" height="1" fill="#0f172a" />;
      })}
      {[[0, 0], [8, 0], [0, 8]].map(([x, y]) => (
        <g key={`${x}${y}`}><rect x={x + 0.35} y={y + 0.35} width="2.3" height="2.3" fill="none" stroke="#0f172a" strokeWidth="0.7" /><rect x={x + 1} y={y + 1} width="1" height="1" fill="#0f172a" /></g>
      ))}
    </svg>
  );
}

function LivePreview() {
  const [step, setStep] = useState(0);
  const [lang, setLang] = useState<L3>("en");
  const [paused, setPaused] = useState(false);
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (paused || still) return;
    const t = setInterval(() => setStep((x) => (x + 1) % STEPS.length), STEP_MS);
    return () => clearInterval(t);
  }, [paused, still]);
  const pick = (k: number) => { setStep(k); setPaused(true); };

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="flex items-center justify-between gap-3">
        <ol className="flex items-center gap-1 text-[11px] font-medium">
          {STEPS.map((l, k) => (
            <li key={l} className="flex items-center gap-1">
              <button onClick={() => pick(k)} className={cx("focus-ring rounded-full px-2.5 py-1 transition", k === step ? "bg-white text-brand-700" : "bg-white/10 text-white/75 hover:bg-white/20")}>{k + 1}. {l}</button>
              {k < STEPS.length - 1 && <span className="text-white/40">›</span>}
            </li>
          ))}
        </ol>
      </div>

      {/* The frame (blur, border, tint) never moves - only the content inside cross-fades. Animating a blurred,
          translucent card made the browser re-blur every frame and briefly stacked two tints, which read as jitter. */}
      <div className="relative mt-3 h-[236px] overflow-hidden rounded-2xl border border-white/15 bg-white/[0.12] backdrop-blur sm:h-[212px]">
        <AnimatePresence initial={false}>
          <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }} style={{ willChange: "transform, opacity" }}
            className="absolute inset-0 p-4">
            {step === 0 && (
              <>
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-rose-400 to-orange-500 text-xs font-semibold">KF</span>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">Kaveri Foods Pvt Ltd</div><div className="text-[11px] text-white/70">INV-2041 · due 12 Sep, in 5 days</div></div>
                  <div className="text-base font-semibold">₹4,85,100</div>
                </div>
                <div className="mt-4 rounded-xl bg-white/10 p-3">
                  <div className="flex items-center justify-between text-[13px]"><span className="font-semibold">AI prediction</span><span className="rounded-full bg-rose-500/25 px-2 py-0.5 text-[11px] font-medium text-rose-100">Likely 18 days late</span></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15"><motion.div className="h-full w-[78%] origin-left rounded-full bg-gradient-to-r from-amber-300 to-rose-400" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] }} /></div>
                  <div className="mt-2 text-[11px] text-white/75">Why? Paid their last 3 invoices ~24 days late · this bill is 2× their usual order</div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[12px]">
                  <span className="whitespace-nowrap rounded-md bg-white/10 px-2 py-0.5">Due 12 Sep</span><ArrowRight className="size-3.5 text-white/60" />
                  <span className="whitespace-nowrap rounded-md bg-rose-500/25 px-2 py-0.5 text-rose-100">Expected ~30 Sep</span>
                  <span className="hidden text-white/70 sm:inline">· worth a reminder now</span>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold">Reminder, written for you</span>
                  <span className="flex gap-0.5 rounded-lg bg-white/10 p-0.5 text-[11px]">
                    {(["en", "hi", "mr"] as L3[]).map((l) => (
                      <button key={l} onClick={() => { setLang(l); setPaused(true); }} className={cx("focus-ring rounded-md px-2 py-0.5", lang === l ? "bg-white text-brand-700" : "text-white/80")}>
                        {l === "en" ? "English" : l === "hi" ? "हिंदी" : "मराठी"}
                      </button>
                    ))}
                  </span>
                </div>
                <div className="mt-3 max-w-[92%] rounded-2xl rounded-tl-sm bg-[#1faa53]/90 p-3 text-[12.5px] leading-relaxed shadow-lg">
                  <p className="whitespace-pre-line">{MSG[lang]}</p>
                  <p className="mt-1.5 text-white/85 underline decoration-white/40">{PAY_LINE[lang]}: paypredict.app/pay/…</p>
                </div>
                <div className="mt-2 text-[11px] text-white/70">Sent in one tap on WhatsApp - before it slips, not after.</div>
              </>
            )}
            {step === 2 && (
              <div className="flex h-full items-center gap-4">
                <div className="flex-1">
                  <div className="text-[11px] text-white/70">Customer taps the link</div>
                  <div className="mt-1 text-sm">Payment request from <strong>Sahyadri Packaging</strong></div>
                  <div className="mt-1 text-2xl font-semibold">₹4,85,100</div>
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-brand-700">Pay with UPI <ArrowRight className="size-3.5" /></div>
                  <div className="mt-2 text-[11px] text-white/70">GPay · PhonePe · Paytm · straight to your bank, no fees</div>
                </div>
                <QrGlyph />
              </div>
            )}
            {step === 3 && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15, type: "spring", damping: 18, stiffness: 220 }}
                  className="grid size-12 place-items-center rounded-full bg-emerald-400 text-emerald-950"><Check className="size-7" /></motion.span>
                <div className="mt-3 text-base font-semibold">Paid ₹4,85,100 on 14 Sep</div>
                <div className="mt-1 text-[12px] text-white/80">16 days sooner than the AI predicted · ₹2,977 overdraft interest saved</div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ form bits
function Field({ label, children, hint, error }: { label: string; children: React.ReactNode; hint?: React.ReactNode; error?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium ink">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-600 dark:text-rose-400">{error}</span> : hint && <span className="mt-1 block text-xs ink-3">{hint}</span>}
    </label>
  );
}
const inputCls = (bad?: boolean) => cx("focus-ring h-11 w-full rounded-xl border bg-[var(--surface)] px-3.5 text-sm ink placeholder:text-[var(--ink-3)] transition-shadow",
  bad ? "border-rose-400" : "line");

function strength(pw: string) {
  const score = [pw.length >= 8, pw.length >= 12, /[a-z]/.test(pw) && /[A-Z]/.test(pw), /\d/.test(pw), /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length;
  return [
    { label: "Too short", cls: "bg-rose-500", w: "20%" }, { label: "Weak", cls: "bg-rose-500", w: "30%" }, { label: "Okay", cls: "bg-amber-500", w: "55%" },
    { label: "Good", cls: "bg-emerald-500", w: "75%" }, { label: "Strong", cls: "bg-emerald-600", w: "90%" }, { label: "Very strong", cls: "bg-emerald-600", w: "100%" },
  ][pw.length < 8 ? 0 : score];
}

function PasswordInput({ value, onChange, mode }: { value: string; onChange: (v: string) => void; mode: Mode }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const s = strength(value);
  return (
    <Field label="Password" hint={mode === "signup" ? "At least 8 characters" : undefined}>
      <div className="relative">
        <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} required minLength={mode === "signup" ? 8 : undefined}
          autoComplete={mode === "login" ? "current-password" : "new-password"} className={cx(inputCls(), "pr-11")}
          onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock"))} onBlur={() => setCaps(false)} />
        <button type="button" onClick={() => setShow((x) => !x)} aria-label={show ? "Hide password" : "Show password"}
          className="focus-ring absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg ink-3 hover:bg-[var(--surface-2)]">
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {caps && <span className="mt-1 flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="size-3" />Caps Lock is on</span>}
      {mode === "signup" && value && (
        <span className="mt-2 flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full surface-2"><span className={cx("block h-full rounded-full transition-all", s.cls)} style={{ width: s.w }} /></span>
          <span className="w-20 text-right text-xs ink-3">{s.label}</span>
        </span>
      )}
    </Field>
  );
}

// ------------------------------------------------------------------ page
export function AuthPage({ mode: initial }: { mode: Mode }) {
  const nav = useNavigate();
  const { login, signup, demo } = useAuthActions();
  const { dark, toggle } = useTheme();
  const [mode, setMode] = useState<Mode>(initial);
  const [showForm, setShowForm] = useState(initial === "signup");   // most visitors want the demo; the form waits until asked
  const [f, setF] = useState({ name: "", business_name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const serverReady = useRef(false);
  usePageTitle(mode === "login" ? "Log in" : "Create account");

  // Free hosting sleeps when idle: wake the server while the visitor reads the page.
  useEffect(() => {
    fetch("/api/health").then(() => { serverReady.current = true; }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!demoBusy) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [demoBusy]);

  const switchMode = (m: Mode) => { setMode(m); setShowForm(true); setErr(""); setTouched(false); nav(m === "login" ? "/login" : "/signup", { replace: true }); };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const emailBad = touched && !!f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true); setErr("");
    if (emailBad) return;
    setBusy(true);
    try {
      const r = mode === "login" ? await login(f.email, f.password) : await signup(f);
      nav(r.org.onboarded ? "/" : "/welcome");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function tryDemo() {
    setErr(""); setDemoBusy(true);
    try { await demo(); nav("/"); } catch (e: any) { setErr(e.message); setDemoBusy(false); }
  }
  const demoStatus = elapsed < 4 ? "Opening the demo…"
    : !serverReady.current ? `Waking up the server (free hosting), about 30 seconds… ${elapsed}s`
    : "Loading your sample business…";

  return (
    <div className="grid min-h-full lg:grid-cols-[1.08fr_1fr]">
      {/* ---------- story panel: below the form on phones, left on desktop ---------- */}
      <section className="relative order-2 overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-violet-700 px-6 py-12 text-white sm:px-12 lg:order-1 lg:flex lg:flex-col lg:py-10">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-violet-400/25 blur-3xl" />
        <div className="relative hidden items-center gap-2.5 lg:flex">
          <img src="/favicon.svg" alt="" className="size-8 rounded-lg ring-2 ring-white/20" /><span className="text-lg font-semibold tracking-tight">PayPredict</span>
        </div>
        <div className="relative mx-auto w-full max-w-lg lg:my-auto lg:py-6 2xl:max-w-xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium"><Sparkles className="size-3.5" />AI credit manager for Indian MSMEs</span>
          <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-[38px] sm:leading-[1.1] lg:text-[34px] xl:text-[40px] 2xl:text-[46px]">Know which customers will pay late. Get paid before it hurts.</h2>
          <p className="mt-3 text-base text-white/80 xl:text-lg">PayPredict learns how each customer really pays, tells you who to chase today, and writes the message for you.</p>
          <div className="mt-6 xl:mt-8"><LivePreview /></div>
          <dl className="mt-5 grid grid-cols-3 gap-3 xl:mt-7">
            {[["2×", "more accurate payment dates than trusting due dates*"], ["1 tap", "WhatsApp reminder with a UPI pay link"], ["3", "languages: English, हिंदी, मराठी"]].map(([v, l]) => (
              <div key={l} className="rounded-xl bg-white/10 p-3"><dt className="text-xl font-semibold num sm:text-2xl">{v}</dt><dd className="mt-0.5 text-[11px] leading-snug text-white/75">{l}</dd></div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] text-white/55">*Typical error ±9 days vs ±21 days, back-tested on 12,000 sample invoices from a fictional business.</p>
        </div>
        <p className="relative mt-8 text-center text-xs text-white/55 lg:mt-0 lg:text-left">Built for IES MCRC Hackathon 4.0 · FinTech AI</p>
      </section>

      {/* ---------- sign-in panel ---------- */}
      <section className="order-1 flex flex-col px-5 py-6 sm:px-10 lg:order-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 lg:invisible"><img src="/favicon.svg" alt="" className="size-8" /><span className="text-[17px] font-semibold tracking-tight ink">PayPredict</span></div>
          <button onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} className="focus-ring grid size-9 place-items-center rounded-lg ink-2 hover:bg-[var(--surface-2)]">
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-8">
          <span className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 lg:hidden dark:bg-brand-500/15 dark:text-brand-200">
            <Sparkles className="size-3.5" />AI credit manager for Indian MSMEs
          </span>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight ink">{mode === "login" ? "Welcome to PayPredict" : "Get paid faster, starting today"}</h1>
          <p className="mt-1.5 ink-2">{mode === "login"
            ? "Find out which customers will pay late, and what to do about each one. See it on a sample business first."
            : "Free account. Upload your Tally or Excel ledger, or explore with sample data."}</p>

          {/* Primary action: the demo */}
          <button onClick={tryDemo} disabled={demoBusy} aria-busy={demoBusy}
            className="focus-ring group relative mt-7 flex w-full items-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-violet-600 p-5 text-left text-white shadow-lg shadow-brand-600/25 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand-600/30 disabled:cursor-wait">
            {demoBusy && <motion.span className="absolute inset-y-0 left-0 bg-white/15" initial={{ width: "0%" }} animate={{ width: "92%" }} transition={{ duration: serverReady.current ? 12 : 40, ease: "easeOut" }} />}
            <span className="relative grid size-12 shrink-0 place-items-center rounded-xl bg-white/20">
              {demoBusy ? <span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Sparkles className="size-5" />}
            </span>
            <span className="relative flex-1">
              <span className="block text-lg font-semibold">{demoBusy ? demoStatus : "Try the live demo"}</span>
              <span className="block text-[13px] text-white/85">{demoBusy ? "Hang tight, it's worth it" : "Opens in seconds · no signup · a sample Pune business with 220 customers"}</span>
            </span>
            {!demoBusy && <ArrowRight className="relative size-5 transition group-hover:translate-x-1" />}
          </button>

          {!showForm && err && <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{err}</p>}

          <div className="my-6 flex items-center gap-3 text-xs ink-3"><span className="h-px flex-1 bg-[var(--line)]" />or use your own data<span className="h-px flex-1 bg-[var(--line)]" /></div>

          {!showForm ? (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => switchMode("login")} className="focus-ring h-11 rounded-xl border line text-sm font-medium ink transition hover:bg-[var(--surface-2)]">Log in</button>
              <button onClick={() => switchMode("signup")} className="focus-ring h-11 rounded-xl bg-[var(--ink)] text-sm font-medium text-[var(--bg)] transition hover:opacity-90">Create free account</button>
            </div>
          ) : (<>
          <div className="flex justify-center">
            <Segmented value={mode} onChange={switchMode} options={[{ value: "login", label: "Log in" }, { value: "signup", label: "Create account" }]} />
          </div>

          <form onSubmit={submit} noValidate className="mt-5 space-y-4">
            <AnimatePresence initial={false}>
              {mode === "signup" && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-4 overflow-hidden">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Your name"><input value={f.name} onChange={set("name")} required autoComplete="name" className={inputCls(touched && !f.name)} /></Field>
                    <Field label="Business name"><input value={f.business_name} onChange={set("business_name")} required placeholder="e.g. Sahyadri Packaging" autoComplete="organization" className={inputCls(touched && !f.business_name)} /></Field>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <Field label="Email" error={emailBad ? "That email doesn't look right." : undefined}>
              <input type="email" value={f.email} onChange={set("email")} onBlur={() => f.email && setTouched(true)} required autoComplete="email" inputMode="email" placeholder="you@business.in" className={inputCls(emailBad)} />
            </Field>
            <PasswordInput value={f.password} onChange={(v) => setF({ ...f, password: v })} mode={mode} />
            <AnimatePresence>
              {err && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert"
                  className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />{err}
                </motion.p>
              )}
            </AnimatePresence>
            <button type="submit" disabled={busy}
              className="focus-ring inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--ink)] text-[15px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-60">
              {busy && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
              {mode === "login" ? "Log in" : "Create free account"}
            </button>
          </form>
          </>)}

          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs ink-2">
            {[[<ShieldCheck key="s" className="size-3.5 text-emerald-600" />, "Your data stays private"], [<Check key="c" className="size-3.5 text-emerald-600" />, "Free, no card needed"], [<Languages key="l" className="size-3.5 text-emerald-600" />, "English · हिंदी · मराठी"]].map(([icon, t]) => (
              <li key={t as string} className="flex items-center gap-1.5 whitespace-nowrap">{icon}{t}</li>
            ))}
          </ul>
        </motion.div>
      </section>
    </div>
  );
}
