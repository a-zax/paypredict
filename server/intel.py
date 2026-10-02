"""
More AI on top of the time-to-payment model (Munim AI uses all of these as tools):

1. Reply reader      - NLP on a customer's reply ("will pay by Friday", "material damaged", "UTR 4521..."):
                       intent model + date / amount / reference extraction, then the survival model estimates
                       how likely the promise is to be kept, and a next step + reply is suggested.
2. Payment personas  - unsupervised learning: K-means on each customer's payment behaviour (seeded at five
                       interpretable prototypes so clusters keep stable names), PCA map, silhouette score.
3. Anomaly check     - Isolation Forest on invoice patterns (amount vs usual, credit period vs usual, timing)
                       plus a duplicate rule, so data-entry errors and odd bills are caught before they cost money.
4. Model health      - calibration (do 70% predictions come true 70% of the time?), Brier score and
                       data drift (PSI) between recent invoices and the history the model learned from.
5. What-if           - the same model re-scored under different credit periods (used by the credit check).
"""
import calendar
import json
import re
from datetime import date, timedelta

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.ensemble import IsolationForest
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import silhouette_score
from sklearn.pipeline import make_pipeline
from sqlmodel import Session, func, select

from . import actions as A
from . import ml
from . import services as S
from .db import ActionLog, Buyer, Invoice, Org

# ================================================================== 1. reply reader
REPLY_EXAMPLES = {
    "PROMISE": ["will pay by friday", "payment will be done next week", "we will release payment on monday", "cheque will be ready by 15th",
                "payment by month end", "will transfer tomorrow", "kal tak payment ho jayega", "agle hafte payment kar denge",
                "somvar ko payment bhej denge", "हम शुक्रवार तक भुगतान कर देंगे", "अगले हफ्ते पेमेंट हो जाएगा", "कल तक पैसे भेज देंगे",
                "सोमवारपर्यंत पेमेंट करू", "पुढच्या आठवड्यात पेमेंट होईल", "payment processed in 10 days", "will clear the dues by 20th",
                "release hoga 5 tarikh ko", "payment scheduled for next tuesday", "we will pay half now and rest by friday"],
    "PAID": ["already paid", "payment done", "we have transferred the amount", "neft done utr 452198763321", "rtgs sent yesterday",
             "paid via upi", "amount credited to your account", "payment bhej diya", "paisa transfer kar diya", "cheque deposited",
             "भुगतान कर दिया है", "पैसे भेज दिए", "पेमेंट केले आहे", "पैसे पाठवले", "please check your account, we paid", "imps done ref 98231"],
    "DISPUTE": ["material was damaged", "quantity short received", "rate is not as per po", "quality issue, goods rejected",
                "wrong items delivered", "we will not pay until replacement", "price mismatch with quotation", "maal kharab aaya",
                "quantity kam hai", "rate galat hai", "माल खराब आया है", "मात्रा कम है", "दर चुकीचा आहे", "माल खराब आला",
                "debit note raised for shortage", "goods returned"],
    "DOCS": ["please send invoice copy", "grn not done yet", "po number missing on invoice", "send e-way bill", "need delivery challan",
             "send ledger statement", "gst number wrong on invoice, send revised", "invoice not received", "bill ki copy bhejo",
             "challan nahi mila", "इनवॉइस की कॉपी भेजिए", "जीआरएन बाकी है", "बिलाची प्रत पाठवा", "documents pending at our end",
             "tds certificate needed", "send credit note first"],
    "CASH_CRUNCH": ["funds are tight right now", "waiting for payment from our customer", "cash flow issue this month", "abhi paisa nahi hai",
                    "hamara payment atka hai", "thoda time chahiye", "पैसे की तंगी है", "अभी फंड नहीं है", "सध्या पैसे नाहीत",
                    "please give us some more time", "we are facing liquidity problems", "can we pay in instalments",
                    "our client hasn't paid us", "budget not released yet", "approval pending from head office"],
    "DISCOUNT": ["can you give some discount", "waive the interest", "reduce the amount and we will pay now", "discount do toh abhi de denge",
                 "कुछ छूट दीजिए", "सूट मिळेल का", "pay now if you give 2 percent off", "settle at lower amount"],
    "ACK": ["ok noted", "will check and revert", "forwarded to accounts", "received your message", "let me check with the team",
            "theek hai dekhte hain", "ok sir", "ठीक है देखते हैं", "बघतो", "noted, will update", "our accounts team will get back",
            "sure", "will look into it"],
}
_rt, _rl = zip(*[(t, k) for k, v in REPLY_EXAMPLES.items() for t in v])
REPLY_MODEL = make_pipeline(TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True),
                            LogisticRegression(C=8, max_iter=2000)).fit(_rt, _rl)

