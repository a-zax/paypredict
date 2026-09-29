"""
Ledger import: CSV / Excel exports from Tally, Zoho Books, Busy, Vyapar or a hand-kept sheet.
Columns are auto-detected from common names; the user confirms the mapping in the UI.
"""
import csv
import io
import re
from datetime import date, timedelta

import numpy as np
import pandas as pd

FIELDS = {  # field -> (required, synonyms)
    "buyer": (True, ["party's name", "party name", "party", "customer name", "customer", "buyer",
                     "debtor", "ledger name", "ledger", "client name", "client", "account name"]),
    "number": (True, ["invoice number", "invoice no", "invoice no.", "invoice #", "invoice#", "bill no",
                      "bill no.", "ref. no.", "ref no", "reference", "voucher no", "voucher no.", "invoice"]),
    "invoice_date": (True, ["invoice date", "bill date", "voucher date", "date", "inv date"]),
    "amount": (True, ["invoice amount", "bill amount", "amount", "total", "grand total", "net amount",
                      "opening amount", "value", "invoice value"]),
    "due_date": (False, ["due date", "due on", "payment due", "due by", "due"]),
    "credit_days": (False, ["credit days", "credit period", "payment terms", "terms", "due days"]),
    "paid_date": (False, ["paid date", "payment date", "paid on", "receipt date", "cleared on",
                          "settled on", "date of payment", "last payment date"]),
    "balance": (False, ["balance due", "balance", "pending amount", "pending", "outstanding",
                        "amount due", "due amount"]),
    "phone": (False, ["phone", "mobile", "whatsapp", "contact number", "phone number", "mobile no"]),
    "email": (False, ["email", "e-mail", "email id", "mail"]),
}
LABELS = {
    "buyer": "Customer / party name", "number": "Invoice number", "invoice_date": "Invoice date",
    "amount": "Invoice amount", "due_date": "Due date", "credit_days": "Credit days",
    "paid_date": "Payment date", "balance": "Balance due", "phone": "WhatsApp / phone", "email": "Email",
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).strip().lower())


def read_table(content: bytes, filename: str) -> pd.DataFrame:
    name = filename.lower()
    if name.endswith((".xlsx", ".xls", ".xlsm")):
        raw = pd.read_excel(io.BytesIO(content), header=None, dtype=str)
    else:
        text = content.decode("utf-8-sig", errors="replace")
        try:
            dialect = csv.Sniffer().sniff(text[:5000], delimiters=",;	|")
        except csv.Error:
            dialect = csv.excel
        rows = [r for r in csv.reader(io.StringIO(text), dialect)]
        width = max((len(r) for r in rows), default=0)       # title rows are shorter: pad them
        raw = pd.DataFrame([r + [None] * (width - len(r)) for r in rows], dtype=object)
        raw = raw.replace({"": None})
    # Tally/Zoho exports often have title rows above the header: pick the row that matches most synonyms.
    all_syn = {s for _, syns in FIELDS.values() for s in syns}
    best, best_hits = 0, -1
    for i in range(min(15, len(raw))):
        hits = sum(_norm(v) in all_syn for v in raw.iloc[i].tolist() if isinstance(v, str))
        if hits > best_hits:
            best, best_hits = i, hits
    df = raw.iloc[best + 1:].reset_index(drop=True)
    df.columns = [str(c).strip() if isinstance(c, str) else f"Column {j + 1}" for j, c in enumerate(raw.iloc[best])]
    df = df.dropna(how="all")
    return df.loc[:, ~df.columns.duplicated()]


def detect_mapping(columns) -> dict:
    mapping, used = {}, set()
    normed = {c: _norm(c) for c in columns}
    for field, (_, syns) in FIELDS.items():
        for syn in syns:                                  # exact match first, in priority order
            hit = next((c for c, n in normed.items() if n == syn and c not in used), None)
            if hit:
                break
        if not hit:
            hit = next((c for c, n in normed.items() if c not in used and any(syn in n for syn in syns[:3])), None)
        if hit:
            mapping[field] = hit
            used.add(hit)
    return mapping


def _dates(s: pd.Series) -> pd.Series:
    s = s.astype(str).str.strip().replace({"": None, "nan": None, "None": None, "-": None})
    # ISO dates (2026-06-01, Zoho / Excel / Python exports) are year-month-day and must NOT be read day-first;
    # everything else (01-06-2026, 01/06/26, 1-Jun-2026 - Tally, Busy, hand-kept sheets) is Indian day-first.
    iso = s.str.match(r"^\d{4}-\d{1,2}-\d{1,2}", na=False)
    out = pd.to_datetime(s.where(~iso), errors="coerce", dayfirst=True, format="mixed")
    out = out.fillna(pd.to_datetime(s.where(iso).str.slice(0, 10), errors="coerce", format="%Y-%m-%d"))
    serial = pd.to_numeric(s, errors="coerce")               # Excel serial numbers
    excel = pd.to_datetime("1899-12-30") + pd.to_timedelta(serial, unit="D")
    return out.fillna(excel.where(serial.between(20000, 80000)))


