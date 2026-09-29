"""Business logic shared by the API and the AI assistant."""
import io
import json
from contextlib import nullcontext
from datetime import date, datetime, timedelta

import joblib

import numpy as np
import pandas as pd
from sqlalchemy import update
from sqlmodel import Session, delete, select

from . import actions as A
from . import ingest, ml
from . import payments as P
from .config import SECRET
from .db import ActionLog, Buyer, Invoice, ModelBlob, ModelRun, Org, as_dict, engine, utcnow


def today() -> date:
    return date.today()


def org_dict(org: Org) -> dict:
    return as_dict(org)


# ------------------------------------------------------------------ data access
def frame(s: Session, org_id: int) -> pd.DataFrame:
    invs = s.exec(select(Invoice).where(Invoice.org_id == org_id)).all()
    buyers = {b.id: b for b in s.exec(select(Buyer).where(Buyer.org_id == org_id)).all()}
    rows = []
    for i in invs:
        b = buyers[i.buyer_id]
        rows.append(dict(id=i.id, buyer_id=i.buyer_id, buyer_name=b.name, invoice_date=i.invoice_date,
                         due_date=i.due_date, amount=i.amount, paid_date=i.paid_date, disputed=i.disputed,
                         docs_pending=i.docs_pending, segment=b.segment, is_government=b.is_government,
                         treds_onboarded=b.treds_onboarded))
    cols = ["id", "buyer_id", "buyer_name", "invoice_date", "due_date", "amount", "paid_date", "disputed",
            "docs_pending", "segment", "is_government", "treds_onboarded"]
    return pd.DataFrame(rows, columns=cols)


# ------------------------------------------------------------------ models
# Trained models live in the database (ModelBlob), not on disk: free hosts wipe local files on restart.
_cache: dict[int, tuple] = {}          # org_id -> (updated_at, bundle)
STARTER_ID = 0


def _blob_save(s: Session, org_id: int, bundle) -> None:
    buf = io.BytesIO()
    joblib.dump(bundle, buf, compress=3)
    row = s.get(ModelBlob, org_id) or ModelBlob(org_id=org_id, data=b"")
    row.data, row.updated_at = buf.getvalue(), utcnow()
    s.add(row)
    s.commit()
    _cache[org_id] = (row.updated_at, bundle)


def _blob_load(s: Session, org_id: int):
    row = s.get(ModelBlob, org_id)
    if row is None:
        _cache.pop(org_id, None)
        return None
    hit = _cache.get(org_id)
    if hit and hit[0] == row.updated_at:
        return hit[1]
    bundle = joblib.load(io.BytesIO(row.data))
    _cache[org_id] = (row.updated_at, bundle)
    return bundle


def starter_bundle(s: Session | None = None):
    """Starter model for businesses without enough history: trained on the bundled benchmark ledger."""
    with (Session(engine) if s is None else nullcontext(s)) as ss:
        bundle = _blob_load(ss, STARTER_ID)
        if bundle is None:
            df = _sample_as_frame(today())
            bundle = ml.fit(ml.build_features(df, today()))
            bundle["metrics"] = ml.backtest(df, today())
            _blob_save(ss, STARTER_ID, bundle)
        return bundle


def _sample_as_frame(t: date) -> pd.DataFrame:
    s = ingest.sample_frame(t)
    return pd.DataFrame(dict(
        id=np.arange(len(s)), buyer_id=s["buyer_id"].str[1:].astype(int), buyer_name=s["buyer_name"],
        invoice_date=s["invoice_date"], due_date=s["due_date"], amount=s["amount"],
        paid_date=s["payment_date"].where(s["payment_date"] <= pd.Timestamp(t)),
        disputed=s["dispute_flag"], docs_pending=s["docs_incomplete"], segment="Unknown",
        is_government=s["buyer_type"].eq("Govt Department"), treds_onboarded=s["treds_onboarded"]))


