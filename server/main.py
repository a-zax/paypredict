"""PayPredict API (FastAPI). Run: uvicorn server.main:app --reload"""
import json
import re
import secrets
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field as PField
from sqlmodel import Session, select

from . import actions as A
from . import agent, assistant, credit, ingest
from . import payments as P
from . import services as S
from .config import PUBLIC_URL, SECRET
from .db import ROOT, ActionLog, Buyer, Invoice, ModelRun, Org, User, as_dict, get_session, init_db, utcnow

class CleanJSONResponse(JSONResponse):
    """House style: plain hyphens only. Every API response passes through here, so long dashes from
    stored text, uploaded ledgers or AI replies never reach the screen."""
    _dash = re.compile("[‒–—―−]")

    def render(self, content) -> bytes:
        text = json.dumps(content, ensure_ascii=False, allow_nan=False, separators=(",", ":"), default=str)
        return self._dash.sub("-", text.replace(" — ", " - ").replace(" – ", " - ")).encode("utf-8")


app = FastAPI(title="PayPredict API", version="2.0", default_response_class=CleanJSONResponse)
init_db()
bearer = HTTPBearer(auto_error=False)

CSP = ("default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
       "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(self), geolocation=()")
    if not request.url.path.startswith("/api"):
        resp.headers.setdefault("Content-Security-Policy", CSP)
    if request.url.scheme == "https":
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return resp


class RateLimiter:
    """In-memory sliding window (per process). Stops password guessing and pay-page spam."""
    def __init__(self, limit: int, window_s: int):
        self.limit, self.window, self.hits = limit, window_s, {}

    def check(self, key: str):
        now = datetime.now(timezone.utc).timestamp()
        q = [t for t in self.hits.get(key, []) if now - t < self.window]
        if len(q) >= self.limit:
            raise HTTPException(429, "Too many attempts - please wait a few minutes and try again.")
        q.append(now)
        self.hits[key] = q


login_limiter = RateLimiter(limit=8, window_s=15 * 60)
claim_limiter = RateLimiter(limit=5, window_s=60 * 60)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")


def base_url(request: Request) -> str:
    return PUBLIC_URL or str(request.base_url).rstrip("/")


# ------------------------------------------------------------------ auth
def make_token(user: User) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=14)
    return jwt.encode({"sub": str(user.id), "org": user.org_id, "exp": exp}, SECRET, algorithm="HS256")


