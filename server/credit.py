"""
Order-time credit check: should I give this customer credit on a new order, and on what terms?
Uses the same time-to-payment model, scoring a hypothetical invoice dated today.
"""
from datetime import timedelta

import numpy as np
import pandas as pd
from sqlmodel import Session, select

from . import actions as A
from . import ml
from . import services as S
from .db import Buyer, Invoice, Org

# Safe exposure = months of billing. With 30-45 day terms a reliable customer normally owes 1.5-2 months
# of billing at any time, so grade A gets ~3 months before we worry.
LIMIT_MULT = {"A": 3.0, "B": 2.0, "C": 1.5, "D": 0.75}

# Message to the customer about the new order, in their language.
ORDER_MSG = {
    "en": "Dear {name} team,\n\nThank you for your order of {amt}. To dispatch promptly, we request {terms}.{clear}\n\n{sign},\n{seller}",
    "hi": "नमस्ते {name} टीम,\n\n{amt} के आपके ऑर्डर के लिए धन्यवाद। शीघ्र डिस्पैच के लिए हम {terms} का अनुरोध करते हैं।{clear}\n\n{sign},\n{seller}",
    "mr": "नमस्कार {name} टीम,\n\n{amt} च्या तुमच्या ऑर्डरबद्दल धन्यवाद. लवकर डिस्पॅचसाठी आम्ही {terms} ची विनंती करतो.{clear}\n\n{sign},\n{seller}",
}
TERMS = {
    "part": {"en": "{adv}% advance with the purchase order and the balance within {d} days",
             "hi": "ऑर्डर के साथ {adv}% अग्रिम और शेष राशि {d} दिनों में", "mr": "ऑर्डरसोबत {adv}% आगाऊ रक्कम आणि उर्वरित रक्कम {d} दिवसांत"},
    "full": {"en": "full advance", "hi": "पूर्ण अग्रिम भुगतान", "mr": "संपूर्ण आगाऊ पेमेंट"},
    "credit": {"en": "{d}-day credit", "hi": "{d} दिनों का क्रेडिट", "mr": "{d} दिवसांचे क्रेडिट"},
}
CLEAR = {"en": " We also request clearance of the outstanding {amt}.", "hi": " कृपया बकाया {amt} का भुगतान भी करें।",
         "mr": " कृपया थकबाकी {amt} देखील भरावी."}


def _customer_frame(s: Session, org: Org, buyer_id: int | None) -> pd.DataFrame:
    df = S.frame(s, org.id)
    return df[df["buyer_id"] == buyer_id] if buyer_id else df.iloc[0:0]


