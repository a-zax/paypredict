import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Invoice } from "./api";

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function useInvoiceActions() {
  const qc = useQueryClient();
  const refresh = (id?: number) => {
    for (const k of ["today", "invoices", "buyers", "forecast", "model", "impact", "setup"]) qc.invalidateQueries({ queryKey: [k] });
    if (id) qc.invalidateQueries({ queryKey: ["invoice", id] });
  };
  const log = async (id: number, kind: string, extra: { channel?: string; note?: string; when?: string } = {}) => {
    await api(`/invoices/${id}/log`, { method: "POST", json: { kind, ...extra } });
    refresh(id);
  };
  const undo = async (id: number) => {
    try {
      await api(`/invoices/${id}/undo`, { method: "POST" });
      refresh(id);
      toast("Undone");
    } catch (e: any) { toast.error(e.message); }
  };
  /** Every confirmation carries an Undo button - people act faster when mistakes are reversible. */
  const done = (id: number, title: string, description?: string, kind: "success" | "info" = "success") =>
    (kind === "success" ? toast.success : toast)(title, { description, action: { label: "Undo", onClick: () => undo(id) }, duration: 7000 });
  const safely = async (f: () => Promise<void>) => {
    try { await f(); } catch (e: any) { toast.error(e.message || "Couldn't save - check your connection and try again."); }
  };

  return {
    refresh,
    log,
    undo,
    sendWhatsApp: (inv: Invoice, text?: string) => safely(async () => {
      const url = text ? inv.whatsapp_url!.replace(/text=[^&]*/, "text=" + encodeURIComponent(text)) : inv.whatsapp_url!;
      window.open(url, "_blank", "noopener");
      await log(inv.id, inv.action!, { channel: "whatsapp" });
      done(inv.id, "Opened WhatsApp and logged it", "We'll check in 10 days whether it worked.");
    }),
    sendEmail: (inv: Invoice, text?: string) => safely(async () => {
      const url = text ? inv.email_url!.replace(/body=[^&]*/, "body=" + encodeURIComponent(text)) : inv.email_url!;
      window.location.href = url;
      await log(inv.id, inv.action!, { channel: "email" });
      done(inv.id, "Email drafted and logged");
    }),
    copy: (inv: Invoice, text: string) => safely(async () => {
      await navigator.clipboard.writeText(text);
      await log(inv.id, inv.action!, { channel: "copied" });
      done(inv.id, "Message copied - paste it anywhere");
    }),
    done: (inv: Invoice, channel = "manual") => safely(async () => {
      await log(inv.id, inv.action!, { channel });
      done(inv.id, channel === "call" ? "Call logged" : "Marked as done");
    }),
    promise: (id: number, when: string) => safely(async () => {
      await log(id, "PROMISE", { when });
      done(id, "Promise saved", "We'll remind you if it slips.");
    }),
    paid: (id: number, when: string) => safely(async () => {
      await log(id, "PAID", { when });
      done(id, "Payment recorded 🎉", "The AI will learn from this.");
    }),
    rejectClaim: (id: number) => safely(async () => {
      await log(id, "CLAIM_REJECTED");
      done(id, "Okay - follow-ups resumed", "The customer's 'I've paid' was not found in your bank.", "info");
    }),
    snooze: (id: number, days = 3) => safely(async () => {
      const d = new Date(); d.setDate(d.getDate() + days);
      await log(id, "SNOOZE", { when: localIso(d) });
      done(id, `Snoozed for ${days} days`, undefined, "info");
    }),
    toggle: (id: number, kind: string, label: string) => safely(async () => {
      await log(id, kind);
      done(id, label, undefined, "info");
    }),
  };
}
