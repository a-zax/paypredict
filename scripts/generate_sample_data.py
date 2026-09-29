"""
Generates the bundled SAMPLE ledger (data/invoices.csv, data/buyers.csv) used by
"Explore with a sample business". Run: python scripts/generate_sample_data.py

Synthetic invoice-payment data for a fictional Indian MSME supplier.

Seller: "Sahyadri Packaging Solutions" (fictional micro/small enterprise, Pune) -
sells corrugated boxes & labels to buyers across industries.

Every behavioural rule below is a *documented* Indian B2B payment pattern, so the
model has realistic structure to learn:
  * Persistent buyer payment discipline (latent) -> past behaviour predicts future
  * Buyer-type power: Govt depts slowest, MSME buyers & large corporates stretch, MNCs pay best
  * Industry cash cycles (infra/engineering slowest, FMCG fastest)
  * Seasonality: Diwali (Oct-Nov) slows, March year-end speeds up (43B(h) deduction deadline)
  * Disputes and incomplete documents (GRN / PO mismatch) delay payment
  * Temporary buyer cash-stress episodes -> recent history matters more than long-run average
  * Rare extreme delays (heavy tail)

All buyer names are synthetic.
"""
from pathlib import Path

import numpy as np
import pandas as pd

RNG = np.random.default_rng(42)
TODAY = pd.Timestamp("2026-09-29")
START = pd.Timestamp("2023-10-01")
N_BUYERS = 220
OUT = Path(__file__).resolve().parent.parent / "data"

# type: share, delay shift (days), discipline spread, P(on TReDS), covered by 43B(h), base invoice (Rs)
BUYER_TYPES = {
    "Large Corporate":  (0.20, 10, 8, 0.85, True, 100_000),
    "MNC":              (0.10, -3, 5, 0.60, True, 80_000),
    "Mid-size Company": (0.32, 5, 10, 0.25, True, 40_000),
    "MSME Buyer":       (0.28, 9, 13, 0.05, True, 15_000),
    "Govt Department":  (0.10, 26, 12, 0.00, False, 120_000),
}
INDUSTRIES = {  # delay shift, name suffixes
    "FMCG": (-3, ["Consumer Products", "Foods", "Home Care"]),
    "Pharma": (0, ["Pharma", "Lifesciences", "Healthcare"]),
    "Automotive": (3, ["Autotech", "Auto Components", "Motors"]),
    "Electronics": (2, ["Electronics", "Electricals", "Appliances"]),
    "Retail / E-com": (5, ["Retail", "Mart", "Commerce"]),
    "Textiles": (8, ["Textiles", "Fabrics", "Apparels"]),
    "Engineering / Infra": (14, ["Engineering", "Infra Projects", "Fabricators"]),
}
PREFIXES = ["Aadi", "Bharat", "Chetak", "Deccan", "Eklavya", "Ganga", "Himgiri", "Indus",
            "Janseva", "Kaveri", "Lakshya", "Mahima", "Narmada", "Omkar", "Prabhat", "Rajdhani",
            "Sahyog", "Tapti", "Utkarsh", "Vindhya", "Yamuna", "Zenith", "Shivneri", "Konkan",
            "Sarthi", "Navkar", "Pragati", "Anant", "Vaibhav", "Suvarna"]
CITIES = ["Pune", "Mumbai", "Nashik", "Aurangabad", "Ahmedabad", "Bengaluru", "Hyderabad",
          "Chennai", "Indore", "Nagpur", "Delhi NCR", "Surat"]
MONTH_SHIFT = {3: -7, 6: 2, 10: 6, 11: 7}  # March year-end rush; Diwali slowdown