def current(cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
            s: Session = Depends(get_session)) -> tuple[User, Org]:
    if not cred:
        raise HTTPException(401, "Please log in")
    try:
        data = jwt.decode(cred.credentials, SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired - please log in again")
    user = s.get(User, int(data["sub"]))
    if not user:
        raise HTTPException(401, "Account not found")
    return user, s.get(Org, user.org_id)


class SignupIn(BaseModel):
    name: str = PField(min_length=1, max_length=80)
    email: EmailStr
    password: str = PField(min_length=8, max_length=128)
    business_name: str = PField(min_length=1, max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


def me_payload(user: User, org: Org) -> dict:
    _ = user.id
    return {"user": {"id": user.id, "name": user.name, "email": user.email},
            "org": as_dict(org), "assistant_enabled": assistant.configured()}


@app.post("/api/auth/signup")
def signup(body: SignupIn, s: Session = Depends(get_session)):
    email = body.email.lower()
    if s.exec(select(User).where(User.email == email)).first():
        raise HTTPException(409, "An account with this email already exists")
    org = Org(name=body.business_name.strip(), sender_name=body.business_name.strip())
    s.add(org)
    s.flush()
    user = User(org_id=org.id, email=email, name=body.name.strip(),
                password_hash=bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode())
    s.add(user)
    s.commit()
    return {"token": make_token(user), **me_payload(user, org)}


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, s: Session = Depends(get_session)):
    login_limiter.check(f"{client_ip(request)}|{body.email.lower()}")
    user = s.exec(select(User).where(User.email == body.email.lower())).first()
    if not user or not bcrypt.checkpw(body.password.encode(), user.password_hash.encode()):
        raise HTTPException(401, "Wrong email or password")
    return {"token": make_token(user), **me_payload(user, s.get(Org, user.org_id))}


DEMO_EMAIL = "demo@paypredict.app"
# The demo pay page shows a scannable QR, but it holds plain text, not a UPI payment link.
DEMO_QR_TEXT = "PayPredict demo: this QR is a sample. In a real account it opens your UPI app with the amount filled in."
demo_limiter = RateLimiter(limit=30, window_s=60 * 60)
_demo_lock = threading.Lock()


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


@app.post("/api/auth/demo")
def demo_login(request: Request, s: Session = Depends(get_session)):
    """One-click public demo: a shared fictional business, refreshed with sample data every 24 hours."""
    demo_limiter.check(client_ip(request))
    with _demo_lock:
        user = s.exec(select(User).where(User.email == DEMO_EMAIL)).first()
        if not user:
            org = Org(name="Sahyadri Packaging Solutions (Demo)", sender_name="Sahyadri Packaging Solutions", is_demo=True)
            s.add(org)
            s.flush()
            user = User(org_id=org.id, email=DEMO_EMAIL, name="Demo Visitor",
                        password_hash=bcrypt.hashpw(secrets.token_bytes(24), bcrypt.gensalt()).decode())  # no usable password
            s.add(user)
            s.commit()
        org = s.get(Org, user.org_id)
        stale = not org.onboarded or not org.demo_reset_at or utcnow() - _aware(org.demo_reset_at) > timedelta(hours=24)
        if stale:
            S.load_sample(s, org)
            org.upi_id = "demo@paypredict"                 # not a real UPI handle; pay pages are disabled for the demo
            org.udyam_number, org.gstin = "UDYAM-MH-00-0000000", "27AAAAA0000A1Z5"
            org.address, org.contact_phone = "Plot 12, MIDC Bhosari, Pune 411026 (fictional)", "+91 00000 00000"
            org.demo_reset_at = utcnow()
            s.add(org)
            s.commit()
    return {"token": make_token(user), **me_payload(user, org)}


@app.get("/api/me")
def me(ctx=Depends(current)):
    return me_payload(*ctx)


# ------------------------------------------------------------------ org settings
class OrgPatch(BaseModel):
    name: Optional[str] = None
    sender_name: Optional[str] = None
    udyam_registered: Optional[bool] = None
    cost_of_capital: Optional[float] = PField(None, ge=0.01, le=0.5)
    treds_rate: Optional[float] = PField(None, ge=0.01, le=0.5)
    early_pay_discount: Optional[float] = PField(None, ge=0.0, le=0.1)
    relationship_first: Optional[bool] = None
    language: Optional[str] = PField(None, pattern="^(en|hi|mr)$")
    upi_id: Optional[str] = PField(None, max_length=100)
    udyam_number: Optional[str] = PField(None, max_length=40)
    gstin: Optional[str] = PField(None, max_length=20)
    address: Optional[str] = PField(None, max_length=300)
    contact_phone: Optional[str] = PField(None, max_length=20)
    bank_rate: Optional[float] = PField(None, ge=0.01, le=0.2)


def no_demo(org: Org, what: str):
    """The demo business is shared by every visitor: nobody may change what everyone else sees."""
    if org.is_demo:
        raise HTTPException(403, f"{what} is turned off in the shared demo. Create your own free account to try it.")


@app.patch("/api/org")
def patch_org(body: OrgPatch, ctx=Depends(current), s: Session = Depends(get_session)):
    _, org = ctx
    no_demo(org, "Changing settings")
    data = body.model_dump(exclude_none=True)
    if "upi_id" in data:
        data["upi_id"] = data["upi_id"].strip()
        if data["upi_id"] and not P.valid_vpa(data["upi_id"]):
            raise HTTPException(400, "That doesn't look like a UPI ID (it should look like name@bank).")
    if "gstin" in data:
        data["gstin"] = data["gstin"].strip().upper()
    for k, v in data.items():
        setattr(org, k, v)
    s.add(org)
    s.commit()
    S.rescore(s, org)
    return as_dict(org)


# ------------------------------------------------------------------ onboarding / import
@app.post("/api/import/sample")
def import_sample(ctx=Depends(current), s: Session = Depends(get_session)):
    no_demo(ctx[1], "Reloading data")
    return S.load_sample(s, ctx[1])


@app.post("/api/import/preview")
async def import_preview(file: UploadFile = File(...), ctx=Depends(current)):
    no_demo(ctx[1], "Uploading a ledger")
    content = await file.read()
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 15 MB)")
    try:
        df = ingest.read_table(content, file.filename or "upload.csv")
    except Exception as e:
        raise HTTPException(400, f"Couldn't read this file: {e}")
    mapping = ingest.detect_mapping(df.columns)
    preview = None
    rows, issues = ingest.normalise(df, mapping)
    if rows is not None:
        preview = dict(rows=len(rows), customers=int(rows["buyer"].nunique()),
                       paid=int(rows["paid_date"].notna().sum()), open=int(rows["paid_date"].isna().sum()),
                       total_open=float(rows.loc[rows["paid_date"].isna(), "amount"].sum()))
    return {"columns": list(df.columns), "mapping": mapping, "rows": len(df),
            "sample": df.head(5).fillna("").astype(str).to_dict(orient="records"),
            "fields": [{"key": k, "label": ingest.LABELS[k], "required": req} for k, (req, _) in ingest.FIELDS.items()],
            "preview": preview, "issues": issues}