def _money(s: pd.Series) -> pd.Series:
    cleaned = (s.astype(str).str.replace(r"[₹,\s]|Rs\.?|INR", "", regex=True)
               .str.replace(r"\((.*)\)", r"-\1", regex=True).str.replace(r"(Dr|Cr)$", "", regex=True))
    return pd.to_numeric(cleaned, errors="coerce")


def normalise(df: pd.DataFrame, mapping: dict, default_credit_days: int = 30, today: date | None = None):
    """Return (clean_rows DataFrame, issues list). Clean columns: buyer, number, invoice_date, due_date,
    amount, paid_date, phone, email."""
    today = today or date.today()
    missing = [LABELS[f] for f, (req, _) in FIELDS.items() if req and not mapping.get(f)]
    if missing:
        return None, [f"Please map: {', '.join(missing)}"]
    col = lambda f: df[mapping[f]] if mapping.get(f) in df.columns else pd.Series([None] * len(df), index=df.index)
    out = pd.DataFrame({
        "buyer": col("buyer").astype(str).str.strip(),
        "number": col("number").astype(str).str.strip(),
        "invoice_date": _dates(col("invoice_date")),
        "amount": _money(col("amount")).abs(),
        "phone": col("phone").fillna("").astype(str).str.replace(r"[^\d+]", "", regex=True),
        "email": col("email").fillna("").astype(str).str.strip(),
    })
    due = _dates(col("due_date")) if mapping.get("due_date") else pd.Series(pd.NaT, index=df.index)
    days = pd.to_numeric(col("credit_days").astype(str).str.extract(r"(\d+)")[0], errors="coerce") \
        if mapping.get("credit_days") else pd.Series(np.nan, index=df.index)
    out["due_date"] = due.fillna(out["invoice_date"] + pd.to_timedelta(days.fillna(default_credit_days), unit="D"))
    out["paid_date"] = _dates(col("paid_date")) if mapping.get("paid_date") else pd.NaT
    if mapping.get("balance"):
        bal = _money(col("balance"))
        # Settled but no payment date given: we know it's paid, not when -> cannot be used for timing.
        out["_settled_no_date"] = (bal.fillna(1) == 0) & out["paid_date"].isna()
    else:
        out["_settled_no_date"] = False

    issues = []
    bad = out["buyer"].isin(["", "nan", "None"]) | out["invoice_date"].isna() | out["amount"].isna() | (out["amount"] <= 0)
    if bad.any():
        issues.append(f"Skipped {int(bad.sum())} row(s) with missing customer, date or amount (totals/blank rows).")
    out = out[~bad]
    future_paid = out["paid_date"] > pd.Timestamp(today)
    out.loc[future_paid, "paid_date"] = pd.NaT
    settled = out.pop("_settled_no_date")
    if settled.any():
        issues.append(f"{int(settled.sum())} settled invoice(s) have no payment date; they are kept out of "
                      "open invoices but can't teach the model timing. Export with receipt dates for best results.")
        out = out[~settled]
    out["number"] = out["number"].where(~out["number"].isin(["", "nan", "None"]),
                                        "AUTO-" + pd.Series(range(len(out)), index=out.index).astype(str))
    dup = out.duplicated(["buyer", "number"], keep="last")
    if dup.any():
        issues.append(f"Merged {int(dup.sum())} duplicate invoice row(s).")
        out = out[~dup]
    return out.reset_index(drop=True), issues


TEMPLATE_CSV = (
    "Customer Name,Invoice Number,Invoice Date,Due Date,Invoice Amount,Payment Date,WhatsApp,Email\n"
    "Example Traders Pvt Ltd,INV-1001,05-06-2026,05-07-2026,125000,18-07-2026,+919800000000,accounts@example.com\n"
    "Example Traders Pvt Ltd,INV-1042,12-08-2026,11-09-2026,98000,,+919800000000,accounts@example.com\n"
)


def sample_frame(today: date) -> pd.DataFrame:
    """The bundled demo ledger (fictional packaging MSME), shifted so it ends today."""
    from .db import ROOT
    inv = pd.read_csv(ROOT / "data" / "invoices.csv")
    buyers = pd.read_csv(ROOT / "data" / "buyers.csv")
    df = inv.merge(buyers, on="buyer_id")
    shift = pd.Timestamp(today) - pd.Timestamp("2026-09-29")
    for c in ("invoice_date", "due_date", "payment_date"):
        df[c] = pd.to_datetime(df[c]) + shift
    df["invoice_number"] = df["invoice_id"]
    return df


def safe_phone(p: str) -> str:
    digits = re.sub(r"\D", "", p or "")
    if len(digits) == 10:
        digits = "91" + digits
    return digits


def date_or_none(x):
    return None if pd.isna(x) else pd.Timestamp(x).date()


def days(n: int) -> timedelta:
    return timedelta(days=n)