def org_bundle(org_id: int, s: Session | None = None):
    with (Session(engine) if s is None else nullcontext(s)) as ss:
        own = _blob_load(ss, org_id)
        return (own, "own") if own is not None else (starter_bundle(ss), "starter")


def train_org(s: Session, org: Org) -> dict:
    """Train on this business's own ledger if there is enough history; otherwise use the starter model."""
    df = frame(s, org.id)
    t = today()
    paid = df["paid_date"].notna().sum()
    enough = paid >= ml.MIN_PAID_FOR_OWN_MODEL and df.loc[df.paid_date.notna(), "buyer_id"].nunique() >= ml.MIN_BUYERS_FOR_OWN_MODEL
    if enough:
        metrics = ml.backtest(df, t)
        _blob_save(s, org.id, ml.fit(ml.build_features(df, t)))
        kind = "own"
    else:
        row = s.get(ModelBlob, org.id)
        if row:
            s.delete(row)
            s.commit()
        _cache.pop(org.id, None)
        metrics = dict(starter_bundle(s)["metrics"])
        metrics["note"] = (f"Using the starter model: your ledger has {int(paid)} paid invoices with dates; "
                           f"{ml.MIN_PAID_FOR_OWN_MODEL}+ across {ml.MIN_BUYERS_FOR_OWN_MODEL}+ customers are needed "
                           "to train on your own data.")
        kind = "starter"
    metrics.update(paid_invoices=int(paid), customers=int(df["buyer_id"].nunique()))
    s.add(ModelRun(org_id=org.id, kind=kind, metrics=json.dumps(metrics)))
    s.commit()
    rescore(s, org)
    return {"kind": kind, **metrics}


# ------------------------------------------------------------------ scoring
def _history_by_buyer(s: Session, org_id: int) -> dict:
    logs = s.exec(select(ActionLog).where(ActionLog.org_id == org_id, ActionLog.kind.in_(A.LADDER))).all()
    paid = {i.id: i.paid_date for i in s.exec(select(Invoice).where(Invoice.org_id == org_id)).all()}
    out: dict[int, list] = {}
    for lg in logs:
        pd_ = paid.get(lg.invoice_id)
        ok = bool(pd_ and 0 <= (pd_ - lg.created_at.date()).days <= 10)
        out.setdefault(lg.buyer_id, []).append(dict(kind=lg.kind, created_at=lg.created_at, paid_within_10d=ok))
    return out


def rescore(s: Session, org: Org):
    t = today()
    df = frame(s, org.id)
    if df.empty:
        return
    bundle, _ = org_bundle(org.id, s)
    F = ml.build_features(df, t)
    open_ = F[F["paid_date"].isna()].copy()
    if open_.empty:
        return
    dist = ml.distribution(bundle, open_)
    deltas = ml.reason_deltas(bundle, open_)
    hist = _history_by_buyer(s, org.id)
    od = org_dict(org)
    invs = {i.id: i for i in s.exec(select(Invoice).where(Invoice.id.in_(open_["id"].tolist()))).all()}
    updates = []
    for n, (idx, row) in enumerate(open_.iterrows()):
        inv = invs[int(row["id"])]
        rec_in = dict(amount=inv.amount, invoice_date=inv.invoice_date, due_date=inv.due_date,
                      p_late=float(dist["p_late"][n]), exp_days_late=float(dist["q50"][n]),
                      disputed=inv.disputed, docs_pending=inv.docs_pending,
                      is_government=bool(row["is_government"]), treds_onboarded=bool(row["treds_onboarded"]),
                      promise_date=inv.promise_date)
        floor = A.ladder_floor(hist.get(inv.buyer_id, []), t)
        action, why, value = A.recommend(rec_in, od, t, floor)
        overdue = max((t - inv.due_date).days, 0)
        broken = inv.promise_date is not None and inv.promise_date < t
        priority = 0.0 if action == "MONITOR" else inv.amount * max(rec_in["p_late"], 0.15) * (1 + overdue / 30) * (2 if broken else 1)
        if inv.claim_at:                     # buyer says they paid via the UPI page: confirming is the #1 job
            action = "CONFIRM_PAYMENT"
            why = (f"The customer says they've paid via UPI"
                   + (f" (reference {inv.claim_ref})" if inv.claim_ref else "") + ". Check your bank statement and confirm.")
            value, priority = 0.0, inv.amount * 10
        lead = [f"Already {overdue} days past the due date"] if overdue > 0 else []
        lead += ["Missed a promised payment date"] if broken else []
        updates.append(dict(
            id=inv.id, p_late=rec_in["p_late"], exp_days_late=float(dist["q50"][n]),
            lo_days_late=float(dist["lo"][n]), hi_days_late=float(dist["hi"][n]),
            action=action, rationale=why, benefit=float(value), priority=float(priority),
            reasons=json.dumps(lead + A.reasons_for(row.to_dict(), deltas.loc[idx].to_dict(), top=4 - len(lead))),
            pmf=json.dumps([round(float(x), 4) for x in dist["pmf"][n]]), scored_on=t))
    # One batched UPDATE instead of a round trip per invoice (hundreds of trips to a hosted database add up).
    s.execute(update(Invoice), updates)
    s.commit()


