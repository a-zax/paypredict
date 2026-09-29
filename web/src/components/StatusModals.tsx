import { useState } from "react";
import { inr } from "../lib/format";
import { Button, Input, Modal } from "./ui";

const iso = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export function PromiseModal({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (d: string) => Promise<void> }) {
  const [when, setWhen] = useState(iso(7));
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="When did they promise to pay?">
      <p className="text-sm ink-2">We'll hold off on reminders until then, and bring it back to your Today list if the date slips.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {[3, 7, 15].map((n) => <Button key={n} size="sm" variant={when === iso(n) ? "primary" : "secondary"} onClick={() => setWhen(iso(n))}>In {n} days</Button>)}
      </div>
      <div className="mt-3"><Input type="date" value={when} min={iso(0)} onChange={(e) => setWhen(e.target.value)} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await onSave(when); onClose(); } finally { setBusy(false); } }}>Save promise</Button>
      </div>
    </Modal>
  );
}

export function PaidModal({ open, onClose, onSave, amount }: { open: boolean; onClose: () => void; amount: number; onSave: (d: string) => Promise<void> }) {
  const [when, setWhen] = useState(iso(0));
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={`Record payment of ${inr(amount)}`}>
      <p className="text-sm ink-2">Each payment teaches the AI more about this customer's habits.</p>
      <div className="mt-4"><Input label="Payment received on" type="date" value={when} max={iso(0)} onChange={(e) => setWhen(e.target.value)} /></div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await onSave(when); onClose(); } finally { setBusy(false); } }}>Mark as paid</Button>
      </div>
    </Modal>
  );
}
