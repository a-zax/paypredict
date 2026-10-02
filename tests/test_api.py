"""API tests: auth, tenant isolation, the full collect-and-get-paid loop, credit checks, security."""


def test_requires_login(client):
    for path in ("/api/today", "/api/invoices", "/api/buyers", "/api/impact", "/api/buyers/1/notice"):
        assert client.get(path).status_code == 401


def test_duplicate_signup_rejected(client, org_a):
    r = client.post("/api/auth/signup", json=dict(name="X", email="owner-a@example.com", password="whatever-123", business_name="X"))
    assert r.status_code == 409


def test_today_has_actions_and_one_card_per_customer(client, org_a):
    d = client.get("/api/today", headers=org_a).json()
    assert d["summary"]["outstanding"] > 0 and len(d["actions"]) > 0
    names = [a["buyer_name"] for a in d["actions"]]
    assert len(names) == len(set(names))


def test_other_business_cannot_see_my_data(client, org_a, org_b):
    inv = client.get("/api/invoices?status=open", headers=org_a).json()["items"][0]
    assert client.get(f"/api/invoices/{inv['id']}", headers=org_b).status_code == 404
    assert client.post(f"/api/invoices/{inv['id']}/log", headers=org_b, json={"kind": "PAID"}).status_code == 404
    assert client.get(f"/api/buyers/{inv['buyer_id']}/notice", headers=org_b).status_code == 404
    assert client.patch(f"/api/buyers/{inv['buyer_id']}", headers=org_b, json={"phone": "9999999999"}).status_code == 404
    assert client.get("/api/invoices", headers=org_b).json()["total"] == 0


def test_upi_pay_loop(client, org_a):
    assert client.patch("/api/org", headers=org_a, json={"upi_id": "bad upi"}).status_code == 400
    assert client.patch("/api/org", headers=org_a, json={"upi_id": "alpha@okicici"}).status_code == 200
    a = next(x for x in client.get("/api/today", headers=org_a).json()["actions"] if x.get("pay_url"))
    assert "/pay/" in a["message"] or a["action"] in ("RESOLVE_DISPUTE", "FIX_DOCS", "TREDS")
    token = a["pay_url"].rsplit("/pay/", 1)[1]
    page = client.get(f"/api/pay/{token}").json()
    assert page["status"] == "due" and page["upi_url"].startswith("upi://pay?pa=alpha%40okicici") and page["qr_svg"]
    assert client.post(f"/api/pay/{token}/claim", json={"reference": "UTR 123-456"}).json()["status"] == "claimed"
    v = client.get(f"/api/invoices/{a['id']}", headers=org_a).json()
    assert v["action"] == "CONFIRM_PAYMENT" and v["claim_ref"] == "UTR123456"
    assert client.post(f"/api/invoices/{a['id']}/log", headers=org_a, json={"kind": "PAID"}).status_code == 200
    assert client.get(f"/api/pay/{token}").json()["status"] == "paid"


def test_customer_language_drives_message_pay_link_and_subject(client, org_a):
    from urllib.parse import unquote
    client.patch("/api/org", headers=org_a, json={"upi_id": "alpha@okicici"})
    a = next(x for x in client.get("/api/today", headers=org_a).json()["actions"]
             if x["action"] in ("REMINDER", "EARLY_PAY_OFFER", "LEGAL_NUDGE", "SAMADHAAN"))
    assert client.patch(f"/api/buyers/{a['buyer_id']}", headers=org_a, json={"language": "hi"}).status_code == 200
    assert client.patch(f"/api/buyers/{a['buyer_id']}", headers=org_a, json={"language": "fr"}).status_code == 422
    v = client.get(f"/api/invoices/{a['id']}", headers=org_a).json()
    assert v["message_lang"] == "hi" and "lang=hi" in v["message"] and "subject=इनवॉइस" in unquote(v["email_url"])
    assert client.get(f"/api/invoices/{a['id']}?lang=en", headers=org_a).json()["message_lang"] == "en"   # drawer override
    client.patch(f"/api/buyers/{a['buyer_id']}", headers=org_a, json={"language": ""})
    v = client.get(f"/api/invoices/{a['id']}", headers=org_a).json()
    assert v["message_lang"] == "en" and "lang=" not in v["message"]


def test_claim_rejected_resumes_follow_up(client, org_a):
    a = next(x for x in client.get("/api/today", headers=org_a).json()["actions"] if x.get("pay_url"))
    token = a["pay_url"].rsplit("/pay/", 1)[1]
    client.post(f"/api/pay/{token}/claim", json={"reference": ""})
    client.post(f"/api/invoices/{a['id']}/log", headers=org_a, json={"kind": "CLAIM_REJECTED"})
    v = client.get(f"/api/invoices/{a['id']}", headers=org_a).json()
    assert v["claim_at"] is None and v["action"] != "CONFIRM_PAYMENT"