def ensure_fresh(s: Session, org: Org):
    """Predictions depend on invoice age, so re-score once per day (and after data changes)."""
    stale = s.exec(select(Invoice).where(Invoice.org_id == org.id, Invoice.paid_date.is_(None),
                                         (Invoice.scored_on.is_(None)) | (Invoice.scored_on < today())).limit(1)).first()
    if stale:
        rescore(s, org)


# ------------------------------------------------------------------ import
def import_rows(s: Session, org: Org, rows: pd.DataFrame) -> dict:
    buyers = {b.name.lower(): b for b in s.exec(select(Buyer).where(Buyer.org_id == org.id)).all()}
    existing = {(i.buyer_id, i.number): i for i in s.exec(select(Invoice).where(Invoice.org_id == org.id)).all()}
    new_b = new_i = upd = 0
    for r in rows.itertuples():
        key = r.buyer.lower()
        b = buyers.get(key)
        if not b:
            b = Buyer(org_id=org.id, name=r.buyer)
            s.add(b)
            s.flush()
            buyers[key] = b
            new_b += 1
        if getattr(r, "phone", "") and not b.phone:
            b.phone = ingest.safe_phone(r.phone)
        if getattr(r, "email", "") and not b.email:
            b.email = r.email
        inv = existing.get((b.id, r.number))
        paid = ingest.date_or_none(r.paid_date)
        if inv:
            inv.amount, inv.invoice_date, inv.due_date = float(r.amount), r.invoice_date.date(), r.due_date.date()
            inv.paid_date = paid or inv.paid_date
            upd += 1
        else:
            inv = Invoice(org_id=org.id, buyer_id=b.id, number=r.number, invoice_date=r.invoice_date.date(),
                          due_date=r.due_date.date(), amount=float(r.amount), paid_date=paid)
            existing[(b.id, r.number)] = inv
            new_i += 1
        s.add(inv)
    org.onboarded = True
    s.add(org)
    s.commit()
    model = train_org(s, org)
    return {"new_customers": new_b, "new_invoices": new_i, "updated_invoices": upd, "model": model}


