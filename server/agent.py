"""
PayPredict Agent - an on-device ReAct agent (no external LLM needed).

  understand  ->  plan  ->  act (call tools)  ->  observe  ->  reason  ->  answer

* Understanding: a character n-gram + logistic-regression intent model trained at start-up on example
  phrasings in English, Hinglish, Hindi and Marathi, plus entity extraction (customer names by fuzzy
  match, amounts, days, invoice numbers, language).
* Acting: the same grounded tools the Claude assistant uses (predictions, forecast, grades, credit check,
  drafts), so every number in an answer comes from the business's own data.
* Transparency: every step is returned as Thought / Action / Observation, and the UI shows it.
"""
import re
import time
from difflib import SequenceMatcher

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sqlmodel import Session, select

from . import actions as A
from . import credit, ml
from . import services as S
from .assistant import run_tool
from .db import Buyer, Invoice, Org

# ------------------------------------------------------------------ 1. intent model
EXAMPLES = {
    "briefing": ["what should i do today", "give me a summary", "how is my business doing", "brief me", "morning briefing",
                 "overview of receivables", "what's the situation", "status update", "aaj kya karna hai", "business ka haal batao",
                 "आज क्या करना है", "मेरा बिज़नेस कैसा चल रहा है", "आज काय करायचं", "summary do", "daily report"],
    "priority": ["who should i call first", "whom should i chase today", "which invoices to follow up", "top priority invoices",
                 "who to remind", "kisko call karu", "kisse paisa mangu", "किसे कॉल करूं", "किससे पैसे मांगूं", "कोणाला फोन करू",
                 "most urgent collections", "which customers need follow up today", "list of actions"],
    "cash": ["how much cash will come", "cash forecast", "how much money will i collect next month", "cash flow next 4 weeks",
             "will i have enough money for salaries", "expected collections", "kitna paisa aayega", "paisa kab aayega",
             "कितना पैसा आएगा", "पैसे कब आएंगे", "किती पैसे येतील", "cash gap", "shortfall this month", "money coming in"],
    "risky": ["who are my worst payers", "which customers should i stop giving credit", "risky customers", "slow payers",
              "which customers pay late", "grade d customers", "sabse late kaun deta hai", "kaun sabse der se payment karta hai",
              "कौन सबसे देर से भुगतान करता है", "खराब ग्राहक", "उशिरा पैसे देणारे ग्राहक", "high risk customers", "bad payers"],
    "customer": ["tell me about kaveri", "how does shivneri pay", "what is the record of deccan", "customer details",
                 "kaveri ka record dikhao", "kaveri ke baare mein batao", "is aadi infra a good customer", "how reliable is narmada",
                 "show customer history", "shivneri ka payment history"],
    "overdue": ["which invoices are overdue", "what is overdue", "pending payments past due", "late invoices", "baki payment",
                "kaun sa payment atka hai", "बकाया भुगतान", "थकबाकी", "overdue list", "unpaid past due date"],
    "draft": ["draft a message for shivneri", "write a reminder to kaveri", "write reminder in hindi", "message likho",
              "reminder bhejo", "संदेश लिखो", "मेसेज लिहा", "compose whatsapp message", "write a polite note", "prepare a reminder"],
    "credit": ["can i give credit to kaveri", "should i accept an order of 5 lakh from deccan", "new order approve karu",
               "is it safe to give 3 lakh credit", "check this order", "naya order lena chahiye", "क्या मैं उधार दूं",
               "उधारी द्यावी का", "credit limit for shivneri", "should i ship on credit"],
    "explain": ["why is shivneri risky", "why will this be late", "explain the prediction", "why do you think kaveri will pay late",
                "kyun late hoga", "reason for delay", "क्यों देर होगी", "का उशीर होईल", "what drives the risk", "why this recommendation"],
    "alerts": ["any warnings", "who is getting slower", "early warning", "any red flags", "changes in payment behaviour",
               "kaun slow ho raha hai", "kuch gadbad", "कोई चेतावनी", "anomalies", "what changed recently"],
    "impact": ["how accurate is the ai", "is it working", "how much did i save", "model accuracy", "can i trust the predictions",
               "kitna fayda hua", "कितना फायदा हुआ", "results so far", "how good is the model"],
    "legal": ["how much interest can i claim", "msmed interest", "legal notice", "45 day law", "section 43b", "interest owed",
              "kanooni notice", "ब्याज कितना बनता है", "samadhaan", "can i charge interest"],
    "help": ["hi", "hello", "what can you do", "help", "namaste", "नमस्ते", "who are you", "how do i use this", "thanks", "ok"],
}
_texts, _labels = zip(*[(t, k) for k, v in EXAMPLES.items() for t in v])
INTENT_MODEL = make_pipeline(TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True),
                             LogisticRegression(C=8, max_iter=2000)).fit(_texts, _labels)