REPLY_LABEL = {"PROMISE": "Promise to pay", "PAID": "Says already paid", "DISPUTE": "Dispute / complaint",
               "DOCS": "Needs documents", "CASH_CRUNCH": "Cash crunch / asking for time", "DISCOUNT": "Asking for a discount",
               "ACK": "Acknowledged, no commitment"}

_WEEKDAYS = {
    0: ["monday", "mon", "somvar", "सोमवार"], 1: ["tuesday", "tue", "mangalvar", "मंगलवार", "मंगळवार"],
    2: ["wednesday", "wed", "budhvar", "बुधवार"], 3: ["thursday", "thu", "guruvar", "गुरुवार"],
    4: ["friday", "fri", "shukravar", "शुक्रवार"], 5: ["saturday", "sat", "shanivar", "शनिवार"], 6: ["sunday", "sun", "ravivar", "रविवार"],
}
_MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m} | {m.lower(): i for i, m in enumerate(calendar.month_name) if m}


def parse_when(text: str, today: date) -> tuple[date | None, str]:
    """Find a payment date in free text (English, Hinglish, Hindi, Marathi). Returns (date, matched phrase)."""
    q = text.lower()
    # explicit dates: 15/10, 15-10-2026, 15 oct, oct 15, 15th
    m = re.search(r"\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b", q)
    if m:
        d_, mo = int(m.group(1)), int(m.group(2))
        y = int(m.group(3)) if m.group(3) else today.year
        y += 2000 if y < 100 else 0
        try:
            dt = date(y, mo, d_)
            return (dt if dt >= today or m.group(3) else date(y + 1, mo, d_)), m.group(0)
        except ValueError:
            pass
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b", q) or \
        re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b", q)
    if m:
        a, b = m.group(1), m.group(2)
        d_, mon = (int(a), b) if a.isdigit() else (int(b), a)
        mo = _MONTHS.get(mon[:3], None)
        if mo:
            try:
                dt = date(today.year, mo, d_)
                return (dt if dt >= today - timedelta(days=3) else date(today.year + 1, mo, d_)), m.group(0)
            except ValueError:
                pass
    m = re.search(r"(?:in|within|next)?\s*(\d{1,2})\s*(?:days?|din|दिन|दिवस)", q)
    if m:
        return today + timedelta(days=int(m.group(1))), m.group(0).strip()
    for words, delta in ((["day after tomorrow", "parso", "परसों", "परवा"], 2), (["tomorrow", "kal ", "kal tak", "कल", "उद्या"], 1),
                         (["today", "aaj", "आज"], 0)):
        for w in words:
            if w in q or q.endswith(w.strip()):
                return today + timedelta(days=delta), w.strip()
    for wd, names in _WEEKDAYS.items():
        for n in names:
            if re.search(rf"(?<![a-z]){re.escape(n)}(?![a-z])", q):
                ahead = (wd - today.weekday()) % 7 or 7
                if re.search(r"next\s+" + re.escape(n), q):
                    ahead += 7 if ahead < 7 else 0
                return today + timedelta(days=ahead), n
    if re.search(r"month[\s-]*end|end of (the )?month|mahine ke (end|aakhir)|महीने के (अंत|आखिर)|महिन्याच्या शेवटी", q):
        last = calendar.monthrange(today.year, today.month)[1]
        dt = date(today.year, today.month, last)
        if (dt - today).days < 2:
            nm = date(today.year + (today.month == 12), today.month % 12 + 1, 1)
            dt = date(nm.year, nm.month, calendar.monthrange(nm.year, nm.month)[1])
        return dt, "month end"
    if re.search(r"next week|agle hafte|अगले (हफ्ते|सप्ताह)|पुढच्या आठवड्यात", q):
        return today + timedelta(days=7 - today.weekday() + 2), "next week"    # mid next week
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:tarikh|तारीख|तारखेला|tak|तक|पर्यंत)?\b", q)
    if m and re.search(r"(\d{1,2})(st|nd|rd|th)|tarikh|तारीख|तारखेला|by\s+\d", q):
        d_ = int(m.group(1))
        if 1 <= d_ <= 31:
            y, mo = today.year, today.month
            if d_ < today.day:
                y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
            try:
                return date(y, mo, min(d_, calendar.monthrange(y, mo)[1])), m.group(0).strip()
            except ValueError:
                pass
    return None, ""


