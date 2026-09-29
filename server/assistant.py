"""
"Ask PayPredict" - a Claude-powered assistant grounded in the business's own receivables.

Claude never sees the whole database; it calls tools that query this org's data, so every
number it states comes from the ledger. Works only when an Anthropic API key is configured.
"""
import json
import os

import anthropic
from sqlmodel import Session, select

from . import actions as A
from . import services as S
from .db import Buyer, Invoice, Org

MODEL = "claude-opus-5-5"

SYSTEM = """You are PayPredict, a friendly receivables assistant for an Indian MSME owner.
You help them get paid faster: who to chase today, which customers are risky, how much cash is coming, and what to say.

Rules:
- Always use the tools to get numbers. Never invent or estimate figures the tools did not return.
- Speak plainly to a busy business owner who may not know finance jargon. Explain terms like TReDS or 43B(h) in one short phrase when you use them.
- Use Indian formats: ₹, lakh and crore (e.g. ₹4.8 L, ₹1.2 Cr), dates like 12 Oct.
- Be brief: a short answer, then at most 5 bullet points. Lead with the action.
- If asked to write a message, use the draft_message tool and then offer to adjust tone.
- You give business guidance, not legal advice; for legal escalation suggest confirming with their CA or lawyer.
- If the user writes in Hindi or Marathi, reply in that language."""

TOOLS = [
    {"name": "get_business_summary",
     "description": "Headline numbers: outstanding receivables, overdue amount, amount likely to be paid late, "
                    "invoices crossing the 45-day legal limit, interest cost of delays, 4-week cash gap, DSO.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "list_invoices",
     "description": "List open (unpaid) invoices with risk, expected payment date and recommended action.",
     "input_schema": {"type": "object", "properties": {
         "filter": {"type": "string", "enum": ["priority", "high_risk", "overdue", "due_soon", "all_open"],
                    "description": "priority = today's action list; due_soon = due in the next 14 days"},
         "customer_name": {"type": "string", "description": "Optional: only this customer (partial name ok)"},
         "limit": {"type": "integer", "description": "Max rows, default 10"}},
         "required": ["filter"], "additionalProperties": False}},
    {"name": "get_customer",
     "description": "Payment behaviour scorecard for one customer (grade A-D, average delay, trend, open amount, advice) "
                    "plus their open invoices.",
     "input_schema": {"type": "object", "properties": {"name": {"type": "string"}},
                      "required": ["name"], "additionalProperties": False}},
    {"name": "list_customers",
     "description": "Customers ranked by money at risk, with grade and average delay.",
     "input_schema": {"type": "object", "properties": {
         "grade": {"type": "string", "enum": ["A", "B", "C", "D", "any"]},
         "limit": {"type": "integer"}}, "required": ["grade"], "additionalProperties": False}},
    {"name": "cash_forecast",
     "description": "Week-by-week expected collections for the next N weeks vs what due dates suggest, with a likely range.",
     "input_schema": {"type": "object", "properties": {"weeks": {"type": "integer", "description": "1-12"}},
                      "required": ["weeks"], "additionalProperties": False}},
    {"name": "draft_message",
     "description": "Draft the recommended collection message for an invoice.",
     "input_schema": {"type": "object", "properties": {
         "invoice_number": {"type": "string"},
         "language": {"type": "string", "enum": ["en", "hi", "mr"]}},
         "required": ["invoice_number", "language"], "additionalProperties": False}},
]


def configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def _brief(v: dict) -> dict:
    keys = ["number", "buyer_name", "amount", "due_date", "status", "days_overdue", "risk", "expected_pay_date",
            "action_title", "rationale", "reasons", "promise_date", "disputed"]
    out = {k: v.get(k) for k in keys}
    out["amount"] = A.inr(v["amount"])
    out["risk"] = f"{v['risk']:.0%} chance of paying 15+ days late"
    return out


