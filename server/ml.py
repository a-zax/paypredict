"""
Time-to-payment model (discrete-time survival / hazard model).

Each invoice's life after its due date is split into periods ("bins"):
    on/before due, 1-7, 8-15, 16-30, 31-45, 46-60, 61-90, 90+ days late.
A gradient-boosted classifier learns the hazard  h(k | x) = P(paid in bin k | still unpaid at start of k).
From hazards we get the full distribution of the payment date, which gives
  * P(paid > 15 days late)            -> risk
  * median / 3rd / 97th percentile    -> expected date and ~90% range (coverage measured in back-test)
and it conditions on the invoice's current age, so predictions update daily.

Unpaid invoices contribute the bins they have already survived (censoring), so the model
learns from them instead of discarding them.
"""
import json
from datetime import date

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

EDGES = [0, 7, 15, 30, 45, 60, 90]          # upper edges of bins 0..6; bin 7 = 90+
BIN_LO = np.array([-10, 0, 7, 15, 30, 45, 60, 90], dtype=float)
BIN_HI = np.array([0, 7, 15, 30, 45, 60, 90, 150], dtype=float)
NB = 8
LATE_BIN = 3                                  # bins >= 3 mean "more than 15 days late"

CAT = ["segment"]
NUM = ["log_amount", "amount_vs_usual", "credit_terms", "invoice_month", "disputed", "docs_pending",
       "is_government", "treds_onboarded", "hist_n_paid", "hist_avg_days_late",
       "hist_last3_avg_days_late", "hist_pct_late15", "hist_max_days_late", "open_exposure_lakh",
       "open_overdue_count", "days_since_last_payment", "tenure_days"]
FEATURES = CAT + NUM
MIN_PAID_FOR_OWN_MODEL = 150
MIN_BUYERS_FOR_OWN_MODEL = 8


def bin_of(days):
    return np.searchsorted(EDGES, np.asarray(days, dtype=float), side="left")


# ------------------------------------------------------------------ features
def _history(g: pd.DataFrame) -> pd.DataFrame:
    """Point-in-time buyer history for each invoice of one buyer (g sorted by invoice_date)."""
    d = g["invoice_date"].values
    pay = g["paid_date"].values
    due = g["due_date"].values
    amt = g["amount"].values
    late = (pay - due) / np.timedelta64(1, "D")
    cols = ["hist_n_paid", "hist_avg_days_late", "hist_last3_avg_days_late", "hist_pct_late15",
            "hist_max_days_late", "open_exposure_lakh", "open_overdue_count", "days_since_last_payment",
            "tenure_days", "amount_vs_usual"]
    out = {c: np.full(len(g), np.nan) for c in cols}
    for i in range(len(g)):
        p_pay, p_due = pay[:i], due[:i]
        known = ~np.isnat(p_pay) & (p_pay < d[i])        # payments that had arrived by invoice date
        out["tenure_days"][i] = (d[i] - d[0]) / np.timedelta64(1, "D")
        out["amount_vs_usual"][i] = amt[i] / amt[:i].mean() if i else 1.0
        out["open_exposure_lakh"][i] = amt[:i][~known].sum() / 1e5
        out["open_overdue_count"][i] = (~known & (p_due < d[i])).sum()
        n = known.sum()
        out["hist_n_paid"][i] = n
        if n:
            pl, pp = late[:i][known], p_pay[known]
            order = np.argsort(pp)
            out["hist_avg_days_late"][i] = pl.mean()
            out["hist_last3_avg_days_late"][i] = pl[order][-3:].mean()
            out["hist_pct_late15"][i] = (pl > 15).mean()
            out["hist_max_days_late"][i] = pl.max()
            out["days_since_last_payment"][i] = (d[i] - pp.max()) / np.timedelta64(1, "D")
    return pd.DataFrame(out, index=g.index)