def _ref(text: str) -> str | None:
    m = re.search(r"(?:utr|ref(?:erence)?|txn|transaction(?:\s+id)?|rrn)\s*(?:no\.?|number|id)?\s*[:#-]?\s*([a-z0-9]{6,22})", text, re.I) \
        or re.search(r"\b(\d{12})\b", text)
    return m.group(1).upper() if m else None


def _amount_in(text: str) -> float | None:
    from .agent import _amount
    t = re.sub(r"\b\d{9,}\b", " ", text)                   # don't read a UTR as an amount
    t = re.sub(r"\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b", " ", t)
    return _amount(t)


REPLY_BACK = {
    "PROMISE": {"en": "Thank you for confirming. We have noted payment of {amt} for invoice {num} by {when}.",
                "hi": "पुष्टि के लिए धन्यवाद। हमने इनवॉइस {num} के {amt} का भुगतान {when} तक नोट कर लिया है।",
                "mr": "खात्री केल्याबद्दल धन्यवाद. इनव्हॉइस {num} चे {amt} पेमेंट {when} पर्यंत आम्ही नोंदवले आहे."},
    "PAID": {"en": "Thank you! Could you share the UTR / transaction reference so we can match it with our bank statement?",
             "hi": "धन्यवाद! कृपया UTR / ट्रांज़ैक्शन रेफ़रेंस भेज दें ताकि हम बैंक स्टेटमेंट से मिलान कर सकें।",
             "mr": "धन्यवाद! कृपया UTR / व्यवहार संदर्भ क्रमांक पाठवा म्हणजे आम्ही बँक स्टेटमेंटशी जुळवू शकू."},
    "PAID_REF": {"en": "Thank you! We will match reference {ref} with our bank statement and confirm.",
                 "hi": "धन्यवाद! हम रेफ़रेंस {ref} का बैंक स्टेटमेंट से मिलान करके पुष्टि करेंगे।",
                 "mr": "धन्यवाद! आम्ही संदर्भ {ref} बँक स्टेटमेंटशी जुळवून खात्री करू."},
    "DISPUTE": {"en": "Sorry about this. Please share the details (quantity, rate or quality) and we will resolve it within 2 working days.",
                "hi": "असुविधा के लिए खेद है। कृपया विवरण (मात्रा, दर या गुणवत्ता) भेजें, हम 2 कार्य-दिवसों में हल करेंगे।",
                "mr": "गैरसोयीबद्दल क्षमस्व. कृपया तपशील (प्रमाण, दर किंवा दर्जा) पाठवा, आम्ही 2 कामकाजी दिवसांत सोडवू."},
    "DOCS": {"en": "Sure - we are sending the documents today. Please process the payment of {amt} once received.",
             "hi": "ज़रूर - हम आज ही दस्तावेज़ भेज रहे हैं। मिलने पर कृपया {amt} का भुगतान प्रोसेस करें।",
             "mr": "नक्कीच - आम्ही आजच कागदपत्रे पाठवत आहोत. मिळाल्यावर कृपया {amt} चे पेमेंट प्रक्रिया करा."},
    "CASH_CRUNCH": {"en": "We understand. Could you pay a part now ({part}) and confirm a date for the balance?",
                    "hi": "हम समझते हैं। क्या आप अभी कुछ हिस्सा ({part}) दे सकते हैं और बाकी की तारीख बता सकते हैं?",
                    "mr": "आम्ही समजू शकतो. आत्ता काही रक्कम ({part}) देऊन उर्वरित रकमेची तारीख कळवू शकाल का?"},
    "DISCOUNT": {"en": "We can offer {disc} off if the full amount is paid within 7 days.",
                 "hi": "7 दिनों में पूरा भुगतान करने पर हम {disc} की छूट दे सकते हैं।",
                 "mr": "7 दिवसांत पूर्ण पेमेंट केल्यास आम्ही {disc} सूट देऊ शकतो."},
    "DISCOUNT_NO": {"en": "We have already priced this order at our best rate. Kindly release {amt} at the earliest.",
                    "hi": "यह ऑर्डर पहले से ही हमारी सबसे अच्छी दर पर है। कृपया {amt} का भुगतान जल्द करें।",
                    "mr": "ही ऑर्डर आधीच आमच्या सर्वोत्तम दरात आहे. कृपया {amt} लवकरात लवकर द्यावे."},
    "ACK": {"en": "Thank you. Could you confirm the date by which the payment of {amt} will be released?",
            "hi": "धन्यवाद। कृपया बताएं कि {amt} का भुगतान किस तारीख तक होगा?",
            "mr": "धन्यवाद. कृपया {amt} चे पेमेंट कोणत्या तारखेपर्यंत होईल ते कळवा."},
}
GREET = {"en": "Dear {name} team,", "hi": "नमस्ते {name} टीम,", "mr": "नमस्कार {name} टीम,"}