INTENT_LABEL = {
    "briefing": "daily briefing", "priority": "who to chase today", "cash": "cash forecast", "risky": "risky customers",
    "customer": "customer profile", "overdue": "overdue invoices", "draft": "draft a message", "credit": "credit check",
    "explain": "explain a prediction", "alerts": "early warnings", "impact": "AI accuracy & impact", "legal": "legal interest",
    "help": "help",
}

# ------------------------------------------------------------------ 2. entity extraction
_STOP = {"ltd", "pvt", "private", "limited", "the", "and", "co", "company", "india", "of", "office", "govt", "procurement"}


def _lang(q: str) -> str:
    ql = q.lower()
    if "marathi" in ql or "मराठी" in q:
        return "mr"
    if "hindi" in ql or "हिंदी" in q:
        return "hi"
    if re.search(r"[ऀ-ॿ]", q):
        return "mr" if re.search(r"(आहे|काय|कोण|किती|द्यावी|लिहा|मध्ये|करू(?![ंँ]))", q) else "hi"
    return "en"


def _amount(q: str) -> float | None:
    m = re.search(r"(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(lakh|lac|l\b|cr|crore|k\b|thousand)?", q.lower())
    if not m:
        return None
    n = float(m.group(1).replace(",", ""))
    unit = m.group(2) or ""
    n *= 1e5 if unit in ("lakh", "lac", "l") else 1e7 if unit in ("cr", "crore") else 1e3 if unit in ("k", "thousand") else 1
    return n if n >= 1000 else None


def _days(q: str) -> int | None:
    m = re.search(r"(\d{1,3})\s*(?:days?|din|दिन|दिवस)", q.lower())
    return int(m.group(1)) if m else None


def _weeks(q: str) -> int | None:
    m = re.search(r"(\d{1,2})\s*(?:weeks?|hafte|हफ्ते|आठवडे)", q.lower())
    if m:
        return int(m.group(1))
    return 4 if re.search(r"month|mahine|महीने|महिन", q.lower()) else None


def _find_customer(q: str, buyers: list[Buyer], s: Session | None = None) -> tuple[Buyer | None, list[Buyer]]:
    """Fuzzy-match a customer named in the question. Returns (best, other close matches).
    An exact match on the first distinctive word counts; ties go to the customer owing the most."""
    ql = q.lower()
    num = re.search(r"#\s?(\d{2,4})", ql)
    words = [w for w in re.findall(r"[a-z]{3,}", ql) if w not in _STOP]
    scored = []
    for b in buyers:
        name = b.name.lower()
        if num and f"#{num.group(1)}" in name.replace("# ", "#"):
            return b, []
        toks = [t for t in re.findall(r"[a-z]{3,}", name) if t not in _STOP]
        if not toks or not words:
            continue
        r = [max(SequenceMatcher(None, w, t).ratio() for w in words) for t in toks[:2]]
        sc = max(r[0] * 0.85 + (r[1] if len(r) > 1 else 0) * 0.15, sum(r) / len(r))
        if sc >= 0.8:
            scored.append((round(sc, 2), b))
    if not scored:
        return None, []
    top = max(sc for sc, _ in scored)
    cands = [b for sc, b in scored if sc >= top - 0.005]   # exact best match wins; true ties go to who owes most
    if len(cands) > 1 and s is not None:
        owed = {b.id: sum(i.amount for i in s.exec(select(Invoice).where(Invoice.buyer_id == b.id, Invoice.paid_date.is_(None))).all()) for b in cands}
        cands.sort(key=lambda b: -owed[b.id])
    return cands[0], cands[1:4]


# ------------------------------------------------------------------ 3. the agent
class Trace:
    def __init__(self):
        self.steps: list[dict] = []

    def step(self, thought: str, action: str, fn, observe):
        t = time.perf_counter()
        out = fn()
        self.steps.append(dict(thought=thought, action=action, observation=observe(out),
                               ms=round((time.perf_counter() - t) * 1000)))
        return out


