# PayPredict - AI receivables co-pilot for Indian MSMEs

**IES MCRC Hackathon 4.0 · Track: FinTech AI · Team No. 4**

PayPredict learns how each customer actually pays, predicts when every unpaid invoice will really be
paid (with a range, not a single guess), explains why, and tells the owner the cheapest effective next
step: a reminder, an early-payment offer, a 45-day legal nudge (MSMED Act / Sec 43B(h)), selling the
invoice on TReDS, or an MSME Samadhaan escalation. It drafts the message in English, Hindi or Marathi,
sends it via WhatsApp in one tap with a UPI pay link, and learns from what works.

- Live demo: https://paypredict-ad5f.onrender.com (free instance - the first visit after idle takes ~50 s)
- Source: https://github.com/a-zax/paypredict
- Report: `report/report.html` (built to PDF with `report/build_pdf.py`)

## What it does

| Feature | Where | What you get |
|---|---|---|
| Daily action list | **Today** | Ranked invoices to chase, with a plain-language reason and a ready message |
| AI briefing and alerts | **Today** | Cash outlook, priorities and warnings written by Munim AI, plus anomaly flags |
| Payment-date prediction | **Invoices** | Expected date, ~90% range, probability of payment by period, per-factor explanation (days added or removed) |
| Customer grades and personas | **Customers** | A-D reliability grade, trend, and K-means payment persona per customer |
| Cash forecast | **Cash** | 4-6 week collections forecast from 1,000 simulations vs. the amount promised by due dates |
| Order-time credit check | **Credit check** | Approve / conditions / decline verdict for a new order, safe exposure limit, what-if across credit periods, message to the customer |
| Model accuracy and impact | **Impact** | Honest back-test, calibration and drift, personas map, anomaly list, and what the actions taken have led to |
| Munim AI agent | Ask button (any page) | On-device ReAct agent (understand, plan, act, observe, answer) that shows every Thought / Action / Observation; English, Hinglish, Hindi, Marathi; text or voice |
| Reply reader | Invoice drawer | Reads a customer's reply ("will pay by Friday", "material damaged", "UTR ...") and estimates whether the promise will hold |
| Getting paid | Pay page `/pay/<token>` | Public UPI pay page with QR (no gateway, no fees), "I've paid" claim, MSMED Act interest per invoice, legal-notice generator |
| Ledger import | Onboarding / Settings | Tally, Zoho, Busy, Vyapar, Excel or CSV with automatic column detection |

## Run locally

Requires Python 3.11+ and Node 22+.

```bash
python -m venv .venv
.venv\Scripts\activate                      # Windows  (source .venv/bin/activate on Mac/Linux)
pip install -r requirements.txt
cd web && npm install && npm run build && cd ..
uvicorn server.main:app --port 8000         # open http://localhost:8000
```

Click **Try the live demo** on the login page to load the bundled sample business, or sign up and
import your own ledger.