@app.post("/api/import/commit")
async def import_commit(file: UploadFile = File(...), mapping: str = Form(...),
                        default_credit_days: int = Form(30), ctx=Depends(current), s: Session = Depends(get_session)):
    no_demo(ctx[1], "Uploading a ledger")
    df = ingest.read_table(await file.read(), file.filename or "upload.csv")
    rows, issues = ingest.normalise(df, json.loads(mapping), default_credit_days)
    if rows is None:
        raise HTTPException(400, issues[0])
    result = S.import_rows(s, ctx[1], rows)
    return {**result, "issues": issues}


@app.get("/api/import/template.csv", response_class=PlainTextResponse)
def template():
    return PlainTextResponse(ingest.TEMPLATE_CSV, headers={"Content-Disposition": "attachment; filename=paypredict_template.csv"})


@app.post("/api/reset")
def reset(ctx=Depends(current), s: Session = Depends(get_session)):
    _, org = ctx
    no_demo(org, "Deleting data")
    S.clear_org(s, org)
    org.onboarded = False
    s.add(org)
    s.commit()
    return {"ok": True}


# ------------------------------------------------------------------ dashboard
@app.get("/api/today")
def today(request: Request, ctx=Depends(current), s: Session = Depends(get_session)):
    _, org = ctx
    S.ensure_fresh(s, org)
    return {"summary": S.summary(s, org), "actions": S.today_list(s, org, base=base_url(request)),
            "impact": S.impact(s, org, brief=True), "date": S.today().isoformat()}


@app.get("/api/forecast")
def forecast(weeks: int = 12, ctx=Depends(current), s: Session = Depends(get_session)):
    S.ensure_fresh(s, ctx[1])
    return S.forecast(s, ctx[1].id, weeks=max(1, min(weeks, 26)))


@app.get("/api/invoices")
def invoices(status: str = "open", q: str = "", risk: str = "", buyer_id: Optional[int] = None,
             sort: str = "priority", limit: int = 200, ctx=Depends(current), s: Session = Depends(get_session)):
    _, org = ctx
    S.ensure_fresh(s, org)
    t = S.today()
    query = select(Invoice).where(Invoice.org_id == org.id)
    if status == "open":
        query = query.where(Invoice.paid_date.is_(None))
    elif status == "overdue":
        query = query.where(Invoice.paid_date.is_(None), Invoice.due_date < t)
    elif status == "paid":
        query = query.where(Invoice.paid_date.is_not(None))
    if buyer_id:
        query = query.where(Invoice.buyer_id == buyer_id)
    buyers = {b.id: b for b in s.exec(select(Buyer).where(Buyer.org_id == org.id)).all()}
    rows = [S.invoice_view(i, buyers[i.buyer_id], t) for i in s.exec(query).all()]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in r["buyer_name"].lower() or ql in r["number"].lower()]
    if risk:
        rows = [r for r in rows if r["risk_band"] == risk]
    key = {"priority": lambda r: -r["priority"], "amount": lambda r: -r["amount"], "due": lambda r: r["due_date"],
           "risk": lambda r: -r["risk"], "recent": lambda r: r["invoice_date"]}.get(sort, lambda r: -r["priority"])
    rows.sort(key=key, reverse=(sort == "recent"))
    return {"total": len(rows), "amount": sum(r["amount"] for r in rows), "items": rows[:limit]}