def p_paid_by(inv: Invoice, when: date, t: date) -> float | None:
    """Chance (from the survival model) that the invoice is paid by `when`, given it is unpaid today."""
    pmf = np.array(json.loads(inv.pmf or "[]"), dtype=float)
    if pmf.size != ml.NB or pmf.sum() <= 0:
        return None
    age = (t - inv.due_date).days
    c = 0 if age <= 0 else int(ml.bin_of(age))
    lo, hi = ml.bin_span(np.arange(ml.NB), c, age)
    dl = (when - inv.due_date).days
    frac = np.clip((dl - lo) / np.maximum(hi - lo, 1e-9), 0, 1)
    return float((pmf * frac).sum() / pmf.sum())


def promise_record(s: Session, buyer_id: int, t: date) -> tuple[int, int]:
    """(kept, total) for this customer's past promises whose date has passed."""
    logs = s.exec(select(ActionLog).where(ActionLog.buyer_id == buyer_id, ActionLog.kind == "PROMISE")).all()
    kept = total = 0
    for lg in logs:
        try:
            when = pd.to_datetime(lg.note.rsplit("by ", 1)[1], format="%d %b %Y").date()
        except (IndexError, ValueError):
            continue
        if when >= t:
            continue
        inv = s.get(Invoice, lg.invoice_id)
        total += 1
        kept += int(bool(inv and inv.paid_date and inv.paid_date <= when + timedelta(days=2)))
    return kept, total