def load_sample(s: Session, org: Org) -> dict:
    """Demo mode: a realistic fictional packaging MSME ledger (3 years, 220 customers)."""
    clear_org(s, org)
    t = today()
    sm = ingest.sample_frame(t)
    buyers = {}
    for b in sm.drop_duplicates("buyer_id").itertuples():
        bb = Buyer(org_id=org.id, name=b.buyer_name, segment=b.buyer_type,
                   is_government=b.buyer_type == "Govt Department", treds_onboarded=bool(b.treds_onboarded),
                   email=f"accounts@{b.buyer_id.lower()}.example", contact_person="Accounts team")
        s.add(bb)
        buyers[b.buyer_id] = bb
    s.flush()
    for r in sm.itertuples():
        paid = r.payment_date if pd.notna(r.payment_date) and r.payment_date <= pd.Timestamp(t) else None
        s.add(Invoice(org_id=org.id, buyer_id=buyers[r.buyer_id].id, number=r.invoice_number,
                      invoice_date=r.invoice_date.date(), due_date=r.due_date.date(), amount=float(r.amount),
                      paid_date=paid.date() if paid is not None else None,
                      disputed=bool(r.dispute_flag), docs_pending=bool(r.docs_incomplete)))
    org.onboarded = True
    if not org.sender_name:
        org.sender_name = org.name
    s.add(org)
    s.commit()
    return train_org(s, org)


def clear_org(s: Session, org: Org):
    for model in (ActionLog, Invoice, Buyer, ModelRun, ModelBlob):
        s.exec(delete(model).where(model.org_id == org.id))
    s.commit()
    _cache.pop(org.id, None)


# ------------------------------------------------------------------ views
def invoice_view(inv: Invoice, b: Buyer, t: date, org: Org | None = None, lang: str | None = None,
                 base: str | None = None) -> dict:
    exp = inv.due_date + timedelta(days=round(max(inv.exp_days_late or 0, (t - inv.due_date).days + 3)
                                               if inv.paid_date is None else 0))
    lo = max(inv.due_date + timedelta(days=round(inv.lo_days_late or 0)), t + timedelta(days=1))
    hi = max(inv.due_date + timedelta(days=round(inv.hi_days_late or 0)), exp + timedelta(days=3))
    risk = inv.p_late or 0
    v = dict(
        id=inv.id, number=inv.number, buyer_id=b.id, buyer_name=b.name, amount=inv.amount,
        invoice_date=inv.invoice_date.isoformat(), due_date=inv.due_date.isoformat(),
        paid_date=inv.paid_date.isoformat() if inv.paid_date else None,
        status="paid" if inv.paid_date else ("overdue" if inv.due_date < t else "open"),
        days_overdue=max((t - inv.due_date).days, 0) if not inv.paid_date else 0,
        days_to_due=(inv.due_date - t).days,
        disputed=inv.disputed, docs_pending=inv.docs_pending,
        promise_date=inv.promise_date.isoformat() if inv.promise_date else None,
        snoozed_until=inv.snoozed_until.isoformat() if inv.snoozed_until else None,
        risk=risk, risk_band="high" if risk >= 0.5 else "medium" if risk >= 0.25 else "low",
        expected_pay_date=exp.isoformat() if not inv.paid_date else None,
        range_start=lo.isoformat() if not inv.paid_date else None,
        range_end=hi.isoformat() if not inv.paid_date else None,
        action=inv.action, action_title=A.ACTIONS.get(inv.action or "", ("", "", ""))[1],
        action_short=A.ACTIONS.get(inv.action or "", ("", "", ""))[0],
        action_tone=A.ACTIONS.get(inv.action or "", ("", "", "gray"))[2],
        rationale=inv.rationale, value=inv.benefit or 0, reasons=json.loads(inv.reasons or "[]"),
        priority=inv.priority or 0, buyer_phone=b.phone, buyer_email=b.email,
        claim_at=inv.claim_at.isoformat() if inv.claim_at else None, claim_ref=inv.claim_ref,
    )
    if org is not None and not inv.paid_date:
        v["interest"] = P.msmed_interest(inv.amount, inv.invoice_date, inv.due_date, t, org.bank_rate) \
            if org.udyam_registered else None
        if org.upi_id and base:
            v["pay_url"] = f"{base}/pay/{P.pay_token(inv.id, org.id, SECRET)}"
    if org is not None and inv.action and not inv.paid_date:
        lang = lang or org.language
        rec = dict(amount=inv.amount, invoice_date=inv.invoice_date, due_date=inv.due_date, number=inv.number,
                   buyer_name=b.name, is_government=b.is_government)
        text = A.draft(inv.action, rec, org_dict(org), lang, t)
        extra = []
        if inv.action in ("LEGAL_NUDGE", "SAMADHAAN") and v.get("interest") and v["interest"]["applies"]:
            extra.append(P.INTEREST_LINE[lang].format(amt=A.inr(v["interest"]["interest"])))
        if v.get("pay_url") and inv.action in ("REMINDER", "EARLY_PAY_OFFER", "LEGAL_NUDGE", "SAMADHAAN"):
            url = v["pay_url"] + ("?offer=1" if inv.action == "EARLY_PAY_OFFER" else "")
            extra.append(P.PAY_LINE[lang].format(url=url))
        if extra:   # insert before the sign-off (last two lines: "Regards," + name)
            head, sep, tail = text.rpartition("\n\n")
            text = f"{head}\n\n" + "\n".join(extra) + f"{sep}{tail}" if sep else text + "\n\n" + "\n".join(extra)
        v["message"] = text
        v["message_lang"] = lang
        v["internal_action"] = inv.action in A.INTERNAL
        v["whatsapp_url"] = A.whatsapp_link(b.phone, text)
        v["email_url"] = A.email_link(b.email, f"Invoice {inv.number} - {A.inr(inv.amount)}", text)
    return v