@app.get("/api/invoices/counts")
def invoice_counts(ctx=Depends(current), s: Session = Depends(get_session)):
    """Numbers shown on the filter tabs."""
    _, org = ctx
    t = S.today()
    invs = s.exec(select(Invoice).where(Invoice.org_id == org.id)).all()
    open_ = [i for i in invs if not i.paid_date]
    return {"open": len(open_), "overdue": sum(1 for i in open_ if i.due_date < t),
            "high": sum(1 for i in open_ if (i.p_late or 0) >= 0.5), "paid": len(invs) - len(open_)}


def _own_invoice(s: Session, org: Org, inv_id: int) -> Invoice:
    inv = s.get(Invoice, inv_id)
    if not inv or inv.org_id != org.id:
        raise HTTPException(404, "Invoice not found")
    return inv


@app.get("/api/invoices/{inv_id}")
def invoice(inv_id: int, request: Request, lang: Optional[str] = None, ctx=Depends(current),
            s: Session = Depends(get_session)):
    _, org = ctx
    inv = _own_invoice(s, org, inv_id)
    b = s.get(Buyer, inv.buyer_id)
    v = S.invoice_view(inv, b, S.today(), org, lang if lang in ("en", "hi", "mr") else None, base=base_url(request))
    logs = s.exec(select(ActionLog).where(ActionLog.invoice_id == inv.id).order_by(ActionLog.created_at)).all()
    v["timeline"] = ([{"kind": "RAISED", "at": inv.invoice_date.isoformat(), "note": "Invoice raised"},
                      {"kind": "DUE", "at": inv.due_date.isoformat(), "note": "Due date"}]
                     + [{"kind": lg.kind, "at": lg.created_at.isoformat(), "note": lg.note, "channel": lg.channel} for lg in logs])
    v["timeline"].sort(key=lambda e: e["at"])
    v["pmf"] = json.loads(inv.pmf or "[]")
    v["buyer"] = next((c for c in S.buyer_scorecard(s, org.id) if c["id"] == b.id), None)
    return v


class ActionIn(BaseModel):
    kind: str
    channel: str = ""
    note: str = PField("", max_length=500)
    when: Optional[date] = None


@app.post("/api/invoices/{inv_id}/log")
def log_action(inv_id: int, body: ActionIn, ctx=Depends(current), s: Session = Depends(get_session)):
    """Record what the user did: sent a nudge, got a promise, got paid, snoozed, flagged a dispute..."""
    user, org = ctx
    inv = _own_invoice(s, org, inv_id)
    t = S.today()
    kind = body.kind.upper()
    note = body.note
    if kind == "PAID":
        inv.paid_date = body.when or t
        note = note or f"Payment received on {inv.paid_date:%d %b %Y}" + (
            f" (UPI ref {inv.claim_ref})" if inv.claim_ref else "")
        inv.claim_at, inv.claim_ref = None, ""
    elif kind == "CLAIM_REJECTED":
        inv.claim_at, inv.claim_ref = None, ""
        note = note or "Payment not found in bank - follow-ups resumed"
    elif kind == "PROMISE":
        if not body.when:
            raise HTTPException(400, "Promise date required")
        inv.promise_date = body.when
        note = note or f"Customer promised to pay by {body.when:%d %b %Y}"
    elif kind == "SNOOZE":
        inv.snoozed_until = body.when or t + timedelta(days=3)
        note = note or f"Snoozed until {inv.snoozed_until:%d %b}"
    elif kind in ("DISPUTE", "DISPUTE_RESOLVED"):
        inv.disputed = kind == "DISPUTE"
        note = note or ("Dispute raised" if inv.disputed else "Dispute resolved")
    elif kind in ("DOCS_PENDING", "DOCS_OK"):
        inv.docs_pending = kind == "DOCS_PENDING"
        note = note or ("Paperwork pending" if inv.docs_pending else "Paperwork completed")
    elif kind not in A.ACTIONS and kind != "NOTE":
        raise HTTPException(400, "Unknown action")
    s.add(ActionLog(org_id=org.id, invoice_id=inv.id, buyer_id=inv.buyer_id, kind=kind, channel=body.channel,
                    note=note, created_by=user.id,
                    # snapshot of the AI forecast at the moment of acting, for honest impact measurement
                    predicted_days_late=inv.exp_days_late if kind in A.ACTIONS else None, amount=inv.amount))
    s.add(inv)
    s.commit()
    if kind in ("PAID", "PROMISE", "DISPUTE", "DISPUTE_RESOLVED", "DOCS_PENDING", "DOCS_OK", "CLAIM_REJECTED") \
            or kind in A.LADDER:
        S.rescore(s, org)
    return {"ok": True}


