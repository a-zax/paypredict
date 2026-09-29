"""End-to-end API smoke test. Run: PAYPREDICT_STORAGE=storage_test python tests/smoke_api.py"""
import time
from fastapi.testclient import TestClient
from server.main import app

c = TestClient(app)
r = c.post("/api/auth/signup", json=dict(name="Aryan", email="demo@paypredict.in", password="demo12345",
                                          business_name="Sahyadri Packaging Solutions"))
if r.status_code == 409:
    r = c.post("/api/auth/login", json=dict(email="demo@paypredict.in", password="demo12345"))
print("auth", r.status_code)
H = {"Authorization": "Bearer " + r.json()["token"]}
assert c.get("/api/today").status_code == 401, "unauthenticated access must fail"
t = time.time(); r = c.post("/api/import/sample", headers=H)
print("sample", r.status_code, round(time.time() - t, 1), "s", {k: r.json().get(k) for k in ("kind", "auc", "mae_days", "mae_days_due_date", "coverage_90")})
t = time.time(); r = c.get("/api/today", headers=H); print("today", r.status_code, round(time.time() - t, 1), "s")
d = r.json(); print({k: (round(v) if isinstance(v, float) else v) for k, v in d["summary"].items()})
for a in d["actions"][:5]:
    print("  ", a["number"], a["buyer_name"], round(a["amount"]), f'{a["risk"]:.2f}', a["action"], "|", a["reasons"])
r = c.get("/api/forecast?weeks=6", headers=H)
print("forecast (lakh: assumed, expected, low, high)", [(w["week"][5:], round(w["cum_assumed"] / 1e5), round(w["cum_expected"] / 1e5), round(w["cum_low"] / 1e5), round(w["cum_high"] / 1e5)) for w in r.json()["weeks"]])
b = c.get("/api/buyers", headers=H).json(); print("buyers", len(b), "|", b[0]["name"], b[0]["grade"], b[0]["trend"], b[0]["advice"])
iid = d["actions"][0]["id"]
v = c.get(f"/api/invoices/{iid}?lang=mr", headers=H).json(); print("detail mr:", v["message"][:90].replace("\n", " "))
print("log", c.post(f"/api/invoices/{iid}/log", headers=H, json={"kind": v["action"], "channel": "whatsapp"}).status_code,
      "promise", c.post(f"/api/invoices/{iid}/log", headers=H, json={"kind": "PROMISE", "when": "2026-10-10"}).status_code)
v2 = c.get(f"/api/invoices/{iid}", headers=H).json(); print("after promise:", v2["action"], "|", v2["rationale"], "| timeline", [e["kind"] for e in v2["timeline"]])
print("overdue", c.get("/api/invoices?status=overdue&sort=amount", headers=H).json()["total"])
tally = ("Sahyadri Packaging\nBills Receivable\nDate,Ref. No.,Party's Name,Opening Amount,Due on,Payment Date\n"
         "01-07-2026,T-1,Kaveri Foods,\"1,20,000.00\",31-07-2026,15-08-2026\n05-08-2026,T-2,Kaveri Foods,\"85,500\",04-09-2026,\n,,Total,\"2,05,500\",,\n")
r = c.post("/api/import/preview", headers=H, files={"file": ("tally.csv", tally.encode())}); j = r.json(); print(r.status_code, str(j)[:300]) if r.status_code != 200 else None
print("preview", r.status_code, j["mapping"], j["preview"], j["issues"])
print("assistant", c.post("/api/assistant", headers=H, json={"messages": [{"role": "user", "content": "hi"}]}).json()["reply"][:80])
m = c.get("/api/model", headers=H).json(); print("model", m["kind"], m["insights"])

# ---------------- v2.1 features
print("--- UPI pay links")
r = c.patch("/api/org", headers=H, json={"upi_id": "not-a-upi"}); print("bad upi rejected:", r.status_code == 400)
r = c.patch("/api/org", headers=H, json={"upi_id": "sahyadri@okhdfcbank", "udyam_number": "UDYAM-MH-26-0012345",
                                          "gstin": "27abcde1234f1z5", "address": "Plot 12, MIDC Bhosari, Pune 411026"})
print("org patch", r.status_code, r.json().get("gstin"))
d = c.get("/api/today", headers=H).json()
a = next(x for x in d["actions"] if x["action"] in ("REMINDER", "LEGAL_NUDGE", "SAMADHAAN", "EARLY_PAY_OFFER"))
print("action", a["action"], "| pay_url:", a.get("pay_url", "")[:45], "| interest:", a.get("interest"))
print("message tail:\n   " + a["message"][-260:].replace("\n", "\n   "))
tok = a["pay_url"].split("/pay/")[1]
pg = c.get(f"/api/pay/{tok}").json()
print("public pay page:", pg["seller"], pg["pay_amount"], pg["status"], pg["upi_url"][:60], "qr:", bool(pg["qr_svg"]))
print("bad token:", c.get("/api/pay/garbage").status_code, "| tampered:", c.get(f"/api/pay/{tok[:-1]}{'0' if tok[-1] != '0' else '1'}").status_code,
      "| other invoice, same sig:", c.get(f"/api/pay/{int(tok.split('-')[0]) + 1}-{tok.split('-', 1)[1]}").status_code, "| link:", a["pay_url"])
print("claim:", c.post(f"/api/pay/{tok}/claim", json={"reference": "UTR 4123-9988"}).json())
v = c.get(f"/api/invoices/{a['id']}", headers=H).json(); print("after claim:", v["action"], "|", v["rationale"])
print("confirm paid:", c.post(f"/api/invoices/{a['id']}/log", headers=H, json={"kind": "PAID"}).status_code,
      "| page now:", c.get(f"/api/pay/{tok}").json()["status"])
print("--- impact")
im = c.get("/api/impact", headers=H).json()
print({k: (round(v) if isinstance(v, float) else v) for k, v in im.items() if k != "trend"})
print("trend:", [(x["month"], round(x["dso"] or 0), round((x["late_share"] or 0) * 100)) for x in im["trend"]][-6:])
print("--- legal notice")
b0 = next(x for x in c.get("/api/buyers", headers=H).json() if x["overdue_amount"] > 0)
n = c.get(f"/api/buyers/{b0['id']}/notice", headers=H).json()
print(n["buyer"]["name"], "| invoices:", len(n["invoices"]), "| principal", round(n["principal"]), "| interest", n["interest"], "| rate", n["rate"])
print("--- credit check")
for body in ({"buyer_id": b0["id"], "amount": 300000, "credit_days": 45},
             {"buyer_id": c.get("/api/buyers", headers=H).json()[-1]["id"], "amount": 50000, "credit_days": 30},
             {"new_customer": "Brand New Traders", "amount": 200000, "credit_days": 30}):
    r = c.post("/api/credit-check", headers=H, json=body); j = r.json()
    print(r.status_code, j.get("customer"), j.get("grade"), j.get("verdict"), "|", j.get("headline"),
          "| p", round(j.get("p_late", 0), 2), "| cond:", j.get("conditions"))