def run_tool(s: Session, org: Org, name: str, args: dict):
    t = S.today()
    buyers = {b.id: b for b in s.exec(select(Buyer).where(Buyer.org_id == org.id)).all()}
    if name == "get_business_summary":
        sm = S.summary(s, org)
        return {k: (A.short_inr(v) if isinstance(v, float) and k not in ("dso",) else v) for k, v in sm.items()}
    if name == "list_invoices":
        limit = min(int(args.get("limit") or 10), 25)
        q = select(Invoice).where(Invoice.org_id == org.id, Invoice.paid_date.is_(None))
        f = args["filter"]
        if f == "priority":
            return [_brief(v) for v in S.today_list(s, org, limit)]
        invs = s.exec(q).all()
        name_q = (args.get("customer_name") or "").lower()
        if name_q:
            invs = [i for i in invs if name_q in buyers[i.buyer_id].name.lower()]
        if f == "high_risk":
            invs = sorted([i for i in invs if (i.p_late or 0) >= 0.5], key=lambda i: -i.amount * (i.p_late or 0))
        elif f == "overdue":
            invs = sorted([i for i in invs if i.due_date < t], key=lambda i: i.due_date)
        elif f == "due_soon":
            invs = sorted([i for i in invs if 0 <= (i.due_date - t).days <= 14], key=lambda i: i.due_date)
        else:
            invs = sorted(invs, key=lambda i: -(i.priority or 0))
        return {"count": len(invs), "invoices": [_brief(S.invoice_view(i, buyers[i.buyer_id], t)) for i in invs[:limit]]}
    if name in ("get_customer", "list_customers"):
        cards = S.buyer_scorecard(s, org.id)
        if name == "list_customers":
            g = args.get("grade", "any")
            cards = [c for c in cards if g == "any" or c["grade"] == g][: min(int(args.get("limit") or 10), 25)]
            return [{k: c[k] for k in ("name", "grade", "avg_days_late", "trend", "open_amount", "at_risk", "advice")}
                    for c in cards]
        q = args["name"].lower()
        match = [c for c in cards if q in c["name"].lower()]
        if not match:
            return {"error": f"No customer matching '{args['name']}'."}
        c = match[0]
        open_ = [S.invoice_view(i, buyers[i.buyer_id], t) for i in
                 s.exec(select(Invoice).where(Invoice.buyer_id == c["id"], Invoice.paid_date.is_(None))).all()]
        return {**c, "open_invoices": [_brief(v) for v in open_[:10]],
                "other_matches": [m["name"] for m in match[1:5]]}
    if name == "cash_forecast":
        fc = S.forecast(s, org.id, weeks=max(1, min(int(args.get("weeks") or 4), 12)))
        return [{"week_starting": w["week"], "expected": A.short_inr(w["expected"]),
                 "due_dates_suggest": A.short_inr(w["assumed"]),
                 "cumulative_expected": A.short_inr(w["cum_expected"]),
                 "cumulative_likely_range": f"{A.short_inr(w['cum_low'])} - {A.short_inr(w['cum_high'])}"}
                for w in fc["weeks"]]
    if name == "draft_message":
        inv = s.exec(select(Invoice).where(Invoice.org_id == org.id, Invoice.number == args["invoice_number"])).first()
        if not inv:
            return {"error": "Invoice not found"}
        v = S.invoice_view(inv, buyers[inv.buyer_id], t, org, args.get("language", "en"))
        return {"action": v["action_title"], "message": v.get("message"), "whatsapp_available": bool(buyers[inv.buyer_id].phone)}
    return {"error": f"unknown tool {name}"}


def chat(s: Session, org: Org, history: list[dict]) -> dict:
    """history: [{role: user|assistant, content: str}] from the UI. Returns {reply, tools_used}."""
    if not configured():
        return {"reply": "The AI assistant needs an Anthropic API key. Add ANTHROPIC_API_KEY to the server's "
                         "environment (see README) and restart - everything else in PayPredict works without it.",
                "tools_used": [], "configured": False}
    client = anthropic.Anthropic()
    system = SYSTEM + f"\n\nBusiness: {org.name}. Today is {S.today():%d %b %Y}."
    messages = [{"role": m["role"], "content": m["content"]} for m in history[-12:] if m.get("content")]
    used = []
    try:
        for _ in range(8):                                     # tool-use loop, bounded
            resp = client.beta.messages.create(
                model=MODEL, max_tokens=4000, system=system, tools=TOOLS, messages=messages,
                output_config={"effort": "medium"},
                betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            )
            if resp.stop_reason == "refusal":
                return {"reply": "Sorry, I can't help with that request.", "tools_used": used, "configured": True}
            if resp.stop_reason != "tool_use":
                text = "\n".join(b.text for b in resp.content if b.type == "text").strip()
                return {"reply": text or "Done.", "tools_used": used, "configured": True}
            messages.append({"role": "assistant", "content": resp.content})
            results = []
            for block in resp.content:
                if block.type != "tool_use":
                    continue
                used.append(block.name)
                try:
                    out = run_tool(s, org, block.name, dict(block.input))
                    results.append({"type": "tool_result", "tool_use_id": block.id,
                                    "content": json.dumps(out, default=str)})
                except Exception as e:                        # report tool failure back to Claude
                    results.append({"type": "tool_result", "tool_use_id": block.id, "is_error": True,
                                    "content": f"Tool error: {e}"})
            messages.append({"role": "user", "content": results})
        return {"reply": "That took too many steps - please ask a narrower question.", "tools_used": used, "configured": True}
    except anthropic.AuthenticationError:
        return {"reply": "The Anthropic API key was rejected. Please check ANTHROPIC_API_KEY.", "tools_used": used, "configured": False}
    except anthropic.RateLimitError:
        return {"reply": "The AI is busy right now (rate limit). Please try again in a minute.", "tools_used": used, "configured": True}
    except anthropic.APIConnectionError:
        return {"reply": "Couldn't reach the AI service - check the internet connection.", "tools_used": used, "configured": True}
    except anthropic.APIStatusError as e:
        return {"reply": f"AI service error ({e.status_code}). Please try again.", "tools_used": used, "configured": True}
