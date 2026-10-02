import type { TourStep } from "./tour";

const K = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded-md border line bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] font-medium ink">{children}</kbd>
);

/** The in-depth product tour. Steps use data-tour="..." attributes placed on real UI elements. */
export const TOUR_STEPS: TourStep[] = [
  {
    route: "/", title: "Welcome to PayPredict 👋",
    body: <>In 2 minutes you'll see how PayPredict tells you <strong>which customers will pay late</strong>, <strong>what to do about it</strong>, and <strong>how to get paid faster</strong>. You can leave any time and restart from the Help (?) button.</>,
  },
  {
    route: "/", target: "headline", title: "Your AI briefing",
    body: "Every morning the AI agent investigates your ledger and writes this: the real cash outlook, the 3 things to do first and any warnings. Open \"How the AI worked this out\" to see each step it took.",
  },
  {
    route: "/", target: "kpis", title: "Your receivables at a glance",
    body: "What customers owe you, how much is already overdue, how much is likely to come late, and how much will cross the 45-day legal limit. Tap any underlined term for a plain-English meaning.",
  },
  {
    route: "/", target: "checklist", optional: true, title: "Your getting-started checklist",
    body: "Five quick steps to get full value: add your UPI ID, add customers' WhatsApp numbers, send your first reminder and more. Each tick happens automatically when you do it.",
  },
  {
    route: "/", target: "actions", title: "Your to-do list for today",
    body: "Every morning PayPredict picks the few customers worth your time, ranked by how much money is at stake. One card per customer, even if they owe several invoices.",
  },
  {
    route: "/", target: "action-box", optional: true, title: "What to do, and why",
    body: "Each card recommends the cheapest step that works: a friendly reminder, a small early-payment discount, a 45-day legal reminder, selling the invoice on TReDS, or a formal notice. The 'Why?' line shows what the AI noticed.",
  },
  {
    route: "/", target: "send", optional: true, title: "One tap to send",
    body: "Opens WhatsApp with the message already written, including a UPI payment link, and records that you sent it. PayPredict then checks whether it worked.",
  },
  {
    route: "/", target: "more", optional: true, title: "Log what happened",
    body: "Customer promised a date? Payment arrived? Called them? Record it here. Every action can be undone from the confirmation message if you tap by mistake.",
  },
  {
    route: "/", click: "details-btn", target: "drawer-when", optional: true, title: "When will it really be paid?",
    body: "Open any invoice to see its timeline: raised, due, today, and the expected payment date with a likely range. The bars show the chance of payment in each period.",
  },
  {
    route: "/", target: "drawer-reply", optional: true, title: "Munim reads customer replies",
    body: "Paste what the customer wrote back - in any language. Munim spots a promise, a dispute or a payment reference, estimates whether the promise will hold, and drafts your reply.",
  },
  {
    route: "/", target: "drawer-message", optional: true, title: "Ready-to-send message",
    body: "Switch between English, हिंदी and मराठी, edit anything, then send by WhatsApp or email. You always review before anything goes out.",
  },
  {
    route: "/", target: "drawer-status", optional: true, title: "Update the invoice",
    body: "Mark disputes or missing paperwork here. PayPredict then changes its advice, because chasing a disputed invoice rarely works.",
  },
  {
    route: "/invoices", escape: true, target: "inv-filters", title: "All your invoices",
    body: "Filter by overdue or high risk, search by customer or invoice number, sort by urgency, and export to Excel for your CA.",
  },
  {
    route: "/customers", target: "grades", title: "Every customer gets a grade - and a persona",
    body: "A = reliable, D = high risk, based on how they actually paid. Below, machine learning groups customers into payment personas (Reliable, Steady late, Erratic, Festive-slow, Slipping), each with its own strategy.",
  },
  {
    route: "/cash", target: "cash-chart", title: "Cash flow forecast",
    body: "The dashed line is what due dates promise; the blue line is what PayPredict expects, with the shaded likely range from 1,000 simulated futures.",
  },
  {
    route: "/credit-check", target: "credit-form", title: "Check an order before you dispatch",
    body: "Type the customer, order value and credit days. You'll get Approve, Approve with conditions, or Hold, plus the terms to offer and a message to send.",
  },
  {
    route: "/impact", target: "impact-cards", title: "Proof it's working",
    body: "Money collected after your actions, days saved against the AI's own forecast, interest saved, and payments via UPI links. Below it: how accurate the AI is on your data.",
  },
  {
    route: "/settings", target: "settings-pay", title: "Get paid in one tap",
    body: "Add your UPI ID and every reminder gets a payment link with a QR code. Customers pay straight to your bank, with no gateway fees. Add your Udyam number and address for legal notices.",
  },
  {
    route: "/settings", target: "search", title: "Find anything instantly",
    body: <>Press <K>Ctrl</K> + <K>K</K> (or tap the search icon) to jump to any customer, invoice or page, or to run a command.</>,
  },
  {
    route: "/settings", target: "ask", title: "Munim AI, your AI munim",
    body: "Ask in English, Hinglish, हिंदी or मराठी, or by voice: \'Who should I call first?\', \'Kaveri replied: will pay Friday\', \'Any unusual invoices?\'. Munim plans, calls tools on your real data and shows its reasoning step by step.",
  },
  {
    route: "/settings", target: "help", title: "Help is always here",
    body: "Restart this tour, see keyboard shortcuts, or look up any term like TReDS or 43B(h).",
  },
  {
    route: "/", title: "You're all set 🎉",
    body: "Start with the first card on your Today list. A few taps a day is all it takes to get paid faster.",
  },
];
