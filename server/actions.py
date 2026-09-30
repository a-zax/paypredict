"""
Decision layer: turn a payment-date forecast into the cheapest effective next action,
explain it in plain language, and draft the message (English / Hindi / Marathi).

Adaptive escalation: for each buyer we look at what was tried before. If two nudges at the
same level were ignored (no payment within 10 days), the next recommendation climbs one rung;
if a rung worked for this buyer before, we start there.
"""
from datetime import date, datetime, timedelta
from urllib.parse import quote

LADDER = ["REMINDER", "EARLY_PAY_OFFER", "LEGAL_NUDGE", "SAMADHAAN"]

ACTIONS = {  # code: (short title, plain-language title, tone colour)
    "CONFIRM_PAYMENT": ("Confirm payment", "Customer says they've paid - confirm it", "green"),
    "RESOLVE_DISPUTE": ("Resolve the dispute", "Sort out the complaint first", "amber"),
    "FIX_DOCS": ("Fix the paperwork", "Send missing delivery/PO documents", "amber"),
    "SAMADHAAN": ("Formal escalation", "Final notice, then file on MSME Samadhaan", "red"),
    "TREDS": ("Get cash today", "Sell this invoice on TReDS", "blue"),
    "LEGAL_NUDGE": ("45-day legal reminder", "Remind them of the 45-day payment law", "red"),
    "EARLY_PAY_OFFER": ("Offer a small discount", "Offer a discount for paying this week", "violet"),
    "REMINDER": ("Send a reminder", "Send a friendly reminder", "blue"),
    "MONITOR": ("No action needed", "Looks fine - we'll keep watching", "green"),
}


def inr(x: float) -> str:
    s = f"{abs(int(round(x))):d}"
    head, tail = s[:-3], s[-3:]
    while len(head) > 2:
        tail = head[-2:] + "," + tail
        head = head[:-2]
    return ("-" if x < 0 else "") + "₹" + (head + "," + tail if head else tail)


def short_inr(x: float) -> str:
    if abs(x) >= 1e7:
        return f"₹{x / 1e7:.2f} Cr"
    if abs(x) >= 1e5:
        return f"₹{x / 1e5:.1f} L"
    return inr(x)


def ladder_floor(history: list[dict], today: date) -> int:
    """history: this buyer's past nudges [{kind, created_at, paid_within_10d}] -> minimum ladder rung."""
    floor = 0
    for rung, kind in enumerate(LADDER):
        tries = [h for h in history if h["kind"] == kind]
        if any(h["paid_within_10d"] for h in tries):
            return rung                                   # this rung has worked for this buyer
        matured = [h for h in tries if (today - h["created_at"].date()).days >= 10]
        if len(matured) >= 2:
            floor = rung + 1                              # ignored twice -> climb
    return min(floor, len(LADDER) - 1)


