import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CheckCircle2, Copy, Lock, Smartphone } from "lucide-react";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button, Card, Input } from "../components/ui";
import { api } from "../lib/api";
import { d, inr } from "../lib/format";

type PayInfo = {
  seller: string; seller_gstin: string; buyer: string; invoice: string; invoice_date: string; due_date: string;
  amount: number; discount: number; pay_amount: number; status: "due" | "claimed" | "paid";
  upi_id: string; upi_url: string | null; qr_svg: string | null; demo?: boolean;
};

export function Pay() {
  const { token } = useParams();
  const [sp] = useSearchParams();
  const offer = sp.get("offer") === "1";
  const { data, isLoading, error, refetch } = useQuery<PayInfo>({ queryKey: ["pay", token, offer], queryFn: () => api(`/pay/${token}${offer ? "?offer=1" : ""}`), retry: false });
  const [claiming, setClaiming] = useState(false);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);

  if (isLoading) return <div className="grid min-h-full place-items-center"><span className="size-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;
  if (error || !data) return <div className="grid min-h-full place-items-center p-6 text-center"><div><h1 className="text-xl font-semibold ink">Link not valid</h1><p className="mt-2 ink-2">Please ask the sender for a new payment link.</p></div></div>;

  async function claim() {
    setBusy(true);
    try {
      await api(`/pay/${token}/claim`, { method: "POST", json: { reference: ref } });
      await refetch();
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-brand-50 to-[var(--bg)] px-4 py-8 dark:from-brand-500/10">
      <div className="mx-auto max-w-md">
        {data.demo && (
          <div className="mb-5 rounded-2xl bg-amber-100 px-4 py-3 text-center text-sm font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            Demo page - this is a fictional business. Please don't send money.
          </div>
        )}
        <div className="text-center">
          <div className="text-sm ink-2">Payment request from</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight ink">{data.seller}</h1>
          {data.seller_gstin && <div className="mt-0.5 text-xs ink-3">GSTIN {data.seller_gstin}</div>}
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="mt-6 overflow-hidden">
            <div className="p-6 text-center">
              <div className="text-sm ink-2">Invoice {data.invoice} · {d(data.invoice_date, { day: "numeric", month: "short", year: "numeric" })}</div>
              <div className="mt-3 text-4xl font-semibold tracking-tight num ink">{inr(data.pay_amount)}</div>
              {data.discount > 0 && (
                <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <span className="line-through opacity-60">{inr(data.amount)}</span> {Math.round(data.discount * 100)}% early-payment discount applied
                </div>
              )}
              <div className="mt-2 text-sm ink-3">For {data.buyer}</div>
            </div>

            {data.status === "paid" ? (
              <div className="border-t line bg-emerald-50 p-6 text-center dark:bg-emerald-500/10">
                <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
                <div className="mt-2 font-semibold ink">This invoice is paid. Thank you!</div>
              </div>
            ) : data.status === "claimed" ? (
              <div className="border-t line bg-brand-50 p-6 text-center dark:bg-brand-500/10">
                <CheckCircle2 className="mx-auto size-10 text-brand-500" />
                <div className="mt-2 font-semibold ink">Thanks - we've told {data.seller}.</div>
                <p className="mt-1 text-sm ink-2">They'll confirm once it reflects in their bank.</p>
              </div>
            ) : data.demo ? (
              <div className="border-t line p-6 text-center text-sm ink-2">In a real account, a <strong className="ink">Pay with UPI</strong> button and QR code appear here, opening GPay, PhonePe or Paytm with the amount filled in.</div>
            ) : !data.upi_url ? (
              <div className="border-t line p-6 text-center text-sm ink-2">The seller hasn't set up UPI payments yet. Please pay by your usual method.</div>
            ) : (
              <div className="space-y-5 border-t line p-6">
                <a href={data.upi_url}
                  className="focus-ring flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3.5 text-[15px] font-medium text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700">
                  <Smartphone className="size-5" />Pay {inr(data.pay_amount)} with UPI
                </a>
                <p className="-mt-2 text-center text-xs ink-3">Opens GPay, PhonePe, Paytm, BHIM or your bank's app</p>
                {data.qr_svg && (
                  <div className="text-center">
                    <div className="text-xs font-medium uppercase tracking-wide ink-3">Or scan with any UPI app</div>
                    <div className="mx-auto mt-3 w-48 overflow-hidden rounded-2xl border line bg-white p-2 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: data.qr_svg }} />
                  </div>
                )}
                <button onClick={() => { navigator.clipboard.writeText(data.upi_id); toast.success("UPI ID copied"); }}
                  className="focus-ring mx-auto flex items-center gap-2 rounded-xl surface-2 px-3 py-2 text-sm ink">
                  <span className="ink-3">UPI ID</span> <span className="font-medium">{data.upi_id}</span> <Copy className="size-3.5 ink-3" />
                </button>
                <div className="border-t line pt-5">
                  {!claiming ? (
                    <Button variant="secondary" className="w-full" onClick={() => setClaiming(true)}>I've already paid</Button>
                  ) : (
                    <div className="space-y-3">
                      <Input label="UPI reference / UTR (optional)" placeholder="12-digit number from your UPI app" value={ref} onChange={(e) => setRef(e.target.value)} />
                      <Button variant="primary" className="w-full" loading={busy} onClick={claim}>Tell {data.seller} I've paid</Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </motion.div>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs ink-3"><Lock className="size-3" />You pay directly to the seller's bank via UPI. No card or bank details are collected here.</p>
        <p className="mt-2 text-center text-xs ink-3">Powered by PayPredict</p>
      </div>
    </div>
  );
}
