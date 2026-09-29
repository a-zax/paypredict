import { motion } from "motion/react";
import { ArrowRight, BellRing, LineChart, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Logo } from "../components/Layout";
import { Button, Input } from "../components/ui";
import { useAuthActions } from "../lib/auth";

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const nav = useNavigate();
  const { login, signup, demo } = useAuthActions();
  const [demoBusy, setDemoBusy] = useState(false);
  const [f, setF] = useState({ name: "", business_name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = mode === "login" ? await login(f.email, f.password) : await signup(f);
      nav(r.org.onboarded ? "/" : "/welcome");
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  }

  async function tryDemo() {
    setErr(""); setDemoBusy(true);
    try { await demo(); nav("/"); } catch (e: any) { setErr(e.message); } finally { setDemoBusy(false); }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-3xl font-semibold tracking-tight ink">{mode === "login" ? "Welcome back" : "Get paid faster"}</h1>
            <p className="mt-2 ink-2">{mode === "login" ? "Log in to see today's collection plan." : "Create your free account. Takes 30 seconds."}</p>
            <button onClick={tryDemo} disabled={demoBusy}
              className="focus-ring group mt-8 flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/60 p-4 text-left transition hover:border-brand-500 hover:bg-brand-50 disabled:opacity-70 dark:border-brand-500/40 dark:bg-brand-500/10">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
                {demoBusy ? <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Sparkles className="size-5" />}
              </span>
              <span className="flex-1">
                <span className="block font-semibold ink">{demoBusy ? "Opening the demo…" : "Try the live demo"}</span>
                <span className="block text-xs ink-2">{demoBusy ? "Loading 3 years of sample invoices (first time takes ~20s)" : "No signup · a sample Pune business with 220 customers"}</span>
              </span>
              <ArrowRight className="size-4 text-brand-600 transition group-hover:translate-x-0.5" />
            </button>
            <div className="my-6 flex items-center gap-3 text-xs ink-3"><span className="h-px flex-1 bg-[var(--line)]" />or use your own account<span className="h-px flex-1 bg-[var(--line)]" /></div>
            <form onSubmit={submit} className="space-y-4">
              {mode === "signup" && (
                <>
                  <Input label="Your name" value={f.name} onChange={set("name")} required autoComplete="name" />
                  <Input label="Business name" value={f.business_name} onChange={set("business_name")} required placeholder="e.g. Sahyadri Packaging" />
                </>
              )}
              <Input label="Email" type="email" value={f.email} onChange={set("email")} required autoComplete="email" />
              <Input label="Password" type="password" value={f.password} onChange={set("password")} required minLength={mode === "signup" ? 8 : undefined}
                autoComplete={mode === "login" ? "current-password" : "new-password"} hint={mode === "signup" ? "At least 8 characters" : undefined} />
              {err && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{err}</p>}
              <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>{mode === "login" ? "Log in" : "Create account"}</Button>
            </form>
            <p className="mt-6 text-center text-sm ink-2">
              {mode === "login" ? <>New here? <Link className="font-medium text-brand-600" to="/signup">Create an account</Link></>
                : <>Already have an account? <Link className="font-medium text-brand-600" to="/login">Log in</Link></>}
            </p>
          </motion.div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-violet-700 p-12 text-white lg:flex lg:flex-col lg:justify-center">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-violet-400/20 blur-3xl" />
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Know which invoices won't be paid on time - before it hurts.</h2>
          <p className="mt-4 text-lg text-white/80">PayPredict learns how each of your customers pays, and tells you exactly who to chase today and what to say.</p>
          <div className="mt-10 space-y-5">
            {[
              [<LineChart key="a" className="size-5" />, "Predicts the real payment date", "Not the due date - the date the money will actually arrive."],
              [<BellRing key="b" className="size-5" />, "Tells you what to do", "Reminder, discount, 45-day legal notice or TReDS - the cheapest move that works."],
              [<Sparkles key="c" className="size-5" />, "Writes the message", "In English, हिंदी or मराठी. One tap to send on WhatsApp."],
              [<ShieldCheck key="d" className="size-5" />, "Your data stays yours", "Private to your business. Delete anytime."],
            ].map(([icon, t, s]) => (
              <div key={t as string} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15">{icon}</span>
                <div><div className="font-medium">{t}</div><div className="text-sm text-white/70">{s}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