def read_reply(s: Session, org: Org, inv: Invoice, text: str, lang: str | None = None) -> dict:
    """Understand a customer's reply about an invoice and suggest what to do next."""
    from .agent import _lang
    t = S.today()
    b = s.get(Buyer, inv.buyer_id)
    probs = REPLY_MODEL.predict_proba([text.lower()])[0]
    order = np.argsort(-probs)
    intent, conf = REPLY_MODEL.classes_[order[0]], float(probs[order[0]])
    when, phrase = parse_when(text, t)
    amount, ref = _amount_in(text), _ref(text)
    # evidence beats the classifier: a bank reference means "paid"; a concrete date with a soft intent is a promise
    if ref and intent in ("ACK", "PROMISE", "CASH_CRUNCH"):
        intent, conf = "PAID", max(conf, 0.7)
    elif when and intent in ("ACK", "CASH_CRUNCH") and when >= t:
        intent, conf = "PROMISE", max(conf, 0.6)
    lang = lang or (_lang(text) if re.search(r"[ऀ-ॿ]", text) else None) or b.language or org.language or "en"
    partial = amount is not None and amount < inv.amount * 0.95
    out = dict(intent=intent, label=REPLY_LABEL[intent], confidence=conf,
               alternatives=[dict(intent=REPLY_MODEL.classes_[k], label=REPLY_LABEL[REPLY_MODEL.classes_[k]], p=float(probs[k])) for k in order[1:3]],
               when=when.isoformat() if when else None, when_phrase=phrase, amount=amount, partial=partial, reference=ref,
               commitment="firm" if when else ("none" if intent in ("ACK", "CASH_CRUNCH") else "n/a"), lang=lang)
    apply: list[dict] = [dict(kind="NOTE", note=f"Customer replied: {text[:180]}", label="Save the reply to the timeline")]
    exp_date = inv.due_date + timedelta(days=round(max(inv.exp_days_late or 0, (t - inv.due_date).days + 3)))
    fill = dict(amt=A.inr(amount if partial else inv.amount), num=inv.number, when=A.fmt_date(when, lang) if when else "",
                ref=ref or "", part=A.inr(round(inv.amount * 0.3, -3)), disc=f"{org.early_pay_discount:.0%}")
    key = intent
    if intent == "PROMISE":
        if when:
            p_model = p_paid_by(inv, when + timedelta(days=2), t)
            kept, total = promise_record(s, b.id, t)
            hist = (kept + 1) / (total + 2)                                   # Laplace-smoothed track record
            w = 0.6 if total else 1.0
            p = None if p_model is None else w * p_model + (1 - w) * hist
            out.update(p_keep=p, p_model=p_model, promises_kept=kept, promises_total=total,
                       days_vs_forecast=(exp_date - when).days)
            apply.append(dict(kind="PROMISE", when=when.isoformat(), label=f"Log the promise for {A.fmt_date(when, 'en')}"))
            out["next_step"] = ("Log the promise. Munim will remind them a day before and escalate if it's missed."
                                + (" Their track record says it may slip - send the reminder on time." if p is not None and p < 0.5 else ""))
        else:
            out["next_step"] = "They didn't give a date - ask for a specific one."
            key = "ACK"
    elif intent == "PAID":
        out["next_step"] = (f"Check your bank for {A.inr(amount or inv.amount)}" + (f" (ref {ref})" if ref else "")
                            + ", then mark it received. Don't send more reminders meanwhile.")
        apply.append(dict(kind="SNOOZE", when=(t + timedelta(days=3)).isoformat(), label="Pause reminders for 3 days"))
        key = "PAID_REF" if ref else "PAID"
    elif intent == "DISPUTE":
        out["next_step"] = "Mark the invoice as disputed and fix the issue first - chasing payment won't work until then."
        apply.append(dict(kind="DISPUTE", label="Mark as disputed"))
    elif intent == "DOCS":
        out["next_step"] = "Mark paperwork as pending and send the documents today - it's the fastest way to get paid."
        apply.append(dict(kind="DOCS_PENDING", label="Mark paperwork pending"))
    elif intent == "CASH_CRUNCH":
        out["next_step"] = ("Ask for a part-payment and a firm date for the rest"
                            + ("; or sell the invoice on TReDS to get cash today." if b.treds_onboarded else "."))
        if when:
            apply.append(dict(kind="PROMISE", when=when.isoformat(), label=f"Log the promise for {A.fmt_date(when, 'en')}"))
    elif intent == "DISCOUNT":
        wait_cost = inv.amount * org.cost_of_capital * max(inv.exp_days_late or 0, 0) / 365
        disc_cost = inv.amount * org.early_pay_discount
        worth = disc_cost < wait_cost
        out.update(discount_cost=disc_cost, waiting_cost=wait_cost, discount_worth_it=worth)
        out["next_step"] = (f"A {org.early_pay_discount:.0%} discount costs {A.inr(disc_cost)}, waiting costs about {A.inr(wait_cost)} in interest - "
                            + ("offering it is cheaper than waiting." if worth else "waiting is cheaper, so politely decline."))
        key = "DISCOUNT" if worth else "DISCOUNT_NO"
    else:
        out["next_step"] = "No commitment yet - ask for a specific payment date."
    seller = org.sender_name or org.name
    out["reply"] = f"{GREET[lang].format(name=b.name)}\n\n{REPLY_BACK[key][lang].format(**fill)}\n\n{A.SIGN[lang]},\n{seller}"
    out["apply"] = apply
    return out


# ================================================================== shared feature cache
_fcache: dict[tuple, pd.DataFrame] = {}


def _features(s: Session, org: Org) -> pd.DataFrame:
    n, paid = s.exec(select(func.count(Invoice.id), func.count(Invoice.paid_date)).where(Invoice.org_id == org.id)).one()
    key = (org.id, S.today(), n, paid)
    if key not in _fcache:
        if len(_fcache) > 50:
            _fcache.clear()
        df = S.frame(s, org.id)
        _fcache[key] = ml.build_features(df, S.today()) if not df.empty else pd.DataFrame()
    return _fcache[key]


_memo: dict[tuple, dict] = {}


def _cached(name: str, s: Session, org: Org, fn):
    n, paid = s.exec(select(func.count(Invoice.id), func.count(Invoice.paid_date)).where(Invoice.org_id == org.id)).one()
    key = (name, org.id, S.today(), n, paid, S._cache.get(org.id, (None,))[0])
    if key not in _memo:
        if len(_memo) > 200:
            _memo.clear()
        _memo[key] = fn()
    return _memo[key]