def _lc(t: str) -> str:
    """Lower-case only the first letter, so acronyms like TReDS survive mid-sentence."""
    return t[:1].lower() + t[1:] if t else t


def _date(iso: str) -> str:
    from datetime import date as _d
    return _d.fromisoformat(iso[:10]).strftime("%d %b").lstrip("0")


def _link_inv(v):
    return {"type": "invoice", "id": v["id"], "label": f"{v['buyer_name'][:28]} · {A.short_inr(v['amount'])}"}


def _link_cust(c):
    return {"type": "customer", "id": c["id"], "label": f"{c['name'][:30]} ({c['grade'] or '-'})"}


def customer_alerts(s: Session, org: Org, limit: int = 5) -> list[dict]:
    """Early warnings: behaviour-change detection on each customer's own payment history."""
    out = []
    cards = S.buyer_scorecard(s, org.id)
    for c in cards:
        if c["avg_days_late"] is None or c["recent_days_late"] is None or c["open_amount"] <= 0:
            continue
        shift = c["recent_days_late"] - c["avg_days_late"]
        if shift >= 8 and c["invoices_12m"] >= 4:
            out.append(dict(kind="slowing", customer_id=c["id"], name=c["name"], severity=shift * c["open_amount"],
                            text=f"{c['name']} is paying {shift:.0f} days slower than usual (last 3 invoices ~{c['recent_days_late']:.0f} days late"
                                 f" vs their usual {c['avg_days_late']:.0f}) while owing {A.short_inr(c['open_amount'])}."))
        elif c["overdue_amount"] > 0 and c["grade"] in ("A", "B") and c["overdue_amount"] >= 0.5 * c["open_amount"]:
            out.append(dict(kind="unusual", customer_id=c["id"], name=c["name"], severity=c["overdue_amount"] * 5,
                            text=f"{c['name']} normally pays well (grade {c['grade']}) but {A.short_inr(c['overdue_amount'])} "
                                 "is overdue - unusual for them, worth a quick call."))
    total_open = sum(c["open_amount"] for c in cards) or 1
    top = max(cards, key=lambda c: c["open_amount"], default=None)
    if top and top["open_amount"] / total_open >= 0.08:
        out.append(dict(kind="concentration", customer_id=top["id"], name=top["name"], severity=top["open_amount"] * 0.5,
                        text=f"{top['name']} alone holds {top['open_amount'] / total_open:.0%} of everything you are owed "
                             f"({A.short_inr(top['open_amount'])}) - a concentration risk."))
    return sorted(out, key=lambda a: -a["severity"])[:limit]


def run(s: Session, org: Org, question: str, force_intent: str | None = None) -> dict:
    t0 = time.perf_counter()
    tr = Trace()
    buyers = s.exec(select(Buyer).where(Buyer.org_id == org.id)).all()

    # ---- understand
    probs = INTENT_MODEL.predict_proba([question.lower()])[0]
    order = np.argsort(-probs)
    intent, conf = INTENT_MODEL.classes_[order[0]], float(probs[order[0]])
    if force_intent:
        intent, conf = force_intent, 1.0
    cust, also = _find_customer(question, buyers, s)
    lang, amount, days, weeks = _lang(question), _amount(question), _days(question), _weeks(question)
    inv_no = re.search(r"inv[-\s]?\d{3,6}", question, re.I)
    # entity-driven corrections (a named customer + money usually means a credit check, etc.)
    if amount and cust and intent not in ("credit", "legal"):
        intent, conf = "credit", max(conf, 0.6)
    elif cust and intent in ("help", "briefing", "risky", "priority") and conf < 0.5:
        intent = "customer"
    ents = [f"customer = {cust.name}" + (f" (also matches {', '.join(b.name for b in also)})" if also else "") if cust else None, f"amount = {A.inr(amount)}" if amount else None,
            f"credit days = {days}" if days else None, f"weeks = {weeks}" if weeks else None,
            f"invoice = {inv_no.group(0).upper()}" if inv_no else None, f"language = {lang}" if lang != "en" else None]
    tr.steps.append(dict(
        thought="Understand the question: what is being asked, and about whom?",
        action="intent_model.classify + extract_entities",
        observation=f"Intent: {INTENT_LABEL[intent]} ({conf:.0%} confident"
                    + (f"; next best: {INTENT_LABEL[INTENT_MODEL.classes_[order[1]]]} {probs[order[1]]:.0%}" if conf < 0.75 else "")
                    + "). " + ("Entities: " + ", ".join(e for e in ents if e) if any(ents) else "No specific customer or amount mentioned."),
        ms=round((time.perf_counter() - t0) * 1000)))

    handler = HANDLERS.get(intent, _help)
    ans = handler(s, org, tr, dict(question=question, customer=cust, amount=amount, days=days, weeks=weeks,
                                    lang=lang, invoice=inv_no.group(0).upper().replace(" ", "-") if inv_no else None))
    return {"engine": "local", "intent": intent, "confidence": conf, "steps": tr.steps,
            "reply": ans["reply"], "links": ans.get("links", []), "suggestions": ans.get("suggestions", []),
            "ms": round((time.perf_counter() - t0) * 1000)}


