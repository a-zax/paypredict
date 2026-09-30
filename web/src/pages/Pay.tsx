import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CheckCircle2, Copy, Lock, Smartphone } from "lucide-react";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button, Card, Input } from "../components/ui";
import { api, type Lang } from "../lib/api";
import { inr } from "../lib/format";
import { LANGS } from "../lib/i18n";

type PayInfo = {
  seller: string; seller_gstin: string; buyer: string; invoice: string; invoice_date: string; due_date: string;
  amount: number; discount: number; pay_amount: number; status: "due" | "claimed" | "paid";
  upi_id: string; upi_url: string | null; qr_svg: string | null; demo?: boolean;
};

// Customer-facing copy. The reminder's pay link carries ?lang= so this page matches the message.
const TX = {
  en: {
    invalid: "Link not valid", invalid_hint: "Please ask the sender for a new payment link.",
    demo: "Demo page - this is a fictional business. Please don't send money.",
    from: "Payment request from", invoice: "Invoice", discount: (p: number) => `${p}% early-payment discount applied`, for: "For",
    paid: "This invoice is paid. Thank you!", told: (s: string) => `Thanks - we've told ${s}.`, confirm: "They'll confirm once it reflects in their bank.",
    demo_body: <>In a real account, a <strong className="ink">Pay with UPI</strong> button and this QR code open GPay, PhonePe or Paytm with the amount filled in.</>,
    sample_qr: "Sample QR", demo_qr: "Scanning it shows a demo message. No payment is possible.",
    no_upi: "The seller hasn't set up UPI payments yet. Please pay by your usual method.",
    pay: (a: string) => `Pay ${a} with UPI`, opens: "Opens GPay, PhonePe, Paytm, BHIM or your bank's app", scan: "Or scan with any UPI app",
    upi_id: "UPI ID", copied: "UPI ID copied", already: "I've already paid",
    ref: "UPI reference / UTR (optional)", ref_ph: "12-digit number from your UPI app", tell: (s: string) => `Tell ${s} I've paid`,
    secure: "You pay directly to the seller's bank via UPI. No card or bank details are collected here.", powered: "Powered by PayPredict",
  },
  hi: {
    invalid: "लिंक मान्य नहीं है", invalid_hint: "कृपया भेजने वाले से नया भुगतान लिंक माँगें।",
    demo: "डेमो पेज - यह एक काल्पनिक व्यवसाय है। कृपया पैसे न भेजें।",
    from: "भुगतान अनुरोध", invoice: "इनवॉइस", discount: (p: number) => `${p}% जल्दी भुगतान छूट लागू`, for: "ग्राहक:",
    paid: "इस इनवॉइस का भुगतान हो चुका है। धन्यवाद!", told: (s: string) => `धन्यवाद - हमने ${s} को सूचित कर दिया है।`, confirm: "बैंक में राशि दिखने पर वे पुष्टि करेंगे।",
    demo_body: <>असली खाते में, <strong className="ink">UPI से भुगतान</strong> बटन और यह QR कोड राशि भरकर GPay, PhonePe या Paytm खोलते हैं।</>,
    sample_qr: "नमूना QR", demo_qr: "स्कैन करने पर डेमो संदेश दिखेगा। भुगतान संभव नहीं है।",
    no_upi: "विक्रेता ने अभी UPI भुगतान सेट नहीं किया है। कृपया अपने सामान्य तरीके से भुगतान करें।",
    pay: (a: string) => `UPI से ${a} का भुगतान करें`, opens: "GPay, PhonePe, Paytm, BHIM या आपके बैंक का ऐप खुलेगा", scan: "या किसी भी UPI ऐप से स्कैन करें",
    upi_id: "UPI ID", copied: "UPI ID कॉपी हुई", already: "मैंने भुगतान कर दिया है",
    ref: "UPI रेफ़रेंस / UTR (वैकल्पिक)", ref_ph: "आपके UPI ऐप का 12 अंकों का नंबर", tell: (s: string) => `${s} को बताएं कि मैंने भुगतान कर दिया`,
    secure: "आप UPI से सीधे विक्रेता के बैंक में भुगतान करते हैं। यहाँ कोई कार्ड या बैंक विवरण नहीं लिया जाता।", powered: "PayPredict द्वारा संचालित",
  },
  mr: {
    invalid: "लिंक वैध नाही", invalid_hint: "कृपया पाठवणाऱ्याकडून नवीन पेमेंट लिंक मागवा.",
    demo: "डेमो पेज - हा एक काल्पनिक व्यवसाय आहे. कृपया पैसे पाठवू नका.",
    from: "पेमेंट विनंती", invoice: "इनव्हॉइस", discount: (p: number) => `${p}% लवकर पेमेंट सवलत लागू`, for: "ग्राहक:",
    paid: "या इनव्हॉइसचे पेमेंट झाले आहे. धन्यवाद!", told: (s: string) => `धन्यवाद - आम्ही ${s} यांना कळवले आहे.`, confirm: "बँकेत रक्कम दिसल्यावर ते पुष्टी करतील.",
    demo_body: <>खऱ्या खात्यात, <strong className="ink">UPI ने पेमेंट</strong> बटण आणि हा QR कोड रक्कम भरून GPay, PhonePe किंवा Paytm उघडतात.</>,
    sample_qr: "नमुना QR", demo_qr: "स्कॅन केल्यावर डेमो संदेश दिसेल. पेमेंट शक्य नाही.",
    no_upi: "विक्रेत्याने अजून UPI पेमेंट सेट केलेले नाही. कृपया नेहमीच्या पद्धतीने पेमेंट करा.",
    pay: (a: string) => `UPI ने ${a} भरा`, opens: "GPay, PhonePe, Paytm, BHIM किंवा तुमच्या बँकेचे ॲप उघडेल", scan: "किंवा कोणत्याही UPI ॲपने स्कॅन करा",
    upi_id: "UPI ID", copied: "UPI ID कॉपी झाला", already: "मी पेमेंट केले आहे",
    ref: "UPI रेफरन्स / UTR (ऐच्छिक)", ref_ph: "तुमच्या UPI ॲपमधील 12 अंकी क्रमांक", tell: (s: string) => `${s} यांना कळवा की मी पेमेंट केले`,
    secure: "तुम्ही UPI द्वारे थेट विक्रेत्याच्या बँकेत पेमेंट करता. येथे कोणतेही कार्ड किंवा बँक तपशील घेतले जात नाहीत.", powered: "PayPredict द्वारे",
  },
};
const LOCALE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };

export function Pay() {
  const { token } = useParams();
  const [sp] = useSearchParams();
  const offer = sp.get("offer") === "1";
  const [lang, setLang] = useState<Lang>(() => { const l = sp.get("lang"); return l === "hi" || l === "mr" ? l : "en"; });
  const t = TX[lang];
  const day = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(LOCALE[lang], { day: "numeric", month: "short", year: "numeric" });
  const { data, isLoading, error, refetch } = useQuery<PayInfo>({ queryKey: ["pay", token, offer], queryFn: () => api(`/pay/${token}${offer ? "?offer=1" : ""}`), retry: false });
  const [claiming, setClaiming] = useState(false);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);

  if (isLoading) return <div className="grid min-h-full place-items-center"><span className="size-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;
  if (error || !data) return <div className="grid min-h-full place-items-center p-6 text-center"><div><h1 className="text-xl font-semibold ink">{t.invalid}</h1><p className="mt-2 ink-2">{t.invalid_hint}</p></div></div>;

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
        <div className="mb-4 flex justify-center gap-1 text-xs">
          {LANGS.map((l) => (
            <button key={l.code} onClick={() => setLang(l.code)}
              className={`focus-ring rounded-full px-2.5 py-1 ${lang === l.code ? "surface-2 font-medium ink" : "ink-3 hover:text-[var(--ink)]"}`}>{l.label}</button>
          ))}
        </div>
        {data.demo && (
          <div className="mb-5 rounded-2xl bg-amber-100 px-4 py-3 text-center text-sm font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            {t.demo}
          </div>
        )}
        <div className="text-center">
          <div className="text-sm ink-2">{t.from}</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight ink">{data.seller}</h1>
          {data.seller_gstin && <div className="mt-0.5 text-xs ink-3">GSTIN {data.seller_gstin}</div>}
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="mt-6 overflow-hidden">
            <div className="p-6 text-center">
              <div className="text-sm ink-2">{t.invoice} {data.invoice} · {day(data.invoice_date)}</div>
              <div className="mt-3 text-4xl font-semibold tracking-tight num ink">{inr(data.pay_amount)}</div>
              {data.discount > 0 && (
                <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <span className="line-through opacity-60">{inr(data.amount)}</span> {t.discount(Math.round(data.discount * 100))}
                </div>
              )}
              <div className="mt-2 text-sm ink-3">{t.for} {data.buyer}</div>
            </div>

            {data.status === "paid" ? (
              <div className="border-t line bg-emerald-50 p-6 text-center dark:bg-emerald-500/10">
                <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
                <div className="mt-2 font-semibold ink">{t.paid}</div>
              </div>
            ) : data.status === "claimed" ? (
              <div className="border-t line bg-brand-50 p-6 text-center dark:bg-brand-500/10">
                <CheckCircle2 className="mx-auto size-10 text-brand-500" />
                <div className="mt-2 font-semibold ink">{t.told(data.seller)}</div>
                <p className="mt-1 text-sm ink-2">{t.confirm}</p>
              </div>
            ) : data.demo ? (
              <div className="space-y-4 border-t line p-6 text-center">
                <p className="text-sm ink-2">{t.demo_body}</p>
                {data.qr_svg && (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide ink-3">{t.sample_qr}</div>
                    <div className="relative mx-auto mt-3 w-48">
                      <div className="overflow-hidden rounded-2xl border line bg-white p-2 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: data.qr_svg }} />
                      <span className="absolute -right-2 -top-2 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold tracking-wide text-amber-950 shadow">DEMO</span>
                    </div>
                    <p className="mt-2 text-xs ink-3">{t.demo_qr}</p>
                  </div>
                )}
              </div>
            ) : !data.upi_url ? (
              <div className="border-t line p-6 text-center text-sm ink-2">{t.no_upi}</div>
            ) : (
              <div className="space-y-5 border-t line p-6">
                <a href={data.upi_url}
                  className="focus-ring flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3.5 text-[15px] font-medium text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700">
                  <Smartphone className="size-5" />{t.pay(inr(data.pay_amount))}
                </a>
                <p className="-mt-2 text-center text-xs ink-3">{t.opens}</p>
                {data.qr_svg && (
                  <div className="text-center">
                    <div className="text-xs font-medium uppercase tracking-wide ink-3">{t.scan}</div>
                    <div className="mx-auto mt-3 w-48 overflow-hidden rounded-2xl border line bg-white p-2 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: data.qr_svg }} />
                  </div>
                )}
                <button onClick={() => { navigator.clipboard.writeText(data.upi_id); toast.success(t.copied); }}
                  className="focus-ring mx-auto flex items-center gap-2 rounded-xl surface-2 px-3 py-2 text-sm ink">
                  <span className="ink-3">{t.upi_id}</span> <span className="font-medium">{data.upi_id}</span> <Copy className="size-3.5 ink-3" />
                </button>
                <div className="border-t line pt-5">
                  {!claiming ? (
                    <Button variant="secondary" className="w-full" onClick={() => setClaiming(true)}>{t.already}</Button>
                  ) : (
                    <div className="space-y-3">
                      <Input label={t.ref} placeholder={t.ref_ph} value={ref} onChange={(e) => setRef(e.target.value)} />
                      <Button variant="primary" className="w-full" loading={busy} onClick={claim}>{t.tell(data.seller)}</Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </motion.div>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs ink-3"><Lock className="size-3 shrink-0" />{t.secure}</p>
        <p className="mt-2 text-center text-xs ink-3">{t.powered}</p>
      </div>
    </div>
  );
}