@app.post("/api/invoices/{inv_id}/undo")
def undo_last(inv_id: int, ctx=Depends(current), s: Session = Depends(get_session)):
    """Undo the most recent thing the user did on this invoice (buyer-side claims can't be undone here)."""
    _, org = ctx
    inv = _own_invoice(s, org, inv_id)
    lg = s.exec(select(ActionLog).where(ActionLog.invoice_id == inv.id, ActionLog.kind != "PAYMENT_CLAIMED")
                .order_by(ActionLog.created_at.desc(), ActionLog.id.desc())).first()
    if not lg:
        raise HTTPException(404, "Nothing to undo")
    k = lg.kind
    if k == "PAID":
        inv.paid_date = None
    elif k == "PROMISE":
        prev = s.exec(select(ActionLog).where(ActionLog.invoice_id == inv.id, ActionLog.kind == "PROMISE", ActionLog.id != lg.id)
                      .order_by(ActionLog.id.desc())).first()
        inv.promise_date = None
        if prev and prev.note:   # restore an earlier promise if there was one
            try:
                inv.promise_date = datetime.strptime(prev.note.rsplit("by ", 1)[1], "%d %b %Y").date()
            except (IndexError, ValueError):
                pass
    elif k == "SNOOZE":
        inv.snoozed_until = None
    elif k in ("DISPUTE", "DISPUTE_RESOLVED"):
        inv.disputed = k != "DISPUTE"
    elif k in ("DOCS_PENDING", "DOCS_OK"):
        inv.docs_pending = k != "DOCS_PENDING"
    elif k == "CLAIM_REJECTED":
        claim = s.exec(select(ActionLog).where(ActionLog.invoice_id == inv.id, ActionLog.kind == "PAYMENT_CLAIMED")
                       .order_by(ActionLog.id.desc())).first()
        if claim:
            inv.claim_at = _aware(claim.created_at)     # DB returns naive UTC; SQLModel requires tz-aware
            inv.claim_ref = claim.note.rsplit("ref ", 1)[1] if "ref " in claim.note else ""
    s.delete(lg)
    s.add(inv)
    s.commit()
    S.rescore(s, org)
    return {"ok": True, "undone": k}


@app.get("/api/setup")
def setup_status(ctx=Depends(current), s: Session = Depends(get_session)):
    """Getting-started checklist state, derived from real data (not ticked by hand)."""
    _, org = ctx
    cards = S.buyer_scorecard(s, org.id)
    top = [c for c in cards if c["open_amount"] > 0][:20]
    logs = s.exec(select(ActionLog).where(ActionLog.org_id == org.id)).all()
    return {
        "upi": bool(org.upi_id), "legal_details": bool(org.udyam_number and org.address),
        "phones": sum(1 for c in top if c["phone"]), "phones_needed": len(top),
        "first_action": any(lg.kind in S.NUDGES for lg in logs),
        "customers": len(cards),
    }


@app.get("/api/buyers")
def buyers(ctx=Depends(current), s: Session = Depends(get_session)):
    S.ensure_fresh(s, ctx[1])
    return S.buyer_scorecard(s, ctx[1].id)


class BuyerPatch(BaseModel):
    phone: Optional[str] = None
    email: Optional[str] = None
    contact_person: Optional[str] = None
    is_government: Optional[bool] = None
    treds_onboarded: Optional[bool] = None
    language: Optional[str] = PField(None, pattern="^(en|hi|mr)?$")