def recommend(inv: dict, org: dict, today: date, floor: int = 0) -> tuple[str, str, float]:
    """inv: amount, invoice_date, due_date, p_late, exp_days_late, disputed, docs_pending,
    is_government, treds_onboarded, promise_date. Returns (action, why, rupee_value)."""
    amt, p = inv["amount"], inv["p_late"]
    overdue = (today - inv["due_date"]).days
    exp_late = max(inv["exp_days_late"], overdue + 3)
    exp_pay = inv["due_date"] + timedelta(days=round(exp_late))
    days_to_cash = max((exp_pay - today).days, 0)
    total_days = (exp_pay - inv["invoice_date"]).days
    rate = org["cost_of_capital"]
    hold_cost = amt * rate * max(exp_late, 0) / 365

    if inv.get("promise_date") and inv["promise_date"] >= today:
        return "MONITOR", f"Buyer promised to pay by {inv['promise_date']:%d %b}. We'll remind you if it slips.", 0.0
    if inv["disputed"]:
        return "RESOLVE_DISPUTE", "Buyers rarely pay a disputed invoice. Clearing the complaint unlocks the money.", hold_cost
    if inv["docs_pending"]:
        return "FIX_DOCS", "Their accounts team can't release payment without matched delivery/PO papers.", hold_cost
    if org["udyam_registered"] and overdue > 45:
        return ("SAMADHAAN", f"It's {overdue} days overdue. Under the MSMED Act you can claim interest and "
                "file a case on the government's MSME Samadhaan portal.", hold_cost)
    if inv["treds_onboarded"] and p >= 0.5 and amt >= 50_000 and days_to_cash > 7:
        treds_cost = amt * org["treds_rate"] * days_to_cash / 365
        wait_cost = amt * rate * days_to_cash / 365
        if treds_cost < wait_cost:
            return ("TREDS", f"Instead of waiting ~{days_to_cash} days, get the money now through TReDS "
                    f"(the RBI-approved invoice marketplace). Cheaper than your overdraft by "
                    f"{inr(wait_cost - treds_cost)}, and the buyer's credit risk moves off your books.",
                    wait_cost - treds_cost)
    candidates = []
    if p >= 0.25:
        candidates.append("REMINDER")
    early_value = 0.0
    if not inv["is_government"] and p >= 0.4:
        disc = amt * org["early_pay_discount"]
        wait_cost = amt * rate * max(days_to_cash - 7, 0) / 365
        early_value = wait_cost - disc
        if early_value > 0:
            candidates.append("EARLY_PAY_OFFER")
    if org["udyam_registered"] and total_days > 45 and p >= 0.4:
        candidates.append("LEGAL_NUDGE")
    if not candidates:
        return "MONITOR", "Likely to pay on time. No need to chase - we'll keep an eye on it.", 0.0
    if org["relationship_first"] and "EARLY_PAY_OFFER" in candidates:
        candidates = [c for c in candidates if c != "LEGAL_NUDGE"]
    # strongest justified lever, but never below what this buyer has shown they need
    best = max(candidates, key=LADDER.index)
    if LADDER.index(best) < floor and floor < len(LADDER) - 1:
        best = LADDER[floor] if (LADDER[floor] != "EARLY_PAY_OFFER" or not inv["is_government"]) else "LEGAL_NUDGE"
    why = {
        "REMINDER": "A timely nudge is usually enough for this buyer." if p < 0.5
        else "High chance of delay, still within limits - a firm reminder plus a call works best.",
        "EARLY_PAY_OFFER": f"Waiting will cost you more in interest than a {org['early_pay_discount']:.0%} discount "
                           f"(net gain ≈ {inr(max(early_value, 0))}).",
        "LEGAL_NUDGE": f"Payment likely ~{total_days} days after invoice - past the 45-day legal limit. "
                       "Buyers owe interest beyond 45 days"
                       + ("" if inv["is_government"] else " and lose a tax deduction (Sec 43B(h))") + ".",
        "SAMADHAAN": "Earlier reminders were ignored. Time for a formal notice.",
    }[best]
    if floor and LADDER.index(best) == floor:
        why += " (Stepped up: gentler reminders were ignored earlier.)"
    return best, why, max(hold_cost if best != "EARLY_PAY_OFFER" else early_value, 0.0)


# ------------------------------------------------------------------ plain-language reasons
REASON_TEXT = {
    "hist_last3_avg_days_late": lambda v: f"Paid their last 3 invoices about {v:.0f} days late",
    "hist_avg_days_late": lambda v: f"Usually pays about {v:.0f} days late",
    "hist_pct_late15": lambda v: f"{v:.0%} of their past invoices were paid 15+ days late",
    "hist_max_days_late": lambda v: f"Has delayed up to {v:.0f} days before",
    "hist_n_paid": lambda v: "Not much payment history with this customer yet",
    "disputed": lambda v: "There's an open complaint on this invoice" if v else None,
    "docs_pending": lambda v: "Delivery / PO paperwork is incomplete" if v else None,
    "open_overdue_count": lambda v: f"{v:.0f} other invoice(s) from them are already overdue" if v else None,
    "open_exposure_lakh": lambda v: f"They already owe you {short_inr(v * 1e5)}",
    "amount_vs_usual": lambda v: f"This bill is {v:.1f}× bigger than their usual order" if v > 1.2 else None,
    "log_amount": lambda v: f"Large invoice ({short_inr(10 ** v)})",
    "is_government": lambda v: "Government buyers usually take longer" if v else None,
    "invoice_month": lambda v: {10: "Festive season (Oct) slows payments", 11: "Festive season (Nov) slows payments"}
        .get(int(v), None),
    "credit_terms": lambda v: f"Long credit period ({v:.0f} days)" if v > 45 else None,
    "days_since_last_payment": lambda v: f"No payment from them in {v:.0f} days" if v > 30 else None,
    "tenure_days": lambda v: "New customer relationship" if v < 90 else None,
    "segment": lambda v: None,
    "treds_onboarded": lambda v: None,
}