def build_features(df: pd.DataFrame, asof: date) -> pd.DataFrame:
    """df: one org's invoices with buyer attributes. Payments after `asof` are treated as unknown."""
    df = df.copy()
    for c in ("invoice_date", "due_date", "paid_date"):
        df[c] = pd.to_datetime(df[c])
    df.loc[df["paid_date"] > pd.Timestamp(asof), "paid_date"] = pd.NaT
    df = df.sort_values(["buyer_id", "invoice_date", "id"])
    hist = df.groupby("buyer_id", group_keys=False)[
        ["invoice_date", "paid_date", "due_date", "amount"]].apply(_history)
    df = df.join(hist)
    df["log_amount"] = np.log10(df["amount"].clip(lower=1))
    df["credit_terms"] = (df["due_date"] - df["invoice_date"]).dt.days
    df["invoice_month"] = df["invoice_date"].dt.month
    for c in ("disputed", "docs_pending", "is_government", "treds_onboarded"):
        df[c] = df[c].fillna(False).astype(int)
    df["segment"] = df["segment"].fillna("Unknown").astype(str)
    df["days_late"] = (df["paid_date"] - df["due_date"]).dt.days
    df["age"] = (pd.Timestamp(asof) - df["due_date"]).dt.days   # days past due as of `asof`
    return df


def _X(F: pd.DataFrame, bins, cats) -> pd.DataFrame:
    X = F[FEATURES].copy()
    seg = X["segment"].where(X["segment"].isin(cats))   # unseen segments -> missing (the model handles NaN)
    X["segment"] = pd.Categorical(seg, categories=cats)
    X["bin"] = bins
    return X


# ------------------------------------------------------------------ training
def _expand(F: pd.DataFrame):
    """Person-period rows: one row per bin each invoice was observed in."""
    paid = F["days_late"].notna().values
    e = np.where(paid, bin_of(F["days_late"].fillna(0)), 0)
    survived = (BIN_HI[None, :NB - 1] <= F["age"].values[:, None]).sum(1)   # completed bins if unpaid
    n_rows = np.where(paid, e + 1, survived)
    idx = np.repeat(np.arange(len(F)), n_rows)
    k = np.concatenate([np.arange(n) for n in n_rows]) if len(idx) else np.array([], int)
    y = (paid[idx] & (k == e[idx])).astype(int)
    return idx, k, y


def fit(F: pd.DataFrame) -> dict:
    cats = sorted(F["segment"].unique().tolist())
    idx, k, y = _expand(F)
    X = _X(F.iloc[idx].reset_index(drop=True), k, cats)
    clf = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.06, max_leaf_nodes=20,
                                         l2_regularization=1.0, categorical_features="from_dtype",
                                         random_state=0).fit(X, y)
    ref = F[FEATURES]
    typical = {c: (ref[c].mode()[0] if c in CAT else float(ref[c].median())) for c in FEATURES}
    return {"clf": clf, "cats": cats, "typical": typical, "n_rows": int(len(y)), "n_invoices": int(len(F))}


# ------------------------------------------------------------------ prediction
def hazards(bundle, F: pd.DataFrame) -> np.ndarray:
    n = len(F)
    rep = F.loc[F.index.repeat(NB)].reset_index(drop=True)
    X = _X(rep, np.tile(np.arange(NB), n), bundle["cats"])
    H = bundle["clf"].predict_proba(X)[:, 1].reshape(n, NB)
    H[:, -1] = 1.0                                   # everything is eventually paid (or written off)
    return H


def bin_span(k, c, age):
    """Day range of bin k for an invoice currently `age` days past due and sitting in bin c.
    The current bin starts at today's age; an invoice already beyond the last bin's nominal end
    (150+ days late) gets a 60-day window from today instead of an inverted range."""
    k, c, age = np.asarray(k), np.asarray(c), np.asarray(age, dtype=float)
    current = k == c
    lo = np.where(current, np.maximum(BIN_LO[k], age), BIN_LO[k])
    hi = np.where(current & (age >= BIN_HI[k]), age + 60, BIN_HI[k])
    return lo, hi