def check_order(s: Session, org: Org, buyer_id: int | None, new_name: str | None, amount: float, days: int,
                lang: str | None = None) -> dict:
    t = S.today()
    b = s.get(Buyer, buyer_id) if buyer_id else None
    hist = _customer_frame(s, org, buyer_id)
    new = pd.DataFrame([dict(id=-1, buyer_id=buyer_id or -1, buyer_name=b.name if b else new_name,
                             invoice_date=t, due_date=t + timedelta(days=days), amount=amount, paid_date=None,
                             disputed=False, docs_pending=False, segment=b.segment if b else "Unknown",
                             is_government=b.is_government if b else False,
                             treds_onboarded=b.treds_onboarded if b else False)])
    df = pd.concat([hist, new], ignore_index=True)
    bundle, kind = S.org_bundle(org.id, s)
    F = ml.build_features(df, t)
    row = F[F["id"] == -1].copy()
    row["age"] = -days
    dist = ml.distribution(bundle, row)
    p, q50, lo, hi = (float(dist[k][0]) for k in ("p_late", "q50", "lo", "hi"))
    reasons = A.reasons_for(row.iloc[0].to_dict(), ml.reason_deltas(bundle, row).iloc[0].to_dict(), top=3)

    card = next((c for c in S.buyer_scorecard(s, org.id) if c["id"] == buyer_id), None) if buyer_id else None
    grade = card["grade"] if card else None
    open_amt = card["open_amount"] if card else 0.0
    overdue_amt = card["overdue_amount"] if card else 0.0
    oldest_overdue = 0
    if buyer_id:
        od = [(t - i.due_date).days for i in s.exec(select(Invoice).where(
            Invoice.buyer_id == buyer_id, Invoice.paid_date.is_(None), Invoice.due_date < t)).all()]
        oldest_overdue = max(od, default=0)
    paid12 = hist[pd.to_datetime(hist["invoice_date"]) >= pd.Timestamp(t - timedelta(days=365))]
    monthly = float(paid12["amount"].sum() / 12) if len(paid12) else 0.0
    limit = monthly * LIMIT_MULT.get(grade or "", 1.0) if monthly else None
    exposure = open_amt + amount

    exp_days = days + max(q50, 0)
    delay_cost = amount * org.cost_of_capital * max(q50, 0) / 365
    cushion = delay_cost / amount if amount else 0.0
    conditions: list[str] = []
    advance = 0

    if buyer_id is None or (card and card["invoices_12m"] == 0):
        verdict = "CONDITIONS"
        advance = 25
        conditions = [f"New customer: ask for {advance}% advance on the first order",
                      f"Keep credit to {min(days, 30)} days until they've paid 2-3 invoices on time"]
        headline = "New customer - start with safeguards"
    elif oldest_overdue > 60 or (grade == "D" and p >= 0.7):
        verdict = "HOLD"
        advance = 100
        conditions = ([f"Ask them to clear {A.inr(overdue_amt)} already overdue ({oldest_overdue} days) first"] if overdue_amt else []) + \
                     ["Or accept this order only against full advance / Letter of Credit"]
        headline = "Hold - clear the overdue amount first"
    elif p < 0.3 and limit and exposure > limit:
        # Reliable payer, just a large balance: don't insult a good customer with an advance demand.
        verdict = "APPROVE"
        headline = "Approve - but they owe more than usual"
        conditions = [f"This takes them to {A.short_inr(exposure)}, above their usual level of {A.short_inr(limit)}",
                      "Collect the invoices due this week before the next dispatch",
                      "Send a friendly reminder 3 days before the due date"]
    elif p >= 0.55 or (limit and exposure > limit):
        verdict = "CONDITIONS"
        advance = int(np.clip(round((p - 0.3) * 100 / 10) * 10, 20, 50))
        conditions = [f"Take {advance}% advance ({A.inr(amount * advance / 100)}) with the order"]
        if days > 30:
            conditions.append("Shorten credit to 30 days")
        if b and b.treds_onboarded:
            conditions.append("Or sell this invoice on TReDS as soon as it's accepted")
        if cushion >= 0.003:
            conditions.append(f"If you can't get an advance, price in ~{cushion:.1%} to cover the expected delay")
        if limit and exposure > limit:
            conditions.append(f"This takes them to {A.short_inr(exposure)}, above a safe limit of {A.short_inr(limit)}")
        headline = "Approve with conditions"
    else:
        verdict = "APPROVE"
        headline = "Safe to approve on normal terms"
        conditions = ["Send a friendly reminder 3 days before the due date"]

    # Money already overdue is the strongest reason of all - lead with it so the verdict explains itself.
    if overdue_amt:
        reasons = [f"{A.inr(overdue_amt)} from them is already overdue (oldest {oldest_overdue} days)"] + reasons[:2]

    lang = lang or (b.language if b else "") or org.language
    msg = None
    if verdict != "APPROVE":
        kind_ = "part" if 0 < advance < 100 else "full" if advance == 100 else "credit"
        terms = TERMS[kind_][lang].format(adv=advance, d=min(days, 30) if kind_ == "part" else days)
        clear = CLEAR[lang].format(amt=A.inr(overdue_amt)) if verdict == "HOLD" and overdue_amt else ""
        msg = ORDER_MSG[lang].format(name=b.name if b else new_name, amt=A.inr(amount), terms=terms, clear=clear,
                                     sign=A.SIGN[lang], seller=org.sender_name or org.name)
    return dict(
        verdict=verdict, headline=headline, conditions=conditions, advance_pct=advance, message=msg, message_lang=lang,
        customer=b.name if b else new_name, grade=grade, model=kind,
        p_late=p, expected_days_late=q50, range=[lo, hi], expected_pay_date=(t + timedelta(days=round(exp_days))).isoformat(),
        expected_days_to_cash=exp_days, delay_cost=delay_cost, price_cushion=cushion,
        open_amount=open_amt, overdue_amount=overdue_amt, oldest_overdue_days=oldest_overdue,
        exposure_after=exposure, suggested_limit=limit, monthly_billing=monthly, reasons=reasons,
    )