Frontend dev with hot reload: run the API as above, then `cd web && npm run dev` (http://localhost:5173).

### Optional: Claude assistant

Munim AI works with no external services. If you also set `ANTHROPIC_API_KEY` before starting the
server, the **Ask PayPredict** assistant (Claude with tools over the business's own data) is enabled.
Everything else works without it.

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | SQLite in `storage/` | Full connection string; Postgres (`postgresql://...`) in production |
| `PAYPREDICT_SECRET` | random, saved in `storage/.secret` | Signs login tokens and pay links |
| `PAYPREDICT_STORAGE` | `storage/` | Local database and file storage |
| `PAYPREDICT_PUBLIC_URL` | the request's own URL | Base URL used in pay links sent to customers |
| `ANTHROPIC_API_KEY` | - | Enables the Claude "Ask PayPredict" assistant |

## Architecture

| Layer | Files |
|---|---|
| Web app (React 18 + TypeScript + Vite + Tailwind 4 + Recharts) | `web/src/` - pages: Today, Invoices, Customers, Cash, Impact, Credit check, Settings, Onboarding, Pay, Notice; English / Hindi / Marathi interface, dark mode, guided tour |
| API (FastAPI) | `server/main.py` - auth, import, scoring, actions, AI endpoints, public pay pages |
| Business logic | `server/services.py` - scoring, forecast, buyer grades, dashboards shared by the API and agents |
| Time-to-payment model | `server/ml.py` - discrete-time survival model (gradient-boosted hazards), leakage-free features, censoring of unpaid invoices, honest back-test |
| Decision engine | `server/actions.py` - cost-based action choice, adaptive escalation ladder, EN/HI/MR messages, WhatsApp links |
| Credit check | `server/credit.py` - scores a hypothetical invoice dated today, safe exposure limit by grade, what-if on credit periods |
| Supporting AI | `server/intel.py` - reply reader (NLP), K-means personas + PCA, Isolation Forest anomaly check, calibration / Brier / drift (PSI) |
| Munim AI agent | `server/agent.py` - on-device intent model + entity extraction + ReAct loop over grounded tools |
| Claude assistant | `server/assistant.py` - optional; Claude calls tools that query only this business's data |
| Payments | `server/payments.py` - UPI links and QR, MSMED Act s.15/16 interest (3x RBI Bank Rate, compounded monthly) |
| Ledger import | `server/ingest.py` - column auto-detection and Indian date / amount formats |
| Data layer | `server/db.py` - SQLModel models, multi-tenant (every row belongs to an Org); SQLite locally, Postgres in production |
| Sample business | `data/*.csv` (220 customers, 12,193 invoices), generated by `scripts/generate_sample_data.py` - fictional, all names synthetic |

### API at a glance

All routes are under `/api`; everything except `auth/*`, `health` and `pay/*` needs a bearer token.

| Area | Routes |
|---|---|
| Auth and org | `POST auth/signup`, `auth/login`, `auth/demo`; `GET me`; `PATCH org`; `GET setup` |
| Import | `POST import/sample`, `import/preview`, `import/commit`; `GET import/template.csv`; `POST reset` |
| Receivables | `GET today`, `forecast`, `invoices`, `invoices/counts`, `invoices/{id}`, `invoices/{id}/explain`; `POST invoices/{id}/log`, `invoices/{id}/undo` |
| Customers | `GET buyers`, `buyers/{id}/history`, `buyers/{id}/notice`; `PATCH buyers/{id}` |
| Model | `GET model`, `impact`; `POST model/retrain` |
| AI | `POST assistant`, `invoices/{id}/read-reply`, `credit-check`; `GET briefing`, `alerts`, `ai/personas`, `ai/anomalies`, `ai/health` |
| Public pay page | `GET pay/{token}`; `POST pay/{token}/claim` |
| Ops | `GET health` (used by Render's health check) |

## Results (held-out back-test on the sample ledger)

| Measure | PayPredict | Baseline |
|---|---|---|
| Mean absolute error of predicted payment date | 9.5 days | 21.4 days (due date) / 11.7 days (customer average) |
| Risk ranking, area under ROC curve (payment 15+ days late) | 0.90 | 0.84 (customer average) |
| Late money captured in the riskiest 20% of invoices | 41% | 34% (customer average) |
| Payments falling within the stated range | 86% | - |
| Brier score / mean calibration gap | 0.135 / 6.6% | - |

The sample ledger is synthetic, so results on a real ledger will differ. Each business gets a model
trained on its own ledger once it has enough history (150 paid invoices across 8 customers); until then the app
uses a starter model trained on the sample data and says so on the Impact page.

## Deploy for free (Render + Neon)

Free Render instances have no persistent disk, so all data (and trained models) live in a free Neon Postgres database.
1. **Neon** (neon.tech): create a free project (AWS Singapore matches the Render region), copy the connection string (`postgresql://...`).
2. **GitHub**: push this repository.
3. **Render** (render.com): New -> Blueprint -> pick the repo. Render reads `render.yaml`; paste the Neon string
   as `DATABASE_URL` (and optionally `ANTHROPIC_API_KEY`). `PAYPREDICT_SECRET` is generated for you. The first build takes ~5 minutes.
4. Open `https://<your-service>.onrender.com` and click **Try the live demo**.

Free instances sleep after 15 minutes idle; the first visit after that takes ~50 seconds to wake up.
The public demo business resets to fresh sample data every 24 hours and its pay pages never show real payment details.

The `Dockerfile` builds the web app and the API into one image (the API serves the built frontend), so the
same image runs anywhere Docker does.

## Tests

```bash
pip install pytest
python -m pytest tests -q
```

`tests/test_units.py` covers the decision engine, MSMED interest, UPI/pay tokens, ledger import and leakage-free model features;
`tests/test_api.py` covers the API end to end (login, per-business data isolation, pay loop, credit check, undo, security headers, the agent). `tests/smoke_api.py` is a quick manual walkthrough:
`PAYPREDICT_STORAGE=storage_test python tests/smoke_api.py`.

## Repository layout

```
server/    FastAPI app, models, AI modules
web/       React frontend (build output goes to web/dist, served by the API)
data/      Sample business (buyers.csv, invoices.csv)
scripts/   generate_sample_data.py, zip_codebase.py (clean zip of the repo)
tests/     unit, API and smoke tests
report/    Report (HTML -> PDF) and screenshot tooling
```

## Notes

- Messages and legal notices are templates to be reviewed by a chartered accountant; PayPredict gives
  business guidance, not legal advice.
- No message is sent without the user's approval, and every action can be undone.