def distribution(bundle, F: pd.DataFrame) -> dict:
    """Conditional on being unpaid at current age: P(late>15), median and 90% range of days late."""
    H = hazards(bundle, F)
    age = F["age"].values.astype(float)
    c = np.where(age <= 0, 0, bin_of(age))
    H[np.arange(NB)[None, :] < c[:, None]] = 0.0
    surv_before = np.cumprod(np.hstack([np.ones((len(F), 1)), 1 - H[:, :-1]]), axis=1)
    p = H * surv_before
    cdf = np.cumsum(p, axis=1)

    def q(level):
        k = (cdf < level).sum(1).clip(max=NB - 1)
        prev = np.where(k > 0, cdf[np.arange(len(F)), k - 1], 0.0)
        pk = p[np.arange(len(F)), k].clip(min=1e-9)
        frac = ((level - prev) / pk).clip(0, 1)
        lo, hi = bin_span(k, c, age)
        return lo + frac * (hi - lo)

    return {"p_late": p[:, LATE_BIN:].sum(1), "q50": q(0.5), "lo": q(0.03), "hi": q(0.97), "pmf": p}


def reason_deltas(bundle, F: pd.DataFrame) -> pd.DataFrame:
    """How many days of expected delay each feature adds versus a typical invoice (ablation).
    Days (not probability) so it stays meaningful for invoices that are already late."""
    base = distribution(bundle, F)["q50"]
    out = {}
    for col in FEATURES:
        G = F.copy()
        G[col] = bundle["typical"][col]
        out[col] = base - distribution(bundle, G)["q50"]
    return pd.DataFrame(out, index=F.index)


# ------------------------------------------------------------------ evaluation
def backtest(df: pd.DataFrame, today: date) -> dict:
    """Train on invoices raised before a cut-off (knowing only what was known then);
    test on later invoices whose outcome is now known. Compare with simple baselines."""
    dates = pd.to_datetime(df["invoice_date"])
    mature_cut = pd.Timestamp(today) - pd.Timedelta(days=100)
    split = dates.quantile(0.65)
    if (dates < split).sum() < 300:
        return {"available": False, "reason": "Not enough history yet for an honest back-test."}
    F_train = build_features(df[dates < split], split.date())
    F_train = F_train[F_train["invoice_date"] < split]
    bundle = fit(F_train)

    F_all = build_features(df, today)                    # labels as known today
    test = F_all[(F_all["invoice_date"] >= split) & (F_all["due_date"] <= mature_cut)].copy()
    if len(test) < 100:
        return {"available": False, "reason": "Not enough matured invoices to test on yet."}
    # score each test invoice as on its invoice date (age = -credit terms)
    test_at_issue = test.assign(age=-test["credit_terms"])
    d = distribution(bundle, test_at_issue)
    unpaid = test["days_late"].isna()
    y = ((test["days_late"] > 15) | unpaid).astype(int).values
    paid = ~unpaid.values
    L = test["days_late"].values
    base = test["hist_avg_days_late"].fillna(F_train["days_late"].mean()).values
    in_range = (L[paid] >= d["lo"][paid]) & (L[paid] <= d["hi"][paid])
    top = np.argsort(-d["p_late"])[: max(1, len(test) // 5)]
    late_amt = test["amount"].values * y
    top_b = np.argsort(-base)[: max(1, len(test) // 5)]
    return {
        "available": True, "n_train": int(len(F_train)), "n_test": int(len(test)),
        "split_date": str(split.date()), "late_rate": float(y.mean()),
        "auc": float(roc_auc_score(y, d["p_late"])) if 0 < y.mean() < 1 else None,
        "auc_baseline": float(roc_auc_score(y, base)) if 0 < y.mean() < 1 else None,
        "mae_days": float(np.abs(L[paid] - d["q50"][paid]).mean()),
        "mae_days_baseline": float(np.abs(L[paid] - base[paid]).mean()),
        "mae_days_due_date": float(np.abs(L[paid]).mean()),
        "coverage_90": float(in_range.mean()),
        "late_amount_top20": float(late_amt[top].sum() / max(late_amt.sum(), 1)),
        "late_amount_top20_baseline": float(late_amt[top_b].sum() / max(late_amt.sum(), 1)),
    }


def save(bundle, path):
    joblib.dump(bundle, path)


def load(path):
    return joblib.load(path)


def metrics_json(m: dict) -> str:
    return json.dumps(m)