def forecast(s: Session, org_id: int, weeks: int = 12, sims: int = 1000) -> dict:
    """Weekly collections: 'assumed' (everyone pays on due date) vs PayPredict expected, with an
    80% band from Monte-Carlo simulation over each invoice's payment-date distribution."""
    t = today()
    invs = s.exec(select(Invoice).where(Invoice.org_id == org_id, Invoice.paid_date.is_(None))).all()
    start = t - timedelta(days=t.weekday())
    week_starts = [start + timedelta(weeks=w) for w in range(weeks)]
    assumed = np.zeros(weeks)
    sim = np.zeros((sims, weeks))
    rng = np.random.default_rng(7)
    for inv in invs:
        wk = max((max(inv.due_date, t) - start).days // 7, 0)
        if wk < weeks:
            assumed[wk] += inv.amount
        pmf = np.array(json.loads(inv.pmf or "[]"))
        if pmf.size != ml.NB or pmf.sum() <= 0:
            continue
        k = rng.choice(ml.NB, size=sims, p=pmf / pmf.sum())
        age = (t - inv.due_date).days
        lo, hi = ml.bin_span(k, pmf.nonzero()[0][0], age)   # same day-ranges as the quantiles
        d = lo + rng.random(sims) * (hi - lo)
        pay = np.array([(inv.due_date - start).days]) + np.round(d)
        pay = np.maximum(pay, (t - start).days)
        w = (pay // 7).astype(int)
        ok = w < weeks
        np.add.at(sim, (np.arange(sims)[ok], w[ok]), inv.amount)
    cum_sim = np.cumsum(sim, axis=1)
    rows = []
    for w in range(weeks):
        rows.append(dict(week=week_starts[w].isoformat(), assumed=float(assumed[w]), expected=float(sim[:, w].mean()),
                         cum_assumed=float(assumed[:w + 1].sum()), cum_expected=float(cum_sim[:, w].mean()),
                         cum_low=float(np.percentile(cum_sim[:, w], 10)),
                         cum_high=float(np.percentile(cum_sim[:, w], 90))))
    return {"weeks": rows, "outstanding": float(sum(i.amount for i in invs))}


def summary(s: Session, org: Org) -> dict:
    t = today()
    invs = s.exec(select(Invoice).where(Invoice.org_id == org.id, Invoice.paid_date.is_(None))).all()
    fc = forecast(s, org.id, weeks=5)
    w4 = fc["weeks"][3] if len(fc["weeks"]) > 3 else None
    overdue = [i for i in invs if i.due_date < t]
    past45 = [i for i in invs if i.p_late is not None and
              (i.due_date + timedelta(days=round(i.exp_days_late or 0)) - i.invoice_date).days > 45]
    paid90 = s.exec(select(Invoice).where(Invoice.org_id == org.id, Invoice.paid_date >= t - timedelta(days=90))).all()
    collected90 = sum(i.amount for i in paid90)
    dso = (sum(i.amount for i in invs) / (collected90 / 90)) if collected90 else None
    return dict(
        outstanding=sum(i.amount for i in invs), open_count=len(invs),
        overdue=sum(i.amount for i in overdue), overdue_count=len(overdue),
        at_risk=sum(i.amount * (i.p_late or 0) for i in invs),
        high_risk_count=sum(1 for i in invs if (i.p_late or 0) >= 0.5),
        past_45_amount=sum(i.amount for i in past45), past_45_count=len(past45),
        interest_cost=sum(i.amount * org.cost_of_capital * max(i.exp_days_late or 0, 0) / 365 for i in invs),
        cash_gap_4w=(w4["cum_assumed"] - w4["cum_expected"]) if w4 else 0,
        expected_4w=w4["cum_expected"] if w4 else 0, assumed_4w=w4["cum_assumed"] if w4 else 0,
        gap_date=(date.fromisoformat(w4["week"]) + timedelta(days=6)).isoformat() if w4 else None,
        dso=dso, collected_90d=collected90,
    )


def today_list(s: Session, org: Org, limit: int = 8, base: str | None = None) -> list[dict]:
    t = today()
    recent = {lg.invoice_id for lg in s.exec(select(ActionLog).where(
        ActionLog.org_id == org.id, ActionLog.created_at >= utcnow() - timedelta(days=3))).all()}
    invs = s.exec(select(Invoice).where(Invoice.org_id == org.id, Invoice.paid_date.is_(None),
                                        Invoice.priority > 0).order_by(Invoice.priority.desc()).limit(80)).all()
    buyers = {b.id: b for b in s.exec(select(Buyer).where(Buyer.org_id == org.id)).all()}
    open_by_buyer: dict[int, list[Invoice]] = {}
    for inv in s.exec(select(Invoice).where(Invoice.org_id == org.id, Invoice.paid_date.is_(None))).all():
        open_by_buyer.setdefault(inv.buyer_id, []).append(inv)
    out, seen = [], set()
    for inv in invs:
        # one card per customer: you call a customer once about everything they owe
        if inv.id in recent or inv.buyer_id in seen or (inv.snoozed_until and inv.snoozed_until > t):
            continue
        seen.add(inv.buyer_id)
        v = invoice_view(inv, buyers[inv.buyer_id], t, org, base=base)
        others = [o for o in open_by_buyer.get(inv.buyer_id, []) if o.id != inv.id]
        v["other_open_count"] = len(others)
        v["other_open_amount"] = sum(o.amount for o in others)
        out.append(v)
        if len(out) >= limit:
            break
    return out


def buyer_scorecard(s: Session, org_id: int) -> list[dict]:
    t = today()
    buyers = s.exec(select(Buyer).where(Buyer.org_id == org_id)).all()
    invs = s.exec(select(Invoice).where(Invoice.org_id == org_id)).all()
    by = {}
    for i in invs:
        by.setdefault(i.buyer_id, []).append(i)
    out = []
    for b in buyers:
        rows = by.get(b.id, [])
        paid = sorted([i for i in rows if i.paid_date and i.paid_date >= t - timedelta(days=365)], key=lambda i: i.paid_date)
        open_ = [i for i in rows if not i.paid_date]
        late = [(i.paid_date - i.due_date).days for i in paid]
        avg = float(np.mean(late)) if late else None
        pct = float(np.mean([x > 15 for x in late])) if late else None
        recent = float(np.mean(late[-3:])) if late else None
        score = None if avg is None else float(np.clip(100 - np.clip(avg, 0, 60) * 1.2 - pct * 28, 0, 100))
        grade = None if score is None else "A" if score >= 80 else "B" if score >= 60 else "C" if score >= 40 else "D"
        advice = {"A": "Reliable payer - you can safely offer longer credit.",
                  "B": "Pays with small delays - standard terms, send reminders before due date.",
                  "C": "Often late - shorten credit terms or ask part-advance on big orders.",
                  "D": "High risk - take advance, or sell their invoices on TReDS.",
                  None: "Not enough payment history yet."}[grade]
        trend = None if recent is None or avg is None else ("worse" if recent > avg + 7 else "better" if recent < avg - 7 else "steady")
        out.append(dict(id=b.id, name=b.name, phone=b.phone, email=b.email, segment=b.segment,
                         is_government=b.is_government, treds_onboarded=b.treds_onboarded,
                         invoices_12m=len(paid), avg_days_late=avg, pct_late15=pct, recent_days_late=recent,
                         trend=trend, score=score, grade=grade, advice=advice,
                         open_amount=sum(i.amount for i in open_), open_count=len(open_),
                         at_risk=sum(i.amount * (i.p_late or 0) for i in open_),
                         overdue_amount=sum(i.amount for i in open_ if i.due_date < t)))
    return sorted(out, key=lambda r: -r["at_risk"])


NUDGES = ("REMINDER", "EARLY_PAY_OFFER", "LEGAL_NUDGE", "SAMADHAAN", "TREDS", "RESOLVE_DISPUTE", "FIX_DOCS")


def impact(s: Session, org: Org, brief: bool = False) -> dict:
    """What PayPredict has done for this business, measured against the AI's own forecast at the
    moment each action was taken (not against 'everything that got paid')."""
    t = today()
    logs = s.exec(select(ActionLog).where(ActionLog.org_id == org.id).order_by(ActionLog.created_at)).all()
    invs = {i.id: i for i in s.exec(select(Invoice).where(Invoice.org_id == org.id)).all()}
    first: dict[int, ActionLog] = {}
    for lg in logs:
        if lg.kind in NUDGES and lg.invoice_id not in first:
            first[lg.invoice_id] = lg
    collected = collected_n = 0
    days_saved = interest_saved = 0.0
    for inv_id, lg in first.items():
        inv = invs.get(inv_id)
        if not inv or not inv.paid_date:
            continue
        acted = lg.created_at.date()
        if inv.paid_date >= acted and (inv.paid_date - acted).days <= 30:
            collected += inv.amount
            collected_n += 1
        if lg.predicted_days_late is not None:
            saved = float(np.clip(lg.predicted_days_late - (inv.paid_date - inv.due_date).days, 0, 60))
            days_saved += saved
            interest_saved += inv.amount * org.cost_of_capital * saved / 365
    claims = [lg for lg in logs if lg.kind == "PAYMENT_CLAIMED"]
    upi_paid = {lg.invoice_id for lg in claims if invs.get(lg.invoice_id) and invs[lg.invoice_id].paid_date}
    out = dict(
        since=(logs[0].created_at.date() if logs else org.created_at.date()).isoformat(),
        actions_taken=sum(1 for lg in logs if lg.kind in NUDGES), invoices_actioned=len(first),
        collected_after_action=collected, collected_count=collected_n,
        days_saved=days_saved, avg_days_saved=(days_saved / collected_n) if collected_n else None,
        interest_saved=interest_saved, upi_claims=len(claims),
        upi_collected=sum(invs[i].amount for i in upi_paid),
    )
    if brief:
        return out
    # 12-month trend of collection time (DSO) and share of invoices paid 15+ days late, from the ledger
    df = pd.DataFrame([dict(inv=i.invoice_date, due=i.due_date, paid=i.paid_date, amt=i.amount) for i in invs.values()])
    trend = []
    if not df.empty:
        for c in ("inv", "due", "paid"):
            df[c] = pd.to_datetime(df[c])
        for k in range(11, -1, -1):
            m_end = (pd.Timestamp(t).to_period("M") - k).to_timestamp(how="end").normalize()
            if m_end > pd.Timestamp(t):
                m_end = pd.Timestamp(t)
            issued = df["inv"] <= m_end
            open_ = issued & (df["paid"].isna() | (df["paid"] > m_end))
            sales90 = df.loc[(df["inv"] > m_end - pd.Timedelta(days=90)) & issued, "amt"].sum()
            paid_m = df[(df["paid"] > m_end - pd.offsets.MonthBegin(1)) & (df["paid"] <= m_end)]
            late = ((paid_m["paid"] - paid_m["due"]).dt.days > 15).mean() if len(paid_m) else None
            trend.append(dict(month=m_end.strftime("%b %y"),
                              dso=float(df.loc[open_, "amt"].sum() / sales90 * 90) if sales90 else None,
                              late_share=float(late) if late is not None else None))
    out["trend"] = trend
    return out


def notice_data(s: Session, org: Org, b: Buyer) -> dict:
    """Everything needed for a formal MSMED Act demand notice covering all of a customer's overdue invoices."""
    t = today()
    rows, principal, interest = [], 0.0, 0.0
    for inv in s.exec(select(Invoice).where(Invoice.buyer_id == b.id, Invoice.paid_date.is_(None))
                      .order_by(Invoice.invoice_date)).all():
        it = P.msmed_interest(inv.amount, inv.invoice_date, inv.due_date, t, org.bank_rate)
        if not it["applies"]:
            continue
        rows.append(dict(number=inv.number, invoice_date=inv.invoice_date.isoformat(), due_date=inv.due_date.isoformat(),
                         amount=inv.amount, interest_from=it["from"], days=it["days"], interest=it["interest"]))
        principal += inv.amount
        interest += it["interest"]
    return dict(
        date=t.isoformat(), reply_by=(t + timedelta(days=15)).isoformat(),
        reference=f"PP/{org.id}/{b.id}/{t:%Y%m%d}",
        seller=dict(name=org.sender_name or org.name, udyam=org.udyam_number, gstin=org.gstin, address=org.address,
                    phone=org.contact_phone, upi=org.upi_id),
        buyer=dict(name=b.name, contact=b.contact_person, email=b.email, is_government=b.is_government),
        rate=3 * org.bank_rate, bank_rate=org.bank_rate, invoices=rows,
        principal=principal, interest=round(interest, 2), total=round(principal + interest, 2),
        udyam_registered=org.udyam_registered,
    )


def insights(s: Session, org_id: int) -> dict:
    logs = s.exec(select(ActionLog).where(ActionLog.org_id == org_id)).all()
    invs = {i.id: i for i in s.exec(select(Invoice).where(Invoice.org_id == org_id)).all()}
    stats = {}
    for lg in logs:
        if lg.kind not in A.ACTIONS or lg.kind == "MONITOR":
            continue
        st = stats.setdefault(lg.kind, dict(kind=lg.kind, title=A.ACTIONS[lg.kind][0], sent=0, matured=0, paid10=0, days=[]))
        st["sent"] += 1
        inv = invs.get(lg.invoice_id)
        if inv and inv.paid_date:
            d = (inv.paid_date - lg.created_at.date()).days
            if d >= 0:
                st["days"].append(d)
            st["paid10"] += int(0 <= d <= 10)
        if (today() - lg.created_at.date()).days >= 10 or (inv and inv.paid_date):
            st["matured"] += 1
    rows = []
    for st in stats.values():
        rows.append(dict(kind=st["kind"], title=st["title"], sent=st["sent"],
                         success_rate=(st["paid10"] / st["matured"]) if st["matured"] else None,
                         avg_days_to_pay=float(np.mean(st["days"])) if st["days"] else None))
    recovered = sum(invs[lg.invoice_id].amount for lg in logs if lg.kind == "PAID" and lg.invoice_id in invs)
    return {"actions": sorted(rows, key=lambda r: -r["sent"]), "actions_taken": len([l for l in logs if l.kind in A.ACTIONS]),
            "recovered_after_action": recovered}