@app.patch("/api/buyers/{buyer_id}")
def patch_buyer(buyer_id: int, body: BuyerPatch, ctx=Depends(current), s: Session = Depends(get_session)):
    _, org = ctx
    b = s.get(Buyer, buyer_id)
    if not b or b.org_id != org.id:
        raise HTTPException(404, "Customer not found")
    data = body.model_dump(exclude_none=True)
    if {"phone", "email", "contact_person"} & data.keys():
        no_demo(org, "Saving contact details")   # real people's numbers must not be visible to other demo visitors
    if "phone" in data:
        data["phone"] = ingest.safe_phone(data["phone"])
    for k, v in data.items():
        setattr(b, k, v)
    s.add(b)
    s.commit()
    if {"is_government", "treds_onboarded"} & data.keys():
        S.rescore(s, org)
    return {"ok": True}


@app.get("/api/buyers/{buyer_id}/history")
def buyer_history(buyer_id: int, ctx=Depends(current), s: Session = Depends(get_session)):
    _, org = ctx
    b = s.get(Buyer, buyer_id)
    if not b or b.org_id != org.id:
        raise HTTPException(404, "Customer not found")
    invs = s.exec(select(Invoice).where(Invoice.buyer_id == b.id, Invoice.paid_date.is_not(None))
                  .order_by(Invoice.invoice_date)).all()
    return [{"number": i.number, "invoice_date": i.invoice_date.isoformat(), "amount": i.amount,
             "days_late": (i.paid_date - i.due_date).days} for i in invs]


@app.get("/api/model")
def model_info(ctx=Depends(current), s: Session = Depends(get_session)):
    _, org = ctx
    run = s.exec(select(ModelRun).where(ModelRun.org_id == org.id).order_by(ModelRun.trained_at.desc())).first()
    return {"kind": run.kind if run else None, "trained_at": run.trained_at.isoformat() if run else None,
            "metrics": json.loads(run.metrics) if run else {}, "insights": S.insights(s, org.id),
            "ai": S.ai_insights(s, org)}


@app.post("/api/model/retrain")
def retrain(ctx=Depends(current), s: Session = Depends(get_session)):
    return S.train_org(s, ctx[1])


class ChatIn(BaseModel):
    messages: list[dict]


@app.post("/api/assistant")
def chat(body: ChatIn, ctx=Depends(current), s: Session = Depends(get_session)):
    """Claude when a key is configured; otherwise the on-device PayPredict Agent - the assistant always works."""
    _, org = ctx
    if assistant.configured():
        out = assistant.chat(s, org, body.messages)
        if out.get("configured", True):
            return {**out, "engine": "claude"}
    question = next((m.get("content", "") for m in reversed(body.messages) if m.get("role") == "user"), "").strip()
    if not question:
        raise HTTPException(400, "Ask a question")
    return agent.run(s, org, question[:500])


@app.get("/api/briefing")
def briefing(ctx=Depends(current), s: Session = Depends(get_session)):
    """The agent's morning briefing: it investigates (summary, priorities, warnings) and writes it up."""
    _, org = ctx
    S.ensure_fresh(s, org)
    return agent.run(s, org, "brief me on today", force_intent="briefing")


@app.get("/api/alerts")
def alerts(ctx=Depends(current), s: Session = Depends(get_session)):
    return agent.customer_alerts(s, ctx[1], limit=8)


@app.get("/api/invoices/{inv_id}/explain")
def explain(inv_id: int, ctx=Depends(current), s: Session = Depends(get_session)):
    _, org = ctx
    return agent.explain_invoice(s, org, _own_invoice(s, org, inv_id))


@app.get("/api/health")
def health():
    return {"ok": True}


# ------------------------------------------------------------------ public UPI pay page (no login)
def _pay_invoice(token: str, s: Session) -> tuple[Invoice, Org, Buyer]:
    try:
        inv_id, org_id = P.read_pay_token(token, SECRET)
    except jwt.PyJWTError:
        raise HTTPException(404, "This payment link is not valid.")
    inv, org = s.get(Invoice, inv_id), s.get(Org, org_id)
    if not inv or not org or inv.org_id != org.id:
        raise HTTPException(404, "This payment link is not valid.")
    return inv, org, s.get(Buyer, inv.buyer_id)


