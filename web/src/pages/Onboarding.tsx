import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Download, FileSpreadsheet, Sparkles, Store, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../components/Layout";
import { Badge, Button, Card } from "../components/ui";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { cx, inrShort } from "../lib/format";

type Preview = {
  columns: string[]; mapping: Record<string, string>; rows: number; sample: Record<string, string>[];
  fields: { key: string; label: string; required: boolean }[];
  preview: { rows: number; customers: number; paid: number; open: number; total_open: number } | null; issues: string[];
};
const TRAIN_STEPS = ["Reading your invoices", "Learning each customer's payment habits", "Testing accuracy on past invoices", "Planning today's actions"];

function Training({ done }: { done: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, TRAIN_STEPS.length - 1)), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="relative mx-auto size-20">
        <div className="absolute inset-0 animate-ping rounded-full bg-brand-400/30" />
        <div className="relative grid size-20 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-violet-600 text-white"><Sparkles className="size-8" /></div>
      </div>
      <h2 className="mt-6 text-2xl font-semibold ink">Training your AI…</h2>
      <p className="mt-1 ink-2">This takes a few seconds.</p>
      <div className="mt-8 space-y-3 text-left">
        {TRAIN_STEPS.map((s, i) => {
          const complete = done || i < step;
          return (
            <motion.div key={s} initial={{ opacity: 0, x: -8 }} animate={{ opacity: i <= step || done ? 1 : 0.35, x: 0 }} transition={{ delay: i * 0.1 }}
              className="flex items-center gap-3 rounded-xl border line bg-[var(--surface)] px-4 py-3 text-sm">
              {complete ? <CheckCircle2 className="size-5 text-emerald-500" /> : i === step ? <span className="size-5 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" /> : <span className="size-5 rounded-full border-2 line" />}
              <span className="ink">{s}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export function Onboarding() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [stage, setStage] = useState<"choose" | "upload" | "map" | "training">("choose");
  const [file, setFile] = useState<File | null>(null);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [finished, setFinished] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  async function finish(p: Promise<any>) {
    setStage("training"); setErr("");
    const started = Date.now();
    try {
      await p;
      await new Promise((r) => setTimeout(r, Math.max(0, 4200 - (Date.now() - started))));   // let the steps read
      setFinished(true);
      await qc.invalidateQueries();
      setTimeout(() => nav("/"), 700);
    } catch (e: any) {
      setErr(e.message); setStage(file ? "map" : "choose");
    }
  }

  async function pick(f: File) {
    setFile(f); setErr("");
    const fd = new FormData(); fd.append("file", f);
    try {
      const p = await api<Preview>("/import/preview", { method: "POST", body: fd });
      setPrev(p); setMapping(p.mapping); setStage("map");
    } catch (e: any) { setErr(e.message); }
  }

  function commit() {
    const fd = new FormData(); fd.append("file", file!); fd.append("mapping", JSON.stringify(mapping));
    finish(api("/import/commit", { method: "POST", body: fd }));
  }

  const missing = prev?.fields.filter((f) => f.required && !mapping[f.key]) ?? [];

  return (
    <div className="min-h-full px-4 py-6 sm:px-8">
      <Logo />
      <div className="mx-auto mt-8 max-w-3xl">
        <AnimatePresence mode="wait">
          {stage === "choose" && (
            <motion.div key="choose" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <Badge tone="brand">Step 1 of 2</Badge>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight ink">Welcome{me ? `, ${me.user.name.split(" ")[0]}` : ""}! Let's set up {me?.org.name ?? "your business"}.</h1>
              <p className="mt-2 ink-2">PayPredict learns from your past invoices and payments. How would you like to start?</p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <button onClick={() => setStage("upload")} className="focus-ring card group p-6 text-left transition hover:-translate-y-0.5 hover:border-brand-300">
                  <span className="grid size-12 place-items-center rounded-2xl bg-brand-600 text-white"><FileSpreadsheet className="size-6" /></span>
                  <h3 className="mt-4 text-lg font-semibold ink">Upload my ledger</h3>
                  <p className="mt-1 text-sm ink-2">Excel or CSV export from Tally, Zoho Books, Busy, Vyapar - or your own sheet.</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600">Recommended <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></span>
                </button>
                <button onClick={() => finish(api("/import/sample", { method: "POST" }))} className="focus-ring card group p-6 text-left transition hover:-translate-y-0.5 hover:border-brand-300">
                  <span className="grid size-12 place-items-center rounded-2xl bg-violet-600 text-white"><Store className="size-6" /></span>
                  <h3 className="mt-4 text-lg font-semibold ink">Explore with a sample business</h3>
                  <p className="mt-1 text-sm ink-2">A fictional Pune packaging company with 3 years of invoices from 220 customers. Switch to your data anytime.</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-600">Try the demo <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></span>
                </button>
              </div>
              {err && <p className="mt-4 text-sm text-rose-600">{err}</p>}
            </motion.div>
          )}

          {stage === "upload" && (
            <motion.div key="upload" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <button onClick={() => setStage("choose")} className="focus-ring inline-flex items-center gap-1 text-sm ink-2 hover:ink"><ArrowLeft className="size-4" />Back</button>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight ink">Upload your invoice list</h1>
              <p className="mt-2 ink-2">Include paid invoices with their payment dates - that's how the AI learns each customer's habits. 12+ months is ideal.</p>
              <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) pick(f); }}
                onClick={() => input.current?.click()}
                className={cx("mt-8 flex cursor-pointer flex-col items-center rounded-3xl border-2 border-dashed px-6 py-14 text-center transition",
                  drag ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "line bg-[var(--surface)] hover:border-brand-300")}>
                <UploadCloud className="size-10 text-brand-500" />
                <div className="mt-3 font-medium ink">Drop your file here, or click to browse</div>
                <div className="mt-1 text-sm ink-3">.xlsx, .xls or .csv · up to 15 MB</div>
                <input ref={input} type="file" accept=".csv,.xlsx,.xls,.xlsm" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
              </div>
              {err && <p className="mt-4 text-sm text-rose-600">{err}</p>}
              <Card className="mt-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
                <div className="flex-1 text-sm ink-2"><span className="font-medium ink">Tally users:</span> Display → Statements of Accounts → Outstandings → Receivables (with bill-wise details), then Export → Excel. Any column names work - we'll match them.</div>
                <a href="/api/import/template.csv"><Button icon={<Download className="size-4" />}>Template</Button></a>
              </Card>
            </motion.div>
          )}

          {stage === "map" && prev && (
            <motion.div key="map" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <button onClick={() => setStage("upload")} className="focus-ring inline-flex items-center gap-1 text-sm ink-2 hover:ink"><ArrowLeft className="size-4" />Choose another file</button>
              <Badge tone="brand" className="mt-4">Step 2 of 2</Badge>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight ink">Check the columns</h1>
              <p className="mt-2 ink-2">We matched your columns automatically. Fix anything that looks wrong.</p>
              {prev.preview && (
                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[["Invoices", prev.preview.rows], ["Customers", prev.preview.customers], ["Paid (with dates)", prev.preview.paid], ["Unpaid", `${prev.preview.open} · ${inrShort(prev.preview.total_open)}`]].map(([l, v]) => (
                    <Card key={l as string} className="p-4"><div className="text-xs ink-3">{l}</div><div className="mt-1 text-xl font-semibold num ink">{v}</div></Card>
                  ))}
                </div>
              )}
              <Card className="mt-4 divide-y line">
                {prev.fields.map((f) => (
                  <div key={f.key} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                    <div className="flex flex-1 items-center gap-2 text-sm">
                      {mapping[f.key] ? <Check className="size-4 text-emerald-500" /> : <span className={cx("size-4 rounded-full border-2", f.required ? "border-rose-400" : "line")} />}
                      <span className="font-medium ink">{f.label}</span>{f.required && <span className="text-xs ink-3">required</span>}
                    </div>
                    <select value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                      className="focus-ring h-10 rounded-xl border line bg-[var(--surface)] px-3 text-sm ink sm:w-64">
                      <option value="">- not in my file -</option>
                      {prev.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </Card>
              {prev.issues.map((i) => <p key={i} className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{i}</p>)}
              {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}
              <div className="mt-6 flex justify-end">
                <Button variant="primary" size="lg" disabled={missing.length > 0} onClick={commit} icon={<Sparkles className="size-4" />}>Import & train my AI</Button>
              </div>
            </motion.div>
          )}

          {stage === "training" && <motion.div key="training" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Training done={finished} /></motion.div>}
        </AnimatePresence>
      </div>
    </div>
  );
}