# ------------------------------------------------------------------ 4. skills (plan + reason + answer)
def _briefing(s, org, tr, e):
    sm = tr.step("Start with the big picture: how much is owed, overdue and at risk?", "get_business_summary()",
                 lambda: S.summary(s, org),
                 lambda o: f"Owed {A.short_inr(o['outstanding'])}; overdue {A.short_inr(o['overdue'])}; likely late {A.short_inr(o['at_risk'])}; "
                           f"4-week gap {A.short_inr(o['cash_gap_4w'])}.")
    acts = tr.step("Which customers deserve attention today? Rank by money at stake.", "list_invoices(filter='priority', limit=3)",
                   lambda: S.today_list(s, org, 3),
                   lambda o: "; ".join(f"{v['buyer_name'][:24]} {A.short_inr(v['amount'])} -> {v['action_short']}" for v in o) or "nothing urgent")
    alerts = tr.step("Has anyone's behaviour changed recently? Run early-warning detection.", "detect_behaviour_changes()",
                     lambda: customer_alerts(s, org, 3),
                     lambda o: f"{len(o)} warning(s)" + (": " + "; ".join(a["name"][:24] for a in o) if o else ""))
    tr.steps.append(dict(thought="Combine: lead with the cash outlook, then the 3 actions, then the warnings.",
                         action="compose_answer()", observation="Briefing ready.", ms=0))
    lines = [f"**You're owed {A.short_inr(sm['outstanding'])}.** Over the next 4 weeks expect about "
             f"**{A.short_inr(sm['expected_4w'])}**, which is {A.short_inr(sm['cash_gap_4w'])} less than your due dates suggest - "
             "plan payments around the real number.", "", "**Do these first:**"]
    lines += [f"- {v['buyer_name']} ({A.short_inr(v['amount'])}): {_lc(v['action_title'])}" for v in acts]
    if alerts:
        lines += ["", "**Watch out:**"] + [f"- {a['text']}" for a in alerts[:2]]
    return {"reply": "\n".join(lines), "links": [_link_inv(v) for v in acts],
            "suggestions": ["How much cash will come in this month?", "Who is getting slower?", "Who are my worst payers?"]}


def _priority(s, org, tr, e):
    acts = tr.step("Rank open invoices by amount × chance of delay × how overdue they are.", "list_invoices(filter='priority', limit=5)",
                   lambda: S.today_list(s, org, 5), lambda o: f"{len(o)} customers need action today.")
    tr.steps.append(dict(thought="For each, state the recommended step and the AI's main reason.", action="compose_answer()",
                         observation="Done.", ms=0))
    if not acts:
        return {"reply": "Nothing urgent today - every invoice looks on track. I'll keep watching.", "suggestions": ["Any warnings?"]}
    lines = ["Call or message these customers first, in this order:"]
    for i, v in enumerate(acts, 1):
        why = (v["reasons"] or [""])[0]
        lines.append(f"{i}. **{v['buyer_name']}** - {A.short_inr(v['amount'])}, {_lc(v['action_title'])}" + (f" ({why.lower()})" if why else ""))
    return {"reply": "\n".join(lines), "links": [_link_inv(v) for v in acts],
            "suggestions": [f"Draft a message for {acts[0]['buyer_name'].split(' (')[0]}", "Why is the first one risky?", "Brief me on today"]}


