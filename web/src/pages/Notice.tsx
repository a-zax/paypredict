import { useQuery } from "@tanstack/react-query";
import { Printer, TriangleAlert } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "../components/ui";
import { api } from "../lib/api";
import { d, inr } from "../lib/format";

type NoticeData = {
  date: string; reply_by: string; reference: string; rate: number; bank_rate: number; udyam_registered: boolean;
  seller: { name: string; udyam: string; gstin: string; address: string; phone: string; upi: string };
  buyer: { name: string; contact: string; email: string; is_government: boolean };
  invoices: { number: string; invoice_date: string; due_date: string; amount: number; interest_from: string; days: number; interest: number }[];
  principal: number; interest: number; total: number;
};
const long = { day: "numeric", month: "long", year: "numeric" } as const;
const short = { day: "2-digit", month: "short", year: "numeric" } as const;

/** Printable MSMED Act demand notice. "Save as PDF" = the browser's print dialog (keeps Hindi fonts, no server PDF lib). */
export function Notice() {
  const { buyerId } = useParams();
  const { data } = useQuery<NoticeData>({ queryKey: ["notice", buyerId], queryFn: () => api(`/buyers/${buyerId}/notice`) });
  if (!data) return <div className="grid min-h-full place-items-center"><span className="size-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;
  const missing = [!data.seller.udyam && "Udyam number", !data.seller.address && "business address", !data.seller.gstin && "GSTIN"].filter(Boolean);

  return (
    <div className="min-h-full bg-slate-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-3 px-4 print:hidden">
        <Button variant="primary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Download PDF / Print</Button>
        <span className="text-sm text-slate-600">In the print dialog choose "Save as PDF".</span>
        {missing.length > 0 && (
          <div className="flex w-full items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />Add your {missing.join(", ")} in Settings → Getting paid, so the notice is complete.
          </div>
        )}
        {data.invoices.length === 0 && <div className="w-full rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">No invoices from this customer are past the legal payment period - no notice needed.</div>}
      </div>

      <article className="mx-auto max-w-[210mm] bg-white px-5 py-8 text-[13px] sm:px-[18mm] sm:py-[16mm] print:px-[18mm] print:py-[16mm] leading-relaxed text-slate-900 shadow-xl print:max-w-none print:shadow-none" style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontVariantNumeric: "lining-nums tabular-nums" }}>
        <header className="border-b-2 border-slate-900 pb-3">
          <div className="text-xl font-bold">{data.seller.name}</div>
          <div className="text-[12px] text-slate-700">
            {data.seller.address && <div>{data.seller.address}</div>}
            <div>{[data.seller.udyam && `Udyam Reg. No. ${data.seller.udyam}`, data.seller.gstin && `GSTIN ${data.seller.gstin}`, data.seller.phone && `Ph. ${data.seller.phone}`].filter(Boolean).join(" · ")}</div>
          </div>
        </header>

        <div className="mt-4 flex justify-between text-[12px]">
          <div>Ref: {data.reference}</div><div>Date: {d(data.date, long)}</div>
        </div>
        <div className="mt-4">
          To,<br /><strong>{data.buyer.name}</strong><br />{data.buyer.contact || "Accounts Department"}{data.buyer.email && <><br />{data.buyer.email}</>}
        </div>

        <p className="mt-5 font-bold underline">Subject: Demand for payment of outstanding dues with interest under Sections 15 and 16 of the Micro, Small and Medium Enterprises Development Act, 2006</p>
        <p className="mt-3">Dear Sir / Madam,</p>
        <p className="mt-2">
          We are a micro / small enterprise registered under the MSMED Act, 2006{data.seller.udyam ? ` (Udyam Registration No. ${data.seller.udyam})` : ""}.
          We supplied goods to you against the invoices listed below. Under Section 15 of the Act, payment was due on or before the agreed date,
          which in no case may exceed forty-five days from the day of acceptance. The following amounts remain unpaid as on {d(data.date, long)}:
        </p>

        {/* Scrolls sideways on a phone instead of widening the whole page; prints at full width. */}
        <div className="mt-4 overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[520px] border-collapse text-[12px]">
          <thead>
            <tr className="bg-slate-100">
              {["Invoice No.", "Invoice date", "Due date", "Amount (₹)", "Interest from", "Days", "Interest (₹)"].map((h) => (
                <th key={h} className="border border-slate-400 px-2 py-1.5 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.invoices.map((i) => (
              <tr key={i.number}>
                <td className="border border-slate-400 px-2 py-1">{i.number}</td>
                <td className="border border-slate-400 px-2 py-1">{d(i.invoice_date, short)}</td>
                <td className="border border-slate-400 px-2 py-1">{d(i.due_date, short)}</td>
                <td className="border border-slate-400 px-2 py-1 text-right">{inr(i.amount).slice(1)}</td>
                <td className="border border-slate-400 px-2 py-1">{d(i.interest_from, short)}</td>
                <td className="border border-slate-400 px-2 py-1 text-right">{i.days}</td>
                <td className="border border-slate-400 px-2 py-1 text-right">{inr(i.interest).slice(1)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="border border-slate-400 px-2 py-1.5" colSpan={3}>Total</td>
              <td className="border border-slate-400 px-2 py-1.5 text-right">{inr(data.principal).slice(1)}</td>
              <td className="border border-slate-400 px-2 py-1.5" colSpan={2}></td>
              <td className="border border-slate-400 px-2 py-1.5 text-right">{inr(data.interest).slice(1)}</td>
            </tr>
          </tbody>
        </table>
        </div>

        <p className="mt-4">
          Under Section 16 of the Act, you are liable to pay compound interest with monthly rests at three times the bank rate notified by the
          Reserve Bank of India (bank rate {(data.bank_rate * 100).toFixed(2)}%; applicable rate {(data.rate * 100).toFixed(2)}% per annum) from the day
          following the agreed date. Interest calculated up to the date of this notice is shown above and continues to accrue until payment.
          {!data.buyer.is_government && " Please also note that under Section 43B(h) of the Income-tax Act, 1961, amounts payable to micro and small enterprises beyond the period specified in Section 15 are allowed as a deduction only in the year of actual payment."}
        </p>
        <p className="mt-3">
          We therefore request you to pay <strong>{inr(data.total)}</strong> (principal {inr(data.principal)} plus interest {inr(data.interest)})
          on or before <strong>{d(data.reply_by, long)}</strong>{data.seller.upi ? `, by bank transfer or UPI to ${data.seller.upi}` : ""}.
          Failing this, we shall be constrained to refer the matter to the Micro and Small Enterprises Facilitation Council under Section 18
          of the Act through the MSME Samadhaan portal, without further notice and at your cost.
        </p>
        <p className="mt-3">This notice is issued without prejudice to our other rights and remedies.</p>

        <div className="mt-10">
          Yours faithfully,<br />For <strong>{data.seller.name}</strong>
          <div className="mt-12 w-56 border-t border-slate-500 pt-1 text-[12px]">Authorised Signatory</div>
        </div>
      </article>
      <p className="mx-auto mt-4 max-w-[210mm] px-4 text-xs text-slate-500 print:hidden">
        Template generated by PayPredict. Interest is estimated using the invoice date as the date of acceptance. This is not legal advice - review with your CA or advocate before sending.
      </p>
    </div>
  );
}