def test_impact_counts_action_then_payment(client, org_a):
    a = next(x for x in client.get("/api/today", headers=org_a).json()["actions"] if x["action"] in ("REMINDER", "LEGAL_NUDGE", "SAMADHAAN", "EARLY_PAY_OFFER"))
    client.post(f"/api/invoices/{a['id']}/log", headers=org_a, json={"kind": a["action"], "channel": "whatsapp"})
    client.post(f"/api/invoices/{a['id']}/log", headers=org_a, json={"kind": "PAID"})
    im = client.get("/api/impact", headers=org_a).json()
    assert im["collected_after_action"] >= a["amount"] and im["actions_taken"] >= 1 and len(im["trend"]) == 12


def test_legal_notice_totals(client, org_a):
    b = next(x for x in client.get("/api/buyers", headers=org_a).json() if x["overdue_amount"] > 0)
    n = client.get(f"/api/buyers/{b['id']}/notice", headers=org_a).json()
    assert n["invoices"] and abs(n["total"] - (n["principal"] + n["interest"])) < 0.02
    assert abs(n["principal"] - sum(i["amount"] for i in n["invoices"])) < 0.01


def test_credit_check_verdicts(client, org_a):
    buyers = client.get("/api/buyers", headers=org_a).json()
    good = next(b for b in buyers if b["grade"] == "A" and b["overdue_amount"] == 0)
    r = client.post("/api/credit-check", headers=org_a, json={"buyer_id": good["id"], "amount": 20000, "credit_days": 30}).json()
    assert r["verdict"] == "APPROVE"
    r = client.post("/api/credit-check", headers=org_a, json={"new_customer": "Unknown Co", "amount": 100000, "credit_days": 30}).json()
    assert r["verdict"] == "CONDITIONS" and r["advance_pct"] == 25
    assert client.post("/api/credit-check", headers=org_a, json={"amount": 1000, "credit_days": 30}).status_code == 400
    r = client.post("/api/credit-check", headers=org_a, json={"new_customer": "Unknown Co", "amount": 100000, "credit_days": 30, "lang": "hi"}).json()
    assert r["message_lang"] == "hi" and "ऑर्डर" in r["message"]


def test_credit_check_leads_with_overdue(client, org_a):
    worst = max(client.get("/api/buyers", headers=org_a).json(), key=lambda c: c["overdue_amount"])
    r = client.post("/api/credit-check", headers=org_a, json={"buyer_id": worst["id"], "amount": 50000, "credit_days": 30}).json()
    assert "already overdue" in r["reasons"][0]