# ================================================================== 2. payment personas
PERSONAS = {
    # key: (label, prototype [mean days late, spread, share 15+ late, trend, festive slow-down], strategy, colour)
    "punctual": ("Reliable", [3, 6, 0.08, 0, 0], "Offer longer credit or bigger orders - they're your safest growth.", "#10b981"),
    "steady": ("Steady late", [24, 7, 0.75, 0, 0], "Predictable: bill earlier or build the delay into terms; remind 5 days before due.", "#6366f1"),
    "erratic": ("Erratic", [14, 26, 0.4, 0, 0], "Unpredictable: part-advance on big orders and follow up the day after the due date.", "#f59e0b"),
    "seasonal": ("Festive-slow", [10, 12, 0.3, 0, 18], "Slow in Oct-Nov: collect before the festive season or offer an early-pay discount then.", "#0ea5e9"),
    "slipping": ("Slipping", [14, 12, 0.4, 22, 0], "Getting worse: call now, shorten terms and watch for cash stress.", "#f43f5e"),
}
P_FEATS = ["avg_late", "spread", "pct_late15", "trend", "festive"]
P_LABELS = {"avg_late": "Usual delay (days)", "spread": "Unpredictability (days)", "pct_late15": "Share paid 15+ days late",
            "trend": "Recent change (days)", "festive": "Extra delay in Oct-Nov (days)"}


def _behaviour(s: Session, org: Org) -> pd.DataFrame:
    t = pd.Timestamp(S.today())
    rows = []
    q = select(Invoice.buyer_id, Invoice.invoice_date, Invoice.due_date, Invoice.paid_date, Invoice.amount).where(
        Invoice.org_id == org.id, Invoice.paid_date.is_not(None))
    df = pd.DataFrame(s.exec(q).all(), columns=["buyer_id", "inv", "due", "paid", "amount"])
    if df.empty:
        return pd.DataFrame()
    for c in ("inv", "due", "paid"):
        df[c] = pd.to_datetime(df[c])
    df = df[df["paid"] >= t - pd.Timedelta(days=730)]
    df["late"] = (df["paid"] - df["due"]).dt.days
    for bid, g in df.sort_values("paid").groupby("buyer_id"):
        if len(g) < 5:
            continue
        L = g["late"].values
        fest = g["due"].dt.month.isin([10, 11])
        rows.append(dict(buyer_id=bid, n=len(g), avg_late=L.mean(), spread=L.std(), pct_late15=(L > 15).mean(),
                         trend=L[-3:].mean() - L.mean(),
                         festive=(g.loc[fest, "late"].mean() - g.loc[~fest, "late"].mean()) if fest.sum() >= 2 and (~fest).sum() >= 2 else 0.0))
    return pd.DataFrame(rows)


def personas(s: Session, org: Org) -> dict:
    return _cached("personas", s, org, lambda: _personas(s, org))


def _personas(s: Session, org: Org) -> dict:
    B = _behaviour(s, org)
    if len(B) < 10:
        return {"available": False, "reason": "Needs at least 10 customers with 5+ paid invoices."}
    X = B[P_FEATS].values.astype(float)
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = (X - mu) / sd
    keys = list(PERSONAS)
    proto = (np.array([PERSONAS[k][1] for k in keys], dtype=float) - mu) / sd
    km = KMeans(n_clusters=len(keys), init=proto, n_init=1, random_state=0).fit(Z)
    # name each learned cluster after a prototype: optimal one-to-one matching (Hungarian) on centroid distance
    cost = ((km.cluster_centers_[:, None, :] - proto[None, :, :]) ** 2).sum(2)
    rows, cols = linear_sum_assignment(cost)
    names = {int(ci): keys[k] for ci, k in zip(rows, cols)}
    B["persona"] = [names[c] for c in km.labels_]
    pca = PCA(n_components=2, random_state=0).fit(Z)
    P2 = pca.transform(Z)
    sil = float(silhouette_score(Z, km.labels_)) if len(set(km.labels_)) > 1 else None
    owed = {r.buyer_id: r.amount for r in s.exec(select(Invoice.buyer_id, func.sum(Invoice.amount).label("amount")).where(
        Invoice.org_id == org.id, Invoice.paid_date.is_(None)).group_by(Invoice.buyer_id)).all()}
    names_by_id = {b.id: b.name for b in s.exec(select(Buyer).where(Buyer.org_id == org.id)).all()}
    groups = []
    for ci, k in names.items():
        g = B[B["persona"] == k]
        cen = mu + km.cluster_centers_[ci] * sd
        groups.append(dict(key=k, label=PERSONAS[k][0], strategy=PERSONAS[k][2], color=PERSONAS[k][3], customers=int(len(g)),
                           owed=float(sum(owed.get(b, 0) for b in g["buyer_id"])),
                           profile={f: round(float(v), 2) for f, v in zip(P_FEATS, cen)},
                           examples=[names_by_id.get(b, "?") for b in g.sort_values("n", ascending=False)["buyer_id"].head(3)]))
    order = {k: i for i, k in enumerate(keys)}
    groups.sort(key=lambda g: order[g["key"]])
    pts = [dict(id=int(r.buyer_id), name=names_by_id.get(r.buyer_id, "?"), persona=r.persona, x=round(float(p[0]), 3), y=round(float(p[1]), 3),
                owed=float(owed.get(r.buyer_id, 0))) for r, p in zip(B.itertuples(), P2)]
    return {"available": True, "groups": groups, "points": pts, "silhouette": sil, "features": [P_LABELS[f] for f in P_FEATS],
            "explained": [round(float(v), 3) for v in pca.explained_variance_ratio_], "n": int(len(B)),
            "by_customer": {int(r.buyer_id): r.persona for r in B.itertuples()}}