def _cash(s, org, tr, e):
    w = e["weeks"] or 4
    fc = tr.step(f"Simulate 1,000 possible futures of every unpaid invoice over the next {w} weeks.", f"cash_forecast(weeks={w})",
                 lambda: S.forecast(s, org.id, weeks=max(w, 1), gap_weeks=min(w, 12)),
                 lambda o: f"Expected {A.short_inr(o['weeks'][-1]['cum_expected'])} vs {A.short_inr(o['weeks'][-1]['cum_assumed'])} due.")
    last = fc["weeks"][-1]
    tight = min(fc["weeks"], key=lambda x: x["expected"] - x["assumed"])
    tr.steps.append(dict(thought="Find the tightest week and who is holding the cash.", action="analyse_forecast()",
                         observation=f"Tightest week starts {tight['week']}; top holder {fc['gap_by_customer'][0]['name'][:28] if fc['gap_by_customer'] else '-'}.", ms=0))
    gap = last["cum_assumed"] - last["cum_expected"]
    lines = [f"Over the next {w} weeks you'll most likely collect **{A.short_inr(last['cum_expected'])}** "
             f"(likely range {A.short_inr(last['cum_low'])} to {A.short_inr(last['cum_high'])}).",
             f"Due dates promise {A.short_inr(last['cum_assumed'])}, so plan for about **{A.short_inr(max(gap, 0))} arriving late**."]
    if fc["gap_by_customer"]:
        lines += ["", "**Who is holding most of it:**"] + [f"- {g['name']}: {A.short_inr(g['gap'])}" for g in fc["gap_by_customer"][:3]]
    return {"reply": "\n".join(lines), "links": [{"type": "customer", "id": g["buyer_id"], "label": g["name"][:30]} for g in fc["gap_by_customer"][:3]],
            "suggestions": ["Who should I call first?", "How much cash in 12 weeks?", "Any warnings?"]}


def _risky(s, org, tr, e):
    cards = tr.step("Grade every customer on the last 12 months of real payments and rank by money at risk.",
                    "list_customers(grade='any')", lambda: S.buyer_scorecard(s, org.id),
                    lambda o: f"{sum(1 for c in o if c['grade'] == 'D')} grade-D and {sum(1 for c in o if c['grade'] == 'C')} grade-C customers.")
    bad = [c for c in cards if c["grade"] in ("C", "D") and c["open_amount"] > 0][:5]
    tr.steps.append(dict(thought="Recommend a credit policy for each based on grade and exposure.", action="compose_answer()",
                         observation=f"{len(bad)} customers flagged.", ms=0))
    if not bad:
        return {"reply": "Good news: none of your customers who owe money are grade C or D right now."}
    lines = ["These customers pay late most often and owe you money now:"]
    lines += [f"- **{c['name']}** (grade {c['grade']}): usually ~{c['avg_days_late']:.0f} days late, owes {A.short_inr(c['open_amount'])}. {c['advice']}" for c in bad]
    return {"reply": "\n".join(lines), "links": [_link_cust(c) for c in bad],
            "suggestions": [f"Should I give credit to {bad[0]['name'].split(' (')[0]}?", "Who is getting slower?"]}


def _need_customer(e, what):
    return {"reply": f"Which customer should I {what}? Try including their name, e.g. \"{what} Kaveri\".",
            "suggestions": ["Who are my worst payers?", "Who should I call first?"]}


def _customer(s, org, tr, e):
    b = e["customer"]
    if not b:
        return _need_customer(e, "look up")
    c = tr.step(f"Pull {b.name}'s scorecard and open invoices.", f"get_customer(name='{b.name}')",
                lambda: run_tool(s, org, "get_customer", {"name": b.name}),
                lambda o: f"Grade {o.get('grade')}, ~{(o.get('avg_days_late') or 0):.0f} days late on average, owes {A.short_inr(o.get('open_amount', 0))}.")
    trend = {"worse": "getting slower", "better": "improving", "steady": "steady"}.get(c.get("trend"), "not enough history")
    tr.steps.append(dict(thought="Summarise reliability, trend and what to do.", action="compose_answer()", observation="Done.", ms=0))
    lines = [f"**{c['name']}** - grade **{c.get('grade') or '-'}**, {trend}.",
             f"- Usually pays ~{(c.get('avg_days_late') or 0):.0f} days after the due date; {(c.get('pct_late15') or 0):.0%} of invoices were 15+ days late.",
             f"- Owes {A.short_inr(c.get('open_amount', 0))} now ({A.short_inr(c.get('overdue_amount', 0))} overdue).",
             f"- Advice: {c.get('advice')}"]
    inv = s.exec(select(Invoice).where(Invoice.buyer_id == b.id, Invoice.paid_date.is_(None)).order_by(Invoice.priority.desc())).first()
    return {"reply": "\n".join(lines), "links": [{"type": "customer", "id": b.id, "label": b.name[:30]}] +
            ([{"type": "invoice", "id": inv.id, "label": f"Top invoice {inv.number}"}] if inv else []),
            "suggestions": [f"Draft a message for {b.name}", f"Should I give 2 lakh credit to {b.name}?", f"Why is {b.name} risky?"]}


