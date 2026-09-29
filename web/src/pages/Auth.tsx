import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, Check, Eye, EyeOff, Languages, Moon, Scale, ShieldCheck, Sparkles, Sun, Target, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Segmented } from "../components/ui";
import { useAuthActions } from "../lib/auth";
import { cx } from "../lib/format";
import { useTheme, usePageTitle } from "../lib/theme";

type Mode = "login" | "signup";

// ------------------------------------------------------------------ live product preview (left panel)
const EXAMPLES = [
  { name: "Kaveri Foods Pvt Ltd", initials: "KF", amt: "₹4,85,100", chip: "Likely 18 days late", chipCls: "bg-rose-500/20 text-rose-100",
    icon: <Scale className="size-3.5" />, action: "Remind them of the 45-day payment law", why: "Paid their last 3 invoices ~24 days late", hue: 350 },
  { name: "Deccan Electricals Ltd", initials: "DE", amt: "₹2,53,200", chip: "Might be late · 41%", chipCls: "bg-amber-400/20 text-amber-100",
    icon: <Zap className="size-3.5" />, action: "Offer 1% off for paying this week", why: "Cheaper than 21 days of overdraft interest", hue: 260 },
  { name: "Narmada Infra Projects", initials: "NI", amt: "₹3,12,500", chip: "Get cash today", chipCls: "bg-sky-400/20 text-sky-100",
    icon: <Target className="size-3.5" />, action: "Sell this invoice on TReDS", why: "Buyer is registered; saves ₹2,140 vs waiting", hue: 200 },
];

function LivePreview() {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % EXAMPLES.length), 3800); return () => clearInterval(t); }, []);
  const e = EXAMPLES[i];
  return (
    <div className="relative" aria-hidden="true">
      <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
        <div className="text-xs font-medium text-white/70">Next 4 weeks</div>
        <div className="mt-1 text-[15px] leading-snug">You'll likely collect <strong>₹1.94 Cr</strong>, that's <strong className="underline decoration-white/40 underline-offset-2">₹1.31 Cr less</strong> than your due dates suggest.</div>
        <svg viewBox="0 0 200 36" className="mt-3 h-9 w-full"><path d="M0 34 C40 30 70 22 110 17 S170 8 200 5" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="2" strokeDasharray="4 4" />
          <path d="M0 34 C40 33 80 29 120 24 S175 17 200 14" fill="none" stroke="#fff" strokeWidth="2.5" /></svg>
      </div>
      <div className="relative mt-3 h-[150px]">
        <AnimatePresence mode="popLayout">
          <motion.div key={i} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ type: "spring", damping: 26, stiffness: 260 }}
            className="absolute inset-x-0 rounded-2xl border border-white/15 bg-white/[0.13] p-4 backdrop-blur">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl text-xs font-semibold" style={{ background: `linear-gradient(135deg, hsl(${e.hue} 70% 60%), hsl(${e.hue + 40} 70% 45%))` }}>{e.initials}</span>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{e.name}</div><span className={cx("mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium", e.chipCls)}>{e.chip}</span></div>
              <div className="text-sm font-semibold">{e.amt}</div>
            </div>
            <div className="mt-3 rounded-xl bg-white/10 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold">{e.icon}{e.action}</div>
              <div className="text-[11px] text-white/70">Why? {e.why}</div>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#1faa53] px-2.5 py-1 text-[11px] font-medium">Send on WhatsApp</span>
              <span className="text-[11px] text-white/60">with a UPI pay link</span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="mt-2 flex justify-center gap-1.5">
        {EXAMPLES.map((_, k) => <span key={k} className={cx("h-1.5 rounded-full transition-all", k === i ? "w-5 bg-white" : "w-1.5 bg-white/40")} />)}
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

  const switchMode = (m: Mode) => { setMode(m); setErr(""); setTouched(false); nav(m === "login" ? "/login" : "/signup", { replace: true }); };
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
        <div className="relative mx-auto w-full max-w-lg lg:my-auto lg:py-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium"><Sparkles className="size-3.5" />AI credit manager for Indian MSMEs</span>
          <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-[38px] sm:leading-[1.1] lg:text-[34px] xl:text-[40px]">Know which customers will pay late. Get paid before it hurts.</h2>
          <p className="mt-3 text-base text-white/80 xl:text-lg">PayPredict learns how each customer really pays, tells you who to chase today, and writes the message for you.</p>
          <div className="mt-6 xl:mt-8"><LivePreview /></div>
          <dl className="mt-5 grid grid-cols-3 gap-3 xl:mt-7">
            {[["±9 days", "payment-date error (±21 if you trust due dates)*"], ["1 tap", "WhatsApp message with UPI pay link"], ["3", "languages: English, हिंदी, मराठी"]].map(([v, l]) => (
              <div key={l} className="rounded-xl bg-white/10 p-3"><dt className="text-xl font-semibold num sm:text-2xl">{v}</dt><dd className="mt-0.5 text-[11px] leading-snug text-white/75">{l}</dd></div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] text-white/55">*Back-tested on 12,000 sample invoices from a fictional business.</p>
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
            ? "Find out which customers will pay late, and what to do about each one. Try it now, or log in."
            : "Free account. Upload your Tally or Excel ledger, or explore with sample data."}</p>

          {/* Primary action: the demo */}
          <button onClick={tryDemo} disabled={demoBusy} aria-busy={demoBusy}
            className="focus-ring group relative mt-7 flex w-full items-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-violet-600 p-4 text-left text-white shadow-lg shadow-brand-600/25 transition hover:shadow-xl hover:shadow-brand-600/30 disabled:cursor-wait">
            {demoBusy && <motion.span className="absolute inset-y-0 left-0 bg-white/15" initial={{ width: "0%" }} animate={{ width: "92%" }} transition={{ duration: serverReady.current ? 12 : 40, ease: "easeOut" }} />}
            <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-white/20">
              {demoBusy ? <span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Sparkles className="size-5" />}
            </span>
            <span className="relative flex-1">
              <span className="block text-[15px] font-semibold">{demoBusy ? demoStatus : "Try the live demo"}</span>
              <span className="block text-xs text-white/80">{demoBusy ? "Hang tight, it's worth it" : "No signup · a sample Pune business with 220 customers"}</span>
            </span>
            {!demoBusy && <ArrowRight className="relative size-5 transition group-hover:translate-x-1" />}
          </button>

          <div className="my-6 flex items-center gap-3 text-xs ink-3"><span className="h-px flex-1 bg-[var(--line)]" />or with your own account<span className="h-px flex-1 bg-[var(--line)]" /></div>

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