# ================================================================== 3. anomaly check
def anomalies(s: Session, org: Org, limit: int = 6) -> list[dict]:
    return _cached("anomalies", s, org, lambda: _anomalies(s, org))[:limit]


def _anomalies(s: Session, org: Org) -> list[dict]:
    t = pd.Timestamp(S.today())
    q = select(Invoice.id, Invoice.buyer_id, Invoice.number, Invoice.invoice_date, Invoice.due_date, Invoice.amount, Invoice.paid_date).where(
        Invoice.org_id == org.id, Invoice.invoice_date >= (t - pd.Timedelta(days=540)).date())
    df = pd.DataFrame(s.exec(q).all(), columns=["id", "buyer_id", "number", "inv", "due", "amount", "paid"])
    if len(df) < 200:
        return []
    for c in ("inv", "due"):
        df[c] = pd.to_datetime(df[c])
    df = df.sort_values(["buyer_id", "inv", "id"])
    df["terms"] = (df["due"] - df["inv"]).dt.days
    g = df.groupby("buyer_id")
    df["amt_ratio"] = np.log(df["amount"] / g["amount"].transform("median"))
    df["terms_diff"] = df["terms"] - g["terms"].transform("median")
    df["gap"] = np.log1p(g["inv"].diff().dt.days.fillna(30).clip(lower=0))
    df["n_buyer"] = g["id"].transform("count")
    X = df[["amt_ratio", "terms_diff", "gap"]].values
    iso = IsolationForest(n_estimators=200, contamination=0.02, random_state=0).fit(X)
    df["score"] = iso.decision_function(X)
    # duplicates: same customer, same amount (within 0.5%), raised within 3 days of each other
    prev_amt, prev_inv = g["amount"].shift(), g["inv"].shift()
    df["dup"] = ((df["amount"] - prev_amt).abs() <= df["amount"] * 0.005) & ((df["inv"] - prev_inv).dt.days <= 3)
    live = df[df["paid"].isna() & ((df["score"] < 0) | df["dup"]) & (df["n_buyer"] >= 4)]
    names = {b.id: b.name for b in s.exec(select(Buyer).where(Buyer.org_id == org.id)).all()}
    med = g["amount"].median()
    out = []
    for r in live.itertuples():
        why = []
        if r.dup:
            why.append("Same amount as their previous invoice raised within 3 days - possible duplicate")
        ratio = float(np.exp(r.amt_ratio))
        if ratio >= 2.5:
            why.append(f"{ratio:.1f}× their usual bill of {A.short_inr(med[r.buyer_id])}")
        elif ratio <= 0.3:
            why.append(f"Only {ratio:.0%} of their usual bill ({A.short_inr(med[r.buyer_id])}) - check for a typo")
        if abs(r.terms_diff) >= 15:
            why.append(f"Credit period {r.terms} days vs their usual {r.terms - r.terms_diff:.0f}")
        if not why:
            why.append("Unusual combination of amount, credit period and timing for this customer")
        out.append(dict(invoice_id=int(r.id), number=r.number, customer_id=int(r.buyer_id), name=names.get(r.buyer_id, "?"),
                        amount=float(r.amount), score=float(r.score) - (0.2 if r.dup else 0), reasons=why))
    return sorted(out, key=lambda a: a["score"])