def reasons_for(row: dict, deltas: dict, top: int = 3) -> list[str]:
    out = []
    for col, d in sorted(deltas.items(), key=lambda kv: -kv[1]):
        if d < 2.0:          # adds at least ~2 days of expected delay
            break
        v = row.get(col)
        if v is None or v != v:  # NaN
            text = "New customer - little payment history" if col.startswith("hist") else None
        else:
            fn = REASON_TEXT.get(col)
            text = fn(v) if fn else None
        if text and text not in out:
            out.append(text)
        if len(out) >= top:
            break
    return out


# ------------------------------------------------------------------ messages
MONTHS = {
    "hi": ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
    "mr": ["जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर", "डिसेंबर"],
}
SUBJECT = {"en": "Invoice {inv} - {amt}", "hi": "इनवॉइस {inv} - {amt}", "mr": "इनव्हॉइस {inv} - {amt}"}
UDYAM_LABEL = {"en": "Udyam Registration No.", "hi": "उद्यम पंजीकरण सं.", "mr": "उद्यम नोंदणी क्र."}
SIGN = {"en": "Regards", "hi": "सादर", "mr": "आपला विश्वासू"}
T = {
    "REMINDER": {
        "en": "Dear {buyer} team,\n\nA gentle reminder that invoice {inv} for {amt} {due_phrase_en}. "
              "{ask_en}, and let us know if you need any documents from our side.\n\n{sign},\n{seller}",
        "hi": "नमस्ते {buyer} टीम,\n\nविनम्र स्मरण: इनवॉइस {inv} ({amt}) {due_phrase_hi}। {ask_hi}। "
              "किसी दस्तावेज़ की आवश्यकता हो तो बताएं।\n\n{sign},\n{seller}",
        "mr": "नमस्कार {buyer} टीम,\n\nनम्र आठवण: इनव्हॉइस {inv} ({amt}) {due_phrase_mr}. {ask_mr}. "
              "कोणतीही कागदपत्रे हवी असल्यास कळवा.\n\n{sign},\n{seller}",
    },
    "EARLY_PAY_OFFER": {
        "en": "Dear {buyer} team,\n\nFor invoice {inv} ({amt}), we'd be happy to offer a {disc} discount if the payment "
              "is released by {pay_by}. It helps us keep your supplies running smoothly.\n\n{sign},\n{seller}",
        "hi": "नमस्ते {buyer} टीम,\n\nइनवॉइस {inv} ({amt}) का भुगतान {pay_by} तक करने पर हम {disc} छूट देने को तैयार हैं। "
              "इससे हम आपकी आपूर्ति समय पर जारी रख पाएंगे।\n\n{sign},\n{seller}",
        "mr": "नमस्कार {buyer} टीम,\n\nइनव्हॉइस {inv} ({amt}) चे पेमेंट {pay_by} पर्यंत केल्यास आम्ही {disc} सूट देऊ. "
              "यामुळे आम्ही तुमचा पुरवठा वेळेवर सुरू ठेवू शकू.\n\n{sign},\n{seller}",
    },
    "LEGAL_NUDGE": {
        "en": "Dear {buyer} Accounts team,\n\nInvoice {inv} for {amt} was raised on {inv_date}. As a Udyam-registered MSE "
              "supplier, we request payment within the 45-day limit under Section 15 of the MSMED Act, 2006. Delayed "
              "payments attract compound interest under Section 16{tax_en}. Kindly release the payment by {pay_by}.\n\n{sign},\n{seller}{udyam}",
        "hi": "आदरणीय {buyer} लेखा टीम,\n\nइनवॉइस {inv} ({amt}) {inv_date} को जारी हुआ था। Udyam-पंजीकृत सूक्ष्म/लघु आपूर्तिकर्ता "
              "होने के नाते, MSMED अधिनियम 2006 की धारा 15 के तहत 45 दिनों में भुगतान का अनुरोध है। देरी पर धारा 16 के तहत "
              "चक्रवृद्धि ब्याज देय है{tax_hi}। कृपया {pay_by} तक भुगतान करें।\n\n{sign},\n{seller}{udyam}",
        "mr": "आदरणीय {buyer} लेखा टीम,\n\nइनव्हॉइस {inv} ({amt}) {inv_date} रोजी जारी झाले. Udyam-नोंदणीकृत सूक्ष्म/लघु "
              "पुरवठादार म्हणून, MSMED कायदा 2006 कलम 15 नुसार 45 दिवसांत पेमेंटची विनंती आहे. उशीर झाल्यास कलम 16 नुसार "
              "चक्रवाढ व्याज देय आहे{tax_mr}. कृपया {pay_by} पर्यंत पेमेंट करावे.\n\n{sign},\n{seller}{udyam}",
    },
    "RESOLVE_DISPUTE": {
        "en": "Dear {buyer} team,\n\nWe understand there's an open query on invoice {inv} ({amt}). Could we do a quick "
              "15-minute call this week to resolve it? We can issue a credit note or replacement if needed.\n\n{sign},\n{seller}",
        "hi": "नमस्ते {buyer} टीम,\n\nइनवॉइस {inv} ({amt}) पर एक प्रश्न लंबित है। क्या इस सप्ताह 15 मिनट की कॉल पर इसे सुलझा "
              "सकते हैं? आवश्यकता हो तो हम क्रेडिट नोट या रिप्लेसमेंट दे सकते हैं।\n\n{sign},\n{seller}",
        "mr": "नमस्कार {buyer} टीम,\n\nइनव्हॉइस {inv} ({amt}) बाबत एक प्रश्न प्रलंबित आहे. या आठवड्यात 15 मिनिटांच्या कॉलवर "
              "तो सोडवू शकतो का? गरज असल्यास आम्ही क्रेडिट नोट किंवा रिप्लेसमेंट देऊ.\n\n{sign},\n{seller}",
    },
    "FIX_DOCS": {
        "en": "Dear {buyer} team,\n\nFor invoice {inv} ({amt}) we're re-sharing the signed delivery challan, e-invoice "
              "IRN and PO reference. Kindly complete the GRN so the payment can be processed by {pay_by}.\n\n{sign},\n{seller}",
        "hi": "नमस्ते {buyer} टीम,\n\nइनवॉइस {inv} ({amt}) के लिए हस्ताक्षरित डिलीवरी चालान, ई-इनवॉइस IRN और PO संदर्भ पुनः "
              "भेज रहे हैं। कृपया GRN पूर्ण करें ताकि भुगतान {pay_by} तक हो सके।\n\n{sign},\n{seller}",
        "mr": "नमस्कार {buyer} टीम,\n\nइनव्हॉइस {inv} ({amt}) साठी सही केलेले डिलिव्हरी चलन, ई-इनव्हॉइस IRN आणि PO संदर्भ "
              "पुन्हा पाठवत आहोत. कृपया GRN पूर्ण करा म्हणजे पेमेंट {pay_by} पर्यंत होईल.\n\n{sign},\n{seller}",
    },
    "SAMADHAAN": {
        "en": "Dear {buyer} Accounts team,\n\nInvoice {inv} for {amt} (due {due}) remains unpaid beyond the statutory 45-day "
              "period. Unless the payment with interest under Section 16 of the MSMED Act is received by {pay_by}, we will "
              "file a reference with the MSE Facilitation Council through the MSME Samadhaan portal.\n\n{sign},\n{seller}{udyam}",
        "hi": "आदरणीय {buyer} लेखा टीम,\n\nइनवॉइस {inv} ({amt}, देय {due}) वैधानिक 45 दिनों के बाद भी बकाया है। {pay_by} तक MSMED "
              "धारा 16 के ब्याज सहित भुगतान न मिलने पर हम MSME समाधान पोर्टल के माध्यम से MSEFC में आवेदन करेंगे।\n\n{sign},\n{seller}{udyam}",
        "mr": "आदरणीय {buyer} लेखा टीम,\n\nइनव्हॉइस {inv} ({amt}, देय {due}) वैधानिक 45 दिवसांनंतरही थकीत आहे. {pay_by} पर्यंत "
              "MSMED कलम 16 च्या व्याजासह पेमेंट न मिळाल्यास आम्ही MSME समाधान पोर्टलद्वारे MSEFC कडे अर्ज करू.\n\n{sign},\n{seller}{udyam}",
    },
}
INTERNAL = {
    "TREDS": "Upload this invoice on your TReDS platform (RXIL, M1xchange or Invoicemart). Once the buyer accepts it, "
             "financiers bid and the money usually reaches you in 1-2 working days - without recourse to you.",
    "MONITOR": "Nothing to send. PayPredict re-checks this invoice every day and will bring it to your Today list if the risk rises.",
    "CONFIRM_PAYMENT": "Open your bank statement or UPI app and look for this amount. If it's there, tap 'Payment received'. "
                       "If not, tap 'Not received' and PayPredict will resume follow-ups.",
}