def test_security_headers_and_login_rate_limit(client):
    r = client.get("/api/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff" and r.headers["X-Frame-Options"] == "DENY"
    codes = [client.post("/api/auth/login", json={"email": "victim@example.com", "password": f"guess{i}"}).status_code for i in range(10)]
    assert codes[:8] == [401] * 8 and codes[-1] == 429


def test_undo_reverts_paid_and_promise(client, org_a):
    inv = client.get("/api/invoices?status=open", headers=org_a).json()["items"][3]
    client.post(f"/api/invoices/{inv['id']}/log", headers=org_a, json={"kind": "PAID"})
    assert client.get(f"/api/invoices/{inv['id']}", headers=org_a).json()["paid_date"]
    assert client.post(f"/api/invoices/{inv['id']}/undo", headers=org_a).json()["undone"] == "PAID"
    assert client.get(f"/api/invoices/{inv['id']}", headers=org_a).json()["paid_date"] is None
    client.post(f"/api/invoices/{inv['id']}/log", headers=org_a, json={"kind": "DISPUTE"})
    client.post(f"/api/invoices/{inv['id']}/undo", headers=org_a)
    assert client.get(f"/api/invoices/{inv['id']}", headers=org_a).json()["disputed"] is False


def test_setup_and_counts(client, org_a, org_b):
    st = client.get("/api/setup", headers=org_a).json()
    assert st["customers"] > 0 and st["phones_needed"] > 0 and isinstance(st["upi"], bool)
    c = client.get("/api/invoices/counts", headers=org_a).json()
    assert c["open"] > 0 and c["open"] >= c["overdue"] and c["paid"] > 0
    assert client.get("/api/invoices/counts", headers=org_b).json() == {"open": 0, "overdue": 0, "high": 0, "paid": 0}


def test_no_long_dashes_reach_the_client(client, org_a):
    import re
    pat = re.compile("[\u2012\u2013\u2014\u2015\u2212]")
    for path in ("/api/today", "/api/buyers", "/api/impact", "/api/model", "/api/invoices?limit=300"):
        assert not pat.search(client.get(path, headers=org_a).text), path


def test_demo_login_shared_and_safe(client):
    r1 = client.post("/api/auth/demo")
    assert r1.status_code == 200 and r1.json()["org"]["is_demo"] and r1.json()["org"]["onboarded"]
    h = {"Authorization": "Bearer " + r1.json()["token"]}
    assert client.post("/api/auth/demo").json()["org"]["id"] == r1.json()["org"]["id"]   # same shared business, no re-seed
    assert client.post("/api/reset", headers=h).status_code == 403
    assert client.patch("/api/org", headers=h, json={"name": "Hacked"}).status_code == 403
    assert client.post("/api/import/sample", headers=h).status_code == 403
    assert client.post("/api/import/preview", headers=h, files={"file": ("x.csv", b"a,b\n1,2")}).status_code == 403
    buyer = client.get("/api/buyers", headers=h).json()[0]["id"]
    assert client.patch(f"/api/buyers/{buyer}", headers=h, json={"phone": "9876543210"}).status_code == 403
    assert client.patch(f"/api/buyers/{buyer}", headers=h, json={"language": "hi"}).status_code == 200   # harmless preference
    client.patch(f"/api/buyers/{buyer}", headers=h, json={"language": ""})
    a = next(x for x in client.get("/api/today", headers=h).json()["actions"] if x.get("pay_url"))
    page = client.get("/api/pay/" + a["pay_url"].rsplit("/pay/", 1)[1]).json()
    assert page["demo"] and page["upi_url"] is None and page["qr_svg"] and page["upi_id"] == ""


def test_undo_claim_rejection_restores_claim(client, org_a):
    a = next(x for x in client.get("/api/today", headers=org_a).json()["actions"] if x.get("pay_url"))
    tok = a["pay_url"].rsplit("/pay/", 1)[1]
    client.post(f"/api/pay/{tok}/claim", json={"reference": "UTR999"})
    client.post(f"/api/invoices/{a['id']}/log", headers=org_a, json={"kind": "CLAIM_REJECTED"})
    assert client.post(f"/api/invoices/{a['id']}/undo", headers=org_a).status_code == 200
    assert client.get(f"/api/invoices/{a['id']}", headers=org_a).json()["claim_at"] is not None


def test_forecast_splits_shortfall_by_customer(client, org_a):
    f = client.get("/api/forecast?weeks=12", headers=org_a).json()
    gaps = [g["gap"] for g in f["gap_by_customer"]]
    assert f["gap_weeks"] == 4 and gaps == sorted(gaps, reverse=True) and len(gaps) <= 5
    assert all(g > 0 for g in gaps) and f["gap_total"] >= sum(gaps) - 1


def _ask(client, h, q):
    r = client.post("/api/assistant", headers=h, json={"messages": [{"role": "user", "content": q}]})
    assert r.status_code == 200, r.text
    return r.json()


def test_agent_understands_and_shows_reasoning(client, org_a):
    cases = {"who should I call first?": "priority", "kitna paisa aayega agle 6 hafte": "cash", "किसे कॉल करूं": "priority",
             "who are my worst payers": "risky", "any warnings?": "alerts", "how much interest can I claim": "legal",
             "what is overdue": "overdue", "hello": "help"}
    for q, intent in cases.items():
        r = _ask(client, org_a, q)
        assert r["engine"] == "local" and r["intent"] == intent, (q, r["intent"])
        assert len(r["steps"]) >= 2 and all({"thought", "action", "observation"} <= s.keys() for s in r["steps"])
        assert r["reply"]


def test_agent_entities_credit_and_drafts(client, org_a):
    buyers = client.get("/api/buyers", headers=org_a).json()
    name = next(b["name"] for b in buyers if b["open_amount"] > 0 and not b["name"].startswith("Govt"))
    r = _ask(client, org_a, f"should I accept an order of 5 lakh from {name}?")
    assert r["intent"] == "credit" and name in r["steps"][0]["observation"] and "₹5,00,000" in r["steps"][0]["observation"]
    r = _ask(client, org_a, f"write a reminder to {name} in hindi")
    assert r["intent"] == "draft" and any(ch in r["reply"] for ch in "नमस्ते")     # message actually in Hindi script


def test_briefing_alerts_explain_and_ai_insights(client, org_a):
    b = client.get("/api/briefing", headers=org_a).json()
    assert b["intent"] == "briefing" and len(b["steps"]) >= 4 and "owed" in b["reply"].lower()
    assert isinstance(client.get("/api/alerts", headers=org_a).json(), list)
    inv = client.get("/api/invoices?status=open", headers=org_a).json()["items"][0]["id"]
    ex = client.get(f"/api/invoices/{inv}/explain", headers=org_a).json()
    assert {"predicted_days", "typical_days", "factors"} <= ex.keys()
    ai = client.get("/api/model", headers=org_a).json()["ai"]
    assert ai["importance"] and len(ai["curves"]["risky"]) == 8 and abs(sum(ai["curves"]["risky"]) - 1) < 0.01