def make_buyers() -> pd.DataFrame:
    types = list(BUYER_TYPES)
    shares = np.array([BUYER_TYPES[t][0] for t in types])
    rows, used = [], set()
    for i in range(N_BUYERS):
        btype = RNG.choice(types, p=shares / shares.sum())
        _, tshift, spread, p_treds, covered, base_amt = BUYER_TYPES[btype]
        industry = RNG.choice(list(INDUSTRIES))
        city = RNG.choice(CITIES)
        if btype == "Govt Department":
            name = f"Govt Procurement Office #{i:03d} ({city})"
        else:
            while True:
                name = f"{RNG.choice(PREFIXES)} {RNG.choice(INDUSTRIES[industry][1])}"
                name += " Ltd" if btype in ("Large Corporate", "MNC") else " Pvt Ltd"
                if name not in used:
                    break
            used.add(name)
        # stress episode: a window where this buyer's cash is tight
        stressed = RNG.random() < 0.18
        s_start = START + pd.Timedelta(days=int(RNG.integers(0, (TODAY - START).days - 60)))
        rows.append(dict(
            buyer_id=f"B{i:03d}", buyer_name=name, buyer_type=btype, industry=industry, city=city,
            treds_onboarded=bool(RNG.random() < p_treds), covered_43bh=covered,
            credit_terms=int(RNG.choice([30, 45], p=[0.45, 0.55])),
            base_amount=base_amt * RNG.lognormal(0, 0.4),
            orders_per_month=float(np.clip(RNG.lognormal(0.2, 0.6), 0.3, 6)),
            discipline=RNG.normal(tshift + INDUSTRIES[industry][0], spread),
            dispute_prop=float(np.clip(RNG.beta(2, 25) * (1.6 if btype == "Govt Department" else 1), 0, 0.4)),
            stress_start=s_start if stressed else pd.NaT,
            stress_end=s_start + pd.Timedelta(days=int(RNG.integers(120, 240))) if stressed else pd.NaT,
        ))
    return pd.DataFrame(rows)


def make_invoices(buyers: pd.DataFrame) -> pd.DataFrame:
    rows, inv_no = [], 1
    horizon = (TODAY - START).days
    for b in buyers.itertuples():
        n = RNG.poisson(b.orders_per_month * horizon / 30)
        dates = np.sort(START + pd.to_timedelta(RNG.integers(0, horizon + 1, n), unit="D"))
        for d in dates:
            d = pd.Timestamp(d)
            amount = round(b.base_amount * RNG.lognormal(0, 0.5), -2)
            dispute = RNG.random() < b.dispute_prop
            docs_incomplete = RNG.random() < 0.12
            due = d + pd.Timedelta(days=b.credit_terms)

            late = b.discipline
            late += MONTH_SHIFT.get(due.month, 0)
            late += 6 * np.log(amount / b.base_amount)           # unusually large invoices wait
            late += RNG.uniform(15, 45) if dispute else 0
            late += 10 if docs_incomplete else 0
            if pd.notna(b.stress_start) and b.stress_start <= d <= b.stress_end:
                late += RNG.uniform(20, 45)
            late += RNG.normal(0, 6)
            if RNG.random() < 0.02:
                late += RNG.uniform(60, 150)                    # rare extreme delay
            days_late = int(np.clip(round(late), -10, 200))

            rows.append(dict(
                invoice_id=f"INV-{inv_no:05d}", buyer_id=b.buyer_id, invoice_date=d,
                due_date=due, amount=amount, dispute_flag=bool(dispute),
                docs_incomplete=bool(docs_incomplete),
                payment_date=due + pd.Timedelta(days=days_late), days_late=days_late,
            ))
            inv_no += 1
    inv = pd.DataFrame(rows).sort_values("invoice_date").reset_index(drop=True)
    # Anything not yet paid as of TODAY is open: its outcome is unknown to us.
    open_mask = inv["payment_date"] > TODAY
    inv.loc[open_mask, ["payment_date", "days_late"]] = [pd.NaT, np.nan]
    inv["status"] = np.where(open_mask, "open", "paid")
    return inv


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    buyers = make_buyers()
    invoices = make_invoices(buyers)
    buyers.drop(columns=["discipline", "dispute_prop", "stress_start", "stress_end",
                         "orders_per_month", "base_amount"]).to_csv(OUT / "buyers.csv", index=False)
    invoices.to_csv(OUT / "invoices.csv", index=False)
    paid = invoices[invoices.status == "paid"]
    print(f"buyers={len(buyers)} invoices={len(invoices)} open={int((invoices.status == 'open').sum())}")
    print(f"paid: mean days late={paid.days_late.mean():.1f}, >15 days late={(paid.days_late > 15).mean():.1%}")
    print(paid.merge(buyers, on="buyer_id").groupby("buyer_type").days_late.mean().round(1))
