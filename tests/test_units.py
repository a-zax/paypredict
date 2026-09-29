"""Unit tests for money maths, business rules, ledger import and leakage-free features."""
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

from server import actions as A
from server import ingest, ml
from server import payments as P

SECRET = "unit-test-secret"
TODAY = date(2026, 9, 29)
ORG = dict(cost_of_capital=0.14, treds_rate=0.095, early_pay_discount=0.01, relationship_first=False,
           udyam_registered=True, name="Seller", sender_name="Seller")


# ---------------------------------------------------------------- payments
def test_msmed_interest_matches_hand_calculation():
    it = P.msmed_interest(100_000, date(2026, 6, 1), date(2026, 7, 1), date(2026, 8, 1), bank_rate=0.0575)
    assert it["applies"] and it["days"] == 31 and it["rate"] == pytest.approx(0.1725)
    expected = 100_000 * ((1 + 0.1725 / 12) ** (31 / (365 / 12)) - 1)
    assert it["interest"] == pytest.approx(expected, abs=0.01)


def test_msmed_interest_caps_credit_at_45_days():
    # 90-day agreed terms can't delay the appointed day beyond 45 days from acceptance
    it = P.msmed_interest(50_000, date(2026, 6, 1), date(2026, 8, 30), date(2026, 8, 1), bank_rate=0.0575)
    assert it["applies"] and it["from"] == "2026-07-17"


def test_no_interest_before_due():
    assert not P.msmed_interest(50_000, TODAY, TODAY + timedelta(days=30), TODAY, 0.0575)["applies"]


def test_pay_token_roundtrip_and_tamper():
    tok = P.pay_token(42, 7, SECRET)
    assert P.read_pay_token(tok, SECRET) == (42, 7)
    for bad in (tok[:-1] + ("0" if tok[-1] != "0" else "1"), tok.replace("42-", "43-", 1), "nonsense", "1-2-3-4"):
        with pytest.raises(Exception):
            P.read_pay_token(bad, SECRET)
    with pytest.raises(Exception):
        P.read_pay_token(tok, "another-secret")


@pytest.mark.parametrize("vpa,ok", [("shop@okhdfcbank", True), ("a.b-c_d@ybl", True), ("no-at-sign", False), ("x@1bank", False), ("", False)])
def test_vpa_validation(vpa, ok):
    assert P.valid_vpa(vpa) is ok


def test_upi_url_is_encoded():
    url = P.upi_url("shop@okhdfcbank", "Sahyadri & Sons", 1234.5, "Invoice INV-1")
    assert url.startswith("upi://pay?pa=shop%40okhdfcbank") and "am=1234.50" and "Sahyadri%20%26%20Sons" in url


# ---------------------------------------------------------------- decision rules
def _inv(**kw):
    base = dict(amount=200_000, invoice_date=TODAY - timedelta(days=40), due_date=TODAY - timedelta(days=10), p_late=0.8,
                exp_days_late=30.0, disputed=False, docs_pending=False, is_government=False, treds_onboarded=False, promise_date=None)
    return {**base, **kw}


def test_dispute_comes_first():
    assert A.recommend(_inv(disputed=True, treds_onboarded=True), ORG, TODAY)[0] == "RESOLVE_DISPUTE"


def test_promise_pauses_follow_ups():
    assert A.recommend(_inv(promise_date=TODAY + timedelta(days=3)), ORG, TODAY)[0] == "MONITOR"


def test_long_overdue_escalates_to_samadhaan():
    assert A.recommend(_inv(due_date=TODAY - timedelta(days=60), invoice_date=TODAY - timedelta(days=90)), ORG, TODAY)[0] == "SAMADHAAN"


def test_government_buyer_gets_no_43bh_line():
    action, why, _ = A.recommend(_inv(is_government=True), ORG, TODAY)
    assert action == "LEGAL_NUDGE" and "43B(h)" not in why
    msg = A.draft("LEGAL_NUDGE", dict(_inv(is_government=True), number="I-1", buyer_name="Govt"), ORG, "en", TODAY)
    assert "43B(h)" not in msg and "Section 15" in msg


def test_relationship_first_prefers_discount_over_legal():
    org = dict(ORG, relationship_first=True)
    inv = _inv(due_date=TODAY + timedelta(days=20), invoice_date=TODAY - timedelta(days=10), exp_days_late=40.0)
    assert A.recommend(inv, org, TODAY)[0] == "EARLY_PAY_OFFER"


def test_low_risk_is_left_alone():
    assert A.recommend(_inv(p_late=0.05, exp_days_late=0.0, due_date=TODAY + timedelta(days=10)), ORG, TODAY)[0] == "MONITOR"


def test_ladder_climbs_after_two_ignored_reminders():
    old = datetime.now(timezone.utc) - timedelta(days=20)
    hist = [dict(kind="REMINDER", created_at=old, paid_within_10d=False)] * 2
    assert A.ladder_floor(hist, TODAY) == 1
    assert A.ladder_floor([dict(kind="REMINDER", created_at=old, paid_within_10d=True)], TODAY) == 0


