import { useQueryClient } from "@tanstack/react-query";
import { Compass, KeyRound, LogOut, Trash2, Upload } from "lucide-react";
import { useTour } from "../lib/tour";
import { usePageTitle } from "../lib/theme";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, Card, Input, Modal, Segmented, Term, Toggle } from "../components/ui";
import { api, type Lang, type Org } from "../lib/api";
import { useAuthActions, useMe } from "../lib/auth";
import { LANGS } from "../lib/i18n";

function Slider({ label, hint, value, min, max, step, fmt, onChange }: { label: React.ReactNode; hint: React.ReactNode; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm"><span className="font-medium ink">{label}</span><span className="font-semibold num text-brand-600">{fmt(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[#4f46e5]" />
      <p className="text-xs ink-2">{hint}</p>
    </div>
  );
}

export function Settings() {
  usePageTitle("Settings");
  const { start } = useTour();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { logout } = useAuthActions();
  const [o, setO] = useState<Org | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { if (me) setO(me.org); }, [me]);
  if (!o || !me) return null;
  const set = <K extends keyof Org>(k: K, v: Org[K]) => setO({ ...o, [k]: v });

  async function save() {
    setSaving(true);
    try {
      const { name, sender_name, udyam_registered, cost_of_capital, treds_rate, early_pay_discount, relationship_first, language,
        upi_id, udyam_number, gstin, address, contact_phone, bank_rate } = o!;
      await api("/org", { method: "PATCH", json: { name, sender_name, udyam_registered, cost_of_capital, treds_rate, early_pay_discount,
        relationship_first, language, upi_id, udyam_number, gstin, address, contact_phone, bank_rate } });
      await qc.invalidateQueries();
      toast.success("Settings saved - recommendations updated");
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  }
  async function reset() {
    try {
      await api("/reset", { method: "POST" });
      await qc.invalidateQueries();
      nav("/welcome");
    } catch (e: any) { toast.error(e.message); setConfirmReset(false); }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight ink sm:text-3xl">Settings</h1>

      <Card className="mt-6 space-y-4 p-5 sm:p-6">
        <h2 className="font-semibold ink">Your business</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Business name" value={o.name} onChange={(e) => set("name", e.target.value)} />
          <Input label="Sign messages as" value={o.sender_name} onChange={(e) => set("sender_name", e.target.value)} />
        </div>
        <Toggle checked={o.udyam_registered} onChange={(v) => set("udyam_registered", v)} label={<>We are <Term k="Udyam">Udyam</Term>-registered (micro / small)</>}
          hint="Unlocks the 45-day legal protection and interest claims under the MSMED Act." />
        <div>
          <span className="mb-1.5 block text-sm font-medium ink">Default message language</span>
          <Segmented value={o.language} onChange={(v: Lang) => set("language", v)} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
        </div>
      </Card>

      <Card className="mt-4 space-y-4 p-5 sm:p-6" data-tour="settings-pay">
        <div><h2 className="font-semibold ink">Getting paid & legal details</h2>
          <p className="text-sm ink-2">Your UPI ID adds a one-tap payment link to every reminder. The rest appears on legal notices.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="UPI ID" placeholder="yourbusiness@okhdfcbank" value={o.upi_id} onChange={(e) => set("upi_id", e.target.value)}
            hint="Money goes straight to your bank - no gateway fees." />
          <Input label="Udyam registration number" placeholder="UDYAM-MH-26-0012345" value={o.udyam_number} onChange={(e) => set("udyam_number", e.target.value)} />
          <Input label="GSTIN" placeholder="27ABCDE1234F1Z5" value={o.gstin} onChange={(e) => set("gstin", e.target.value)} />
          <Input label="Phone on notices" value={o.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} />
        </div>
        <Input label="Business address" value={o.address} onChange={(e) => set("address", e.target.value)} />
        <Slider label="RBI Bank Rate" hint={<>Buyers owe 3× this rate, compounded monthly, on payments beyond 45 days (<Term k="MSMED" />). Check the current rate on rbi.org.in.</>}
          value={o.bank_rate} min={0.03} max={0.1} step={0.0025} fmt={(v) => `${(v * 100).toFixed(2)}% → ${(v * 300).toFixed(2)}% interest`} onChange={(v) => set("bank_rate", v)} />
        <div className="flex justify-end"><Button variant="primary" loading={saving} onClick={save}>Save changes</Button></div>
      </Card>

      <Card className="mt-4 space-y-6 p-5 sm:p-6">
        <div><h2 className="font-semibold ink">Money assumptions</h2><p className="text-sm ink-2">Used to decide which action is cheapest for you. Change them and every recommendation updates.</p></div>
        <Slider label="Your overdraft / cash-credit interest rate" hint="What it costs you to wait for money." value={o.cost_of_capital} min={0.08} max={0.24} step={0.005} fmt={(v) => `${(v * 100).toFixed(1)}% a year`} onChange={(v) => set("cost_of_capital", v)} />
        <Slider label={<><Term k="TReDS" /> discount rate</>} hint="What financiers typically charge to pay you early for a good buyer's invoice." value={o.treds_rate} min={0.06} max={0.16} step={0.0025} fmt={(v) => `${(v * 100).toFixed(2)}% a year`} onChange={(v) => set("treds_rate", v)} />
        <Slider label="Early-payment discount you're willing to offer" hint="Offered only when it's cheaper than waiting." value={o.early_pay_discount} min={0.005} max={0.03} step={0.0025} fmt={(v) => `${(v * 100).toFixed(1)}%`} onChange={(v) => set("early_pay_discount", v)} />
        <Toggle checked={o.relationship_first} onChange={(v) => set("relationship_first", v)} label="Relationship-first mode"
          hint="For important private customers, prefer a friendly discount offer over legal language." />
        <div className="flex justify-end"><Button variant="primary" loading={saving} onClick={save}>Save changes</Button></div>
      </Card>

      <Card className="mt-4 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="flex-1"><h2 className="font-semibold ink">Help</h2><p className="text-sm ink-2">Replay the guided tour of every feature - takes about 2 minutes.</p></div>
        <Button icon={<Compass className="size-4" />} onClick={() => start(0)}>Restart guided tour</Button>
      </Card>

      <Card className="mt-4 space-y-4 p-5 sm:p-6">
        <h2 className="font-semibold ink">Data</h2>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Upload className="size-4" />} onClick={() => nav("/welcome")}>Upload a new ledger</Button>
          <Button variant="ghost" icon={<Trash2 className="size-4" />} className="text-rose-600" onClick={() => setConfirmReset(true)}>Delete all my data</Button>
        </div>
        <p className="text-xs ink-3">Uploading again adds new invoices and updates existing ones (matched by customer + invoice number). Your data is private to your account.</p>
      </Card>

      <Card className="mt-4 flex items-start gap-3 p-5 sm:p-6">
        <KeyRound className="mt-0.5 size-5 text-violet-500" />
        <div className="text-sm">
          <div className="font-medium ink">AI assistant: {me.assistant_enabled ? <span className="text-emerald-600">connected</span> : <span className="text-amber-600">not configured</span>}</div>
          <p className="ink-2">Powered by Claude. Set <code className="rounded bg-[var(--surface-2)] px-1">ANTHROPIC_API_KEY</code> on the server to enable it.</p>
        </div>
      </Card>

      <div className="mt-6 lg:hidden"><Button variant="ghost" icon={<LogOut className="size-4" />} onClick={logout}>Log out</Button></div>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Delete all data?">
        <p className="text-sm ink-2">This permanently removes every invoice, customer and action for {o.name}. Your login stays. This can't be undone.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
          <Button variant="danger" onClick={reset}>Delete everything</Button>
        </div>
      </Modal>
    </div>
  );
}