def _overdue(s, org, tr, e):
    r = tr.step("List invoices already past their due date, oldest first.", "list_invoices(filter='overdue', limit=6)",
                lambda: run_tool(s, org, "list_invoices", {"filter": "overdue", "limit": 6}), lambda o: f"{o['count']} overdue invoices.")
    sm = S.summary(s, org)
    lines = [f"**{r['count']} invoices are overdue**, worth {A.short_inr(sm['overdue'])}. The oldest:"]
    lines += [f"- {v['buyer_name']} {v['number']}: {v['amount']}, {v['days_overdue']} days overdue" for v in r["invoices"]]
    return {"reply": "\n".join(lines), "suggestions": ["Who should I call first?", "How much interest can I claim?"]}


def _target_invoice(s, org, e):
    if e["invoice"]:
        return s.exec(select(Invoice).where(Invoice.org_id == org.id, Invoice.number == e["invoice"])).first()
    q = select(Invoice).where(Invoice.org_id == org.id, Invoice.paid_date.is_(None))
    if e["customer"]:
        q = q.where(Invoice.buyer_id == e["customer"].id)
    return s.exec(q.order_by(Invoice.priority.desc())).first()


def _draft(s, org, tr, e):
    inv = tr.step("Pick the invoice to write about (named one, or the customer's most urgent).", "find_invoice()",
                  lambda: _target_invoice(s, org, e), lambda o: f"{o.number} ({A.short_inr(o.amount)})" if o else "none found")
    if not inv:
        return _need_customer(e, "write to")
    b = s.get(Buyer, inv.buyer_id)
    lang = e["lang"] if e["lang"] != "en" or "english" in e["question"].lower() else (b.language or org.language)
    lever = inv.action if inv.action not in A.INTERNAL else "REMINDER"   # asked for a message: always customer-facing
    d = tr.step(f"Use the lever the decision engine recommends ({A.ACTIONS[lever][0].lower()}) and write it in "
                f"{dict(en='English', hi='Hindi', mr='Marathi')[lang]}.", f"draft_message(invoice='{inv.number}', language='{lang}')",
                lambda: {"action": A.ACTIONS[lever][1], "message": A.draft(lever, dict(
                    amount=inv.amount, invoice_date=inv.invoice_date, due_date=inv.due_date, number=inv.number,
                    buyer_name=b.name, is_government=b.is_government), S.org_dict(org), lang, S.today())},
                lambda o: f"Lever: {o['action']}.")
    return {"reply": f"Recommended step: **{d['action']}**. Here is the message for {b.name} ({inv.number}):\n\n" + (d.get("message") or ""),
            "links": [{"type": "invoice", "id": inv.id, "label": f"Open {inv.number} to send"}],
            "suggestions": [f"Write it in Hindi for {b.name}", f"Why is {b.name} risky?"]}


def _credit(s, org, tr, e):
    b = e["customer"]
    if not b:
        return _need_customer(e, "credit-check")
    amt = e["amount"] or 100000
    days = e["days"] or 30
    r = tr.step(f"Score a hypothetical {A.inr(amt)} invoice from {b.name} dated today on {days}-day credit with the time-to-payment model.",
                f"credit_check(customer='{b.name}', amount={amt:.0f}, credit_days={days})",
                lambda: credit.check_order(s, org, b.id, None, amt, days, e["lang"] if e["lang"] != "en" else None),
                lambda o: f"{o['p_late']:.0%} chance of 15+ days late; exposure after {A.short_inr(o['exposure_after'])}"
                          + (f" vs safe limit {A.short_inr(o['suggested_limit'])}" if o.get("suggested_limit") else "") + f"; verdict {o['verdict']}.")
    lines = [f"**{r['headline']}** for {A.inr(amt)} to {b.name} on {days}-day credit.",
             f"- Expected payment ~{_date(r['expected_pay_date'])} ({r['p_late']:.0%} chance of 15+ days late)."]
    lines += [f"- {c}" for c in r["conditions"][:3]]
    if not e["amount"]:
        lines.append("_I assumed ₹1,00,000 - tell me the order value for an exact check._")
    return {"reply": "\n".join(lines), "links": [{"type": "customer", "id": b.id, "label": b.name[:30]}],
            "suggestions": [f"Tell me about {b.name}", "Who are my worst payers?"]}