def fmt_date(d: date, lang: str) -> str:
    """05 Aug 2026 / 05 अगस्त 2026 / 05 ऑगस्ट 2026 - month names in the message's own language."""
    return d.strftime("%d %b %Y") if lang not in MONTHS else f"{d.day:02d} {MONTHS[lang][d.month - 1]} {d.year}"


def subject(number: str, amount: float, lang: str) -> str:
    return SUBJECT[lang].format(inv=number, amt=inr(amount))


def draft(action: str, inv: dict, org: dict, lang: str, today: date) -> str:
    if action in INTERNAL:
        return INTERNAL[action]
    pay_by = max(inv["due_date"], today + timedelta(days=7))
    overdue = (today - inv["due_date"]).days
    gov = inv["is_government"]
    fmt = lambda d: fmt_date(d, lang)
    late_en = f" ({overdue} day{'s' if overdue != 1 else ''} ago)"
    udyam = org.get("udyam_number") if org.get("udyam_registered", True) else ""
    return T[action][lang].format(
        buyer=inv["buyer_name"], inv=inv["number"], amt=inr(inv["amount"]), due=fmt(inv["due_date"]),
        inv_date=fmt(inv["invoice_date"]), pay_by=fmt(pay_by), disc=f"{org['early_pay_discount']:.0%}",
        seller=org["sender_name"] or org["name"], sign=SIGN[lang],
        due_phrase_en=(f"was due on {fmt(inv['due_date'])}{late_en}" if overdue > 0 else f"is due on {fmt(inv['due_date'])}"),
        due_phrase_hi=(f"की भुगतान तिथि {fmt(inv['due_date'])} थी ({overdue} दिन पहले)" if overdue > 0 else f"की भुगतान तिथि {fmt(inv['due_date'])} है"),
        due_phrase_mr=(f"ची देय तारीख {fmt(inv['due_date'])} होती ({overdue} दिवसांपूर्वी)" if overdue > 0 else f"ची देय तारीख {fmt(inv['due_date'])} आहे"),
        ask_en=f"Kindly release the payment by {fmt(pay_by)}" if overdue > 0 else "Kindly schedule the payment",
        ask_hi=f"कृपया {fmt(pay_by)} तक भुगतान करें" if overdue > 0 else "कृपया भुगतान निर्धारित करें",
        ask_mr=f"कृपया {fmt(pay_by)} पर्यंत पेमेंट करावे" if overdue > 0 else "कृपया पेमेंट नियोजित करा",
        udyam=f"\n{UDYAM_LABEL[lang]}: {udyam}" if udyam else "",
        tax_en="" if gov else ", and under Section 43B(h) of the Income-tax Act the expense is deductible only in the year of actual payment",
        tax_hi="" if gov else " और आयकर अधिनियम धारा 43B(h) के अनुसार खर्च की कटौती केवल भुगतान वर्ष में मिलेगी",
        tax_mr="" if gov else " आणि आयकर कायदा कलम 43B(h) नुसार खर्चाची वजावट फक्त पेमेंटच्या वर्षातच मिळेल",
    )


def whatsapp_link(phone: str, text: str) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if len(digits) == 10:
        digits = "91" + digits
    return f"https://wa.me/{digits}?text={quote(text)}" if digits else f"https://wa.me/?text={quote(text)}"


def email_link(email: str, subject: str, text: str) -> str:
    return f"mailto:{email}?subject={quote(subject)}&body={quote(text)}"