def test_messages_exist_in_all_languages():
    for action in ("REMINDER", "EARLY_PAY_OFFER", "LEGAL_NUDGE", "RESOLVE_DISPUTE", "FIX_DOCS", "SAMADHAAN"):
        for lang in ("en", "hi", "mr"):
            text = A.draft(action, dict(_inv(), number="INV-9", buyer_name="Kaveri Foods"), ORG, lang, TODAY)
            assert "INV-9" in text and "₹2,00,000" in text


def test_indian_rupee_format():
    assert A.inr(12345678) == "₹1,23,45,678" and A.inr(999) == "₹999"


# ---------------------------------------------------------------- ledger import
TALLY = ("Sahyadri Packaging\nBills Receivable\nDate,Ref. No.,Party's Name,Opening Amount,Due on,Payment Date\n"
         "01-07-2026,T-1,Kaveri Foods,\"1,20,000.00\",31-07-2026,15-08-2026\n"
         "05-08-2026,T-2,Kaveri Foods,\"₹85,500\",04-09-2026,\n,,Total,\"2,05,500\",,\n")


def test_tally_export_is_understood():
    df = ingest.read_table(TALLY.encode(), "bills.csv")
    m = ingest.detect_mapping(df.columns)
    assert m == {"buyer": "Party's Name", "number": "Ref. No.", "invoice_date": "Date", "amount": "Opening Amount",
                 "due_date": "Due on", "paid_date": "Payment Date"}
    rows, issues = ingest.normalise(df, m, today=TODAY)
    assert len(rows) == 2 and any("Skipped 1" in i for i in issues)          # the totals row
    assert rows.loc[0, "amount"] == 120_000 and rows.loc[1, "amount"] == 85_500
    assert rows.loc[0, "invoice_date"] == pd.Timestamp("2026-07-01")         # day-first dates
    assert pd.isna(rows.loc[1, "paid_date"])


def test_due_date_from_credit_days():
    csv = "Customer,Invoice No,Invoice Date,Amount,Credit Days\nA,1,2026-06-01,1000,45\n"
    df = ingest.read_table(csv.encode(), "x.csv")
    rows, _ = ingest.normalise(df, ingest.detect_mapping(df.columns), today=TODAY)
    assert rows.loc[0, "due_date"] == pd.Timestamp("2026-07-16")


# ---------------------------------------------------------------- model
def test_bins_edges():
    assert list(ml.bin_of([-5, 0, 1, 7, 8, 15, 16, 90, 91, 400])) == [0, 0, 1, 1, 2, 2, 3, 6, 7, 7]


def test_history_features_never_see_the_future():
    """An invoice's history features may only use payments received before its own invoice date."""
    df = pd.DataFrame(dict(
        id=[1, 2, 3], buyer_id=[1, 1, 1],
        invoice_date=["2026-01-01", "2026-02-01", "2026-03-10"], due_date=["2026-01-31", "2026-03-03", "2026-04-09"],
        amount=[100.0, 100.0, 100.0], paid_date=["2026-04-15", "2026-03-05", None],  # invoice 1 paid AFTER 2 and 3 were raised
        disputed=False, docs_pending=False, segment="Unknown", is_government=False, treds_onboarded=False))
    F = ml.build_features(df, TODAY).set_index("id")
    assert F.loc[2, "hist_n_paid"] == 0                 # nothing had been paid by 1 Feb
    assert F.loc[3, "hist_n_paid"] == 1                 # only invoice 2 (paid 5 Mar) - invoice 1's payment (15 Apr) is in the future
    assert F.loc[3, "hist_avg_days_late"] == 2
    assert F.loc[3, "open_overdue_count"] == 1          # invoice 1 was overdue and unpaid on 10 Mar


def test_iso_and_indian_dates_both_parse_correctly():
    s = pd.Series(["2026-06-01", "01-06-2026", "01/06/26", "1-Jun-2026", "46174"])   # last = Excel serial for 1 Jun 2026
    assert (ingest._dates(s) == pd.Timestamp("2026-06-01")).all()


def test_very_old_unpaid_invoice_has_sane_range():
    lo, hi = ml.bin_span(np.array([7]), np.array([7]), np.array([400.0]))
    assert lo[0] == 400 and hi[0] == 460


def test_distribution_is_a_valid_probability():
    rng = np.random.default_rng(0)
    n = 400
    inv = pd.to_datetime("2025-01-01") + pd.to_timedelta(rng.integers(0, 500, n), unit="D")
    due = inv + pd.Timedelta(days=30)
    paid = due + pd.to_timedelta(rng.integers(-5, 60, n), unit="D")
    df = pd.DataFrame(dict(id=range(n), buyer_id=rng.integers(0, 10, n), invoice_date=inv, due_date=due, amount=rng.uniform(1e4, 1e5, n),
                           paid_date=paid.where(paid < pd.Timestamp(TODAY)), disputed=False, docs_pending=False,
                           segment="Unknown", is_government=False, treds_onboarded=False))
    F = ml.build_features(df, TODAY)
    bundle = ml.fit(F)
    d = ml.distribution(bundle, F.head(50))
    assert np.allclose(d["pmf"].sum(1), 1, atol=1e-6)
    assert ((d["p_late"] >= 0) & (d["p_late"] <= 1)).all()
    assert (d["lo"] <= d["q50"] + 1e-9).all() and (d["q50"] <= d["hi"] + 1e-9).all()