def _explain(s, org, tr, e):
    inv = tr.step("Find the invoice to explain.", "find_invoice()", lambda: _target_invoice(s, org, e),
                  lambda o: f"{o.number}" if o else "none")
    if not inv:
        return _need_customer(e, "explain")
    ex = tr.step("Re-run the model with each factor reset to a typical value; measure how many days each one adds.",
                 f"explain_prediction(invoice='{inv.number}')", lambda: explain_invoice(s, org, inv),
                 lambda o: "; ".join(f"{f['label']} +{f['days']:.0f}d" for f in o["factors"][:3]) or "no strong factors")
    b = s.get(Buyer, inv.buyer_id)
    lines = [f"When {inv.number} was raised, the model expected **{b.name}** to pay about **{ex['predicted_days']:.0f} days after the due date** "
             f"(a typical invoice: {ex['typical_days']:.0f} days). What pushes it later:"]
    lines += [f"- {f['label']}: **+{f['days']:.0f} days**" for f in ex["factors"][:4] if f["days"] > 0]
    return {"reply": "\n".join(lines), "links": [{"type": "invoice", "id": inv.id, "label": f"See {inv.number}"}],
            "suggestions": [f"Draft a message for {b.name}", f"Tell me about {b.name}"]}


def _alerts(s, org, tr, e):
    al = tr.step("Compare each customer's last 3 payments with their own long-run habit; flag big shifts and concentration.",
                 "detect_behaviour_changes()", lambda: customer_alerts(s, org, 5), lambda o: f"{len(o)} warning(s).")
    if not al:
        return {"reply": "No warning signs right now - customers are paying in line with their usual habits."}
    return {"reply": "**Early warnings:**\n" + "\n".join(f"- {a['text']}" for a in al),
            "links": [{"type": "customer", "id": a["customer_id"], "label": a["name"][:30]} for a in al[:3]],
            "suggestions": [f"Tell me about {al[0]['name']}", "Who should I call first?"]}


def _impact(s, org, tr, e):
    from .db import ModelRun
    import json
    run_ = tr.step("Read the latest honest back-test of the model on this ledger.", "get_model_metrics()",
                   lambda: s.exec(select(ModelRun).where(ModelRun.org_id == org.id).order_by(ModelRun.trained_at.desc())).first(),
                   lambda o: "found" if o else "no model yet")
    im = tr.step("Measure results of actions taken so far against the AI's own forecasts.", "get_impact()",
                 lambda: S.impact(s, org, brief=True), lambda o: f"{o['actions_taken']} actions, {A.short_inr(o['collected_after_action'])} collected.")
    m = json.loads(run_.metrics) if run_ else {}
    lines = []
    if m.get("available"):
        lines.append(f"On {m['n_test']:,} invoices it never saw, the AI predicted payment dates within **±{m['mae_days']:.0f} days** on average "
                     f"(±{m['mae_days_due_date']:.0f} if you trust due dates), and ranks risk with AUC **{m['auc']:.2f}** "
                     f"(customer averages: {m['auc_baseline']:.2f}).")
    lines.append(f"So far: {im['actions_taken']} actions taken, {A.short_inr(im['collected_after_action'])} collected within 30 days of an action, "
                 f"{im['days_saved']:.0f} days saved against forecast.")
    return {"reply": "\n".join(lines), "suggestions": ["Who should I call first?", "Brief me on today"]}