@app.get("/api/pay/{token}")
def pay_page(token: str, offer: bool = False, s: Session = Depends(get_session)):
    inv, org, b = _pay_invoice(token, s)
    t = S.today()
    # Early-payment offer is honoured only while it's valid (7 days from today's reminder is the promise).
    discount = org.early_pay_discount if offer and inv.action == "EARLY_PAY_OFFER" else 0.0
    amount = round(inv.amount * (1 - discount), 2)
    payee = org.sender_name or org.name
    # Never show payable details for the shared demo: nobody should send real money to a fictional business.
    upi = P.upi_url(org.upi_id, payee, amount, f"Invoice {inv.number}") if org.upi_id and not org.is_demo else None
    return {
        "demo": org.is_demo,
        "seller": payee, "seller_gstin": org.gstin, "buyer": b.name, "invoice": inv.number,
        "invoice_date": inv.invoice_date.isoformat(), "due_date": inv.due_date.isoformat(),
        "amount": inv.amount, "discount": discount, "pay_amount": amount,
        "status": "paid" if inv.paid_date else ("claimed" if inv.claim_at else "due"),
        "overdue_days": max((t - inv.due_date).days, 0), "upi_id": "" if org.is_demo else org.upi_id, "upi_url": upi,
        "qr_svg": P.qr_svg(upi) if upi else (P.qr_svg(DEMO_QR_TEXT) if org.is_demo else None),
    }


class ClaimIn(BaseModel):
    reference: str = PField("", max_length=40)


@app.post("/api/pay/{token}/claim")
def pay_claim(token: str, body: ClaimIn, request: Request, s: Session = Depends(get_session)):
    """Buyer taps "I've paid". The seller confirms against their bank - nothing is marked paid automatically."""
    claim_limiter.check(f"{client_ip(request)}|{token}")
    inv, org, _ = _pay_invoice(token, s)
    if inv.paid_date:
        return {"ok": True, "status": "paid"}
    ref = "".join(ch for ch in body.reference if ch.isalnum())[:40]
    inv.claim_at, inv.claim_ref = utcnow(), ref
    s.add(ActionLog(org_id=org.id, invoice_id=inv.id, buyer_id=inv.buyer_id, kind="PAYMENT_CLAIMED", channel="upi",
                    note="Customer says they paid via UPI" + (f" - ref {ref}" if ref else ""), amount=inv.amount))
    s.add(inv)
    s.commit()
    S.rescore(s, org)
    return {"ok": True, "status": "claimed"}


# ------------------------------------------------------------------ legal notice, impact, credit check
@app.get("/api/buyers/{buyer_id}/notice")
def notice(buyer_id: int, ctx=Depends(current), s: Session = Depends(get_session)):
    _, org = ctx
    b = s.get(Buyer, buyer_id)
    if not b or b.org_id != org.id:
        raise HTTPException(404, "Customer not found")
    return S.notice_data(s, org, b)


@app.get("/api/impact")
def impact(ctx=Depends(current), s: Session = Depends(get_session)):
    return S.impact(s, ctx[1])


class CreditIn(BaseModel):
    buyer_id: Optional[int] = None
    new_customer: Optional[str] = PField(None, max_length=120)
    amount: float = PField(gt=0, le=1e10)
    credit_days: int = PField(30, ge=0, le=180)
    lang: Optional[str] = PField(None, pattern="^(en|hi|mr)$")


@app.post("/api/credit-check")
def credit_check(body: CreditIn, ctx=Depends(current), s: Session = Depends(get_session)):
    _, org = ctx
    if body.buyer_id:
        b = s.get(Buyer, body.buyer_id)
        if not b or b.org_id != org.id:
            raise HTTPException(404, "Customer not found")
    elif not body.new_customer:
        raise HTTPException(400, "Pick a customer or enter a new customer's name")
    return credit.check_order(s, org, body.buyer_id, body.new_customer, body.amount, body.credit_days, body.lang)


# ------------------------------------------------------------------ frontend (built SPA)
DIST = ROOT / "web" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
