"""
Getting paid: UPI pay links (+QR) and MSMED Act interest.

UPI: WhatsApp doesn't make `upi://` links clickable, so messages carry an https link to a public
pay page (/pay/<signed token>) that opens any UPI app with the amount pre-filled. No payment gateway,
no fees; the buyer taps "I've paid" and the seller confirms against their bank statement.

MSMED Act, 2006: s.15 - pay within the agreed period, never more than 45 days from acceptance.
s.16 - beyond that, compound interest with monthly rests at 3x the RBI Bank Rate.
"""
import hashlib
import hmac
from datetime import date, timedelta
from urllib.parse import quote, urlencode

import jwt

PAY_AUDIENCE = "pay"


def _sig(invoice_id: int, org_id: int, secret: str) -> str:
    return hmac.new(secret.encode(), f"{PAY_AUDIENCE}:{invoice_id}:{org_id}".encode(), hashlib.sha256).hexdigest()[:16]


def pay_token(invoice_id: int, org_id: int, secret: str) -> str:
    """Short signed code (e.g. 11277-1-3fa9c2e81b04d7a6): long random links look like spam in WhatsApp.
    64-bit HMAC - can't be guessed or forged without the server secret."""
    return f"{invoice_id}-{org_id}-{_sig(invoice_id, org_id, secret)}"


def read_pay_token(token: str, secret: str) -> tuple[int, int]:
    try:
        inv, org, sig = token.split("-")
        inv_id, org_id = int(inv), int(org)
    except ValueError:
        raise jwt.InvalidTokenError("malformed")
    if not hmac.compare_digest(sig, _sig(inv_id, org_id, secret)):
        raise jwt.InvalidTokenError("bad signature")
    return inv_id, org_id


def upi_url(vpa: str, payee: str, amount: float, note: str) -> str:
    # No `tr` param: personal/SME VPAs are often rejected by apps when a merchant txn ref is present.
    q = {"pa": vpa, "pn": payee[:40], "am": f"{amount:.2f}", "cu": "INR", "tn": note[:50]}
    return "upi://pay?" + urlencode(q, quote_via=quote)


def qr_svg(data: str) -> str | None:
    try:
        import segno
    except ImportError:          # QR is a nice-to-have; the pay button works without it
        return None
    return segno.make(data, error="m").svg_inline(scale=5, dark="#0f172a", light="#ffffff", border=2)


def valid_vpa(vpa: str) -> bool:
    import re
    return bool(re.fullmatch(r"[A-Za-z0-9.\-_]{2,256}@[A-Za-z][A-Za-z0-9.]{1,64}", vpa or ""))


def msmed_interest(amount: float, invoice_date: date, due_date: date, asof: date, bank_rate: float) -> dict:
    """Interest a buyer owes under MSMED s.16 (estimate; acceptance date approximated by invoice date).
    Interest runs from the day after the agreed due date, capped at 45 days after acceptance."""
    appointed = min(due_date, invoice_date + timedelta(days=45))
    start = appointed + timedelta(days=1)
    days = (asof - appointed).days
    rate = 3 * bank_rate
    if days <= 0:
        return {"applies": False, "from": start.isoformat(), "days": 0, "rate": rate, "interest": 0.0, "total": amount}
    months = days / (365 / 12)
    interest = amount * ((1 + rate / 12) ** months - 1)
    return {"applies": True, "from": start.isoformat(), "days": days, "rate": rate,
            "interest": round(interest, 2), "total": round(amount + interest, 2)}


PAY_LINE = {
    "en": "Pay instantly by UPI (GPay / PhonePe / Paytm): {url}",
    "hi": "UPI से तुरंत भुगतान करें (GPay / PhonePe / Paytm): {url}",
    "mr": "UPI द्वारे लगेच पेमेंट करा (GPay / PhonePe / Paytm): {url}",
}
INTEREST_LINE = {
    "en": "Interest accrued under Section 16 as of today: {amt}.",
    "hi": "आज तक धारा 16 के तहत देय ब्याज: {amt}।",
    "mr": "आजपर्यंत कलम 16 नुसार देय व्याज: {amt}.",
}