def _legal(s, org, tr, e):
    from . import payments as P
    q = select(Invoice).where(Invoice.org_id == org.id, Invoice.paid_date.is_(None))
    if e["customer"]:
        q = q.where(Invoice.buyer_id == e["customer"].id)
    invs = s.exec(q).all()
    t = S.today()
    rows = tr.step("Compute MSMED Sec 16 interest (3x RBI bank rate, compounded monthly) on every invoice past the legal limit.",
                   "msmed_interest(open_invoices)", lambda: [(i, P.msmed_interest(i.amount, i.invoice_date, i.due_date, t, org.bank_rate)) for i in invs],
                   lambda o: f"{sum(1 for _, x in o if x['applies'])} invoices accrue interest.")
    hit = sorted([(i, x) for i, x in rows if x["applies"]], key=lambda p: -p[1]["interest"])
    total = sum(x["interest"] for _, x in hit)
    who = f" from {e['customer'].name}" if e["customer"] else ""
    lines = [f"You can legally claim about **{A.inr(total)} in interest**{who} under the MSMED Act (Sec 16) on {len(hit)} invoices, "
             f"at {3 * org.bank_rate:.2%} a year compounded monthly."]
    lines += [f"- {s.get(Buyer, i.buyer_id).name} {i.number}: {A.inr(x['interest'])} ({x['days']} days)" for i, x in hit[:4]]
    lines.append("Open a customer and use *Legal notice with interest* to generate the letter (review with your CA).")
    return {"reply": "\n".join(lines), "links": [{"type": "invoice", "id": i.id, "label": f"{i.number}"} for i, _ in hit[:3]],
            "suggestions": ["Who should I call first?", "Any warnings?"]}


def _help(s, org, tr, e):
    tr.steps.append(dict(thought="General question - explain what I can do.", action="compose_answer()", observation="Done.", ms=0))
    return {"reply": "I'm your AI credit manager. I look at your real invoices and can:\n"
                     "- tell you **who to chase today** and why\n- **forecast your cash** for the coming weeks\n"
                     "- spot **customers who are slowing down**\n- **check a new order** before you give credit\n"
                     "- **explain** any prediction, and **write the message** in English, हिंदी or मराठी",
            "suggestions": ["Brief me on today", "Who should I call first?", "How much cash will come this month?", "Any warnings?"]}


HANDLERS = {"briefing": _briefing, "priority": _priority, "cash": _cash, "risky": _risky, "customer": _customer,
            "overdue": _overdue, "draft": _draft, "credit": _credit, "explain": _explain, "alerts": _alerts,
            "impact": _impact, "legal": _legal, "help": _help}


# ------------------------------------------------------------------ 5. explainability for one invoice
FACTOR_LABEL = {
    "hist_last3_avg_days_late": "Their last 3 payments were late", "hist_avg_days_late": "Their usual delay",
    "hist_pct_late15": "How often they pay 15+ days late", "hist_max_days_late": "Their worst past delay",
    "hist_n_paid": "Amount of payment history", "disputed": "Open dispute", "docs_pending": "Paperwork pending",
    "open_overdue_count": "Other invoices already overdue", "open_exposure_lakh": "Total they already owe",
    "amount_vs_usual": "Bill size vs their usual", "log_amount": "Invoice amount", "is_government": "Government buyer",
    "invoice_month": "Season (month raised)", "credit_terms": "Credit period", "days_since_last_payment": "Time since last payment",
    "tenure_days": "Length of relationship", "segment": "Customer segment", "treds_onboarded": "On TReDS",
}


def explain_invoice(s: Session, org: Org, inv: Invoice) -> dict:
    """Ablation explanation for one invoice: days of expected delay each factor adds vs a typical invoice."""
    df = S.frame(s, org.id)
    df = df[df["buyer_id"] == inv.buyer_id]
    F = ml.build_features(df, S.today())
    row = F[F["id"] == inv.id].copy()
    row["age"] = -row["credit_terms"]          # explain the forecast as made when the invoice was raised
    bundle, kind = S.org_bundle(org.id, s)
    pred = float(ml.distribution(bundle, row)["q50"][0])
    typical = row.copy()
    for c in ml.FEATURES:
        typical[c] = bundle["typical"][c]
    typ = float(ml.distribution(bundle, typical)["q50"][0])
    d = ml.reason_deltas(bundle, row).iloc[0].to_dict()
    factors = sorted([dict(feature=k, label=FACTOR_LABEL.get(k, k), days=float(v)) for k, v in d.items() if abs(v) >= 0.5],
                     key=lambda f: -f["days"])
    return {"predicted_days": pred, "typical_days": typ, "factors": factors[:8], "model": kind}