# ================================================================== 4. model health
def _psi(ref: np.ndarray, cur: np.ndarray, bins: int = 10) -> float:
    ref, cur = ref[~np.isnan(ref)], cur[~np.isnan(cur)]
    if len(ref) < 50 or len(cur) < 30:
        return float("nan")
    edges = np.unique(np.quantile(ref, np.linspace(0, 1, bins + 1)))
    if len(edges) < 3:
        return 0.0
    edges[0], edges[-1] = -np.inf, np.inf
    r = np.histogram(ref, edges)[0] / len(ref) + 1e-4
    c = np.histogram(cur, edges)[0] / len(cur) + 1e-4
    return float(((c - r) * np.log(c / r)).sum())


DRIFT_FEATS = {"log_amount": "Invoice size", "credit_terms": "Credit period", "hist_avg_days_late": "Customers' usual delay",
               "open_exposure_lakh": "Amount customers already owe", "amount_vs_usual": "Bill size vs usual"}


def model_health(s: Session, org: Org) -> dict:
    return _cached("health", s, org, lambda: _model_health(s, org))


def _model_health(s: Session, org: Org) -> dict:
    F = _features(s, org)
    if F.empty:
        return {"available": False}
    t = pd.Timestamp(S.today())
    cur = F[F["invoice_date"] > t - pd.Timedelta(days=90)]
    ref = F[(F["invoice_date"] <= t - pd.Timedelta(days=90)) & (F["invoice_date"] > t - pd.Timedelta(days=455))]
    drift = []
    for f, label in DRIFT_FEATS.items():
        v = _psi(ref[f].values.astype(float), cur[f].values.astype(float))
        if np.isnan(v):
            continue
        drift.append(dict(feature=f, label=label, psi=round(v, 3), status="stable" if v < 0.1 else "watch" if v < 0.25 else "shifted"))
    # outcome drift: share paid 15+ days late among recently due invoices vs before
    rec = F[(F["due_date"] > t - pd.Timedelta(days=120)) & (F["due_date"] <= t - pd.Timedelta(days=20))]
    old = F[(F["due_date"] <= t - pd.Timedelta(days=120)) & (F["due_date"] > t - pd.Timedelta(days=485))]
    late = lambda X: float(((X["days_late"] > 15) | (X["days_late"].isna() & (X["age"] > 15))).mean()) if len(X) else None
    worst = max((d["psi"] for d in drift), default=0)
    status = "stable" if worst < 0.1 else "watch" if worst < 0.25 else "retrain"
    from .db import ModelRun
    run = s.exec(select(ModelRun).where(ModelRun.org_id == org.id).order_by(ModelRun.trained_at.desc())).first()
    m = json.loads(run.metrics) if run else {}
    return {"available": True, "drift": drift, "status": status, "calibration": m.get("calibration"), "brier": m.get("brier"),
            "ece": m.get("ece"), "late_rate_recent": late(rec), "late_rate_before": late(old),
            "n_recent": int(len(cur)), "n_reference": int(len(ref))}


# ================================================================== 5. what-if on credit terms
def what_if_terms(s: Session, org: Org, buyer_id: int | None, new_name: str | None, amount: float,
                  options=(15, 30, 45, 60)) -> list[dict]:
    from .credit import _customer_frame
    t = S.today()
    b = s.get(Buyer, buyer_id) if buyer_id else None
    hist = _customer_frame(s, org, buyer_id)
    bundle, _ = S.org_bundle(org.id, s)
    out = []
    for d in options:
        new = pd.DataFrame([dict(id=-1, buyer_id=buyer_id or -1, buyer_name=b.name if b else new_name, invoice_date=t,
                                 due_date=t + timedelta(days=d), amount=amount, paid_date=None, disputed=False, docs_pending=False,
                                 segment=b.segment if b else "Unknown", is_government=b.is_government if b else False,
                                 treds_onboarded=b.treds_onboarded if b else False)])
        F = ml.build_features(pd.concat([hist, new], ignore_index=True), t)
        row = F[F["id"] == -1].copy()
        row["age"] = -d
        dist = ml.distribution(bundle, row)
        q50 = max(float(dist["q50"][0]), 0)
        out.append(dict(credit_days=d, p_late=float(dist["p_late"][0]), days_to_cash=d + q50,
                        cost=amount * org.cost_of_capital * (d + q50) / 365))
    return out
