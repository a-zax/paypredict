import { createContext, useContext, useState, type ReactNode } from "react";
import type { Lang } from "./api";

const S = {
  today: { en: "Today", hi: "आज", mr: "आज" },
  invoices: { en: "Invoices", hi: "इनवॉइस", mr: "इनव्हॉइस" },
  customers: { en: "Customers", hi: "ग्राहक", mr: "ग्राहक" },
  cash: { en: "Cash flow", hi: "कैश फ़्लो", mr: "कॅश फ्लो" },
  insights: { en: "AI & impact", hi: "AI और प्रभाव", mr: "AI आणि परिणाम" },
  new_order: { en: "New order check", hi: "नया ऑर्डर जाँचें", mr: "नवीन ऑर्डर तपासा" },
  settings: { en: "Settings", hi: "सेटिंग्स", mr: "सेटिंग्ज" },
  ask: { en: "AI Copilot", hi: "AI कोपायलट", mr: "AI कोपायलट" },
  owed: { en: "Owed to you", hi: "आपका बकाया", mr: "तुमची येणी" },
  overdue: { en: "Overdue", hi: "देय तिथि पार", mr: "मुदत उलटलेली" },
  likely_late: { en: "Likely to come late", hi: "देर से आने की संभावना", mr: "उशिरा येण्याची शक्यता" },
  your_actions: { en: "Your actions for today", hi: "आज के आपके काम", mr: "आजची तुमची कामे" },
  done_today: { en: "done today", hi: "आज पूरे", mr: "आज पूर्ण" },
  send_whatsapp: { en: "Send on WhatsApp", hi: "WhatsApp पर भेजें", mr: "WhatsApp वर पाठवा" },
  why: { en: "Why?", hi: "क्यों?", mr: "का?" },
  expected: { en: "Expected payment", hi: "अपेक्षित भुगतान", mr: "अपेक्षित पेमेंट" },
  all_clear: { en: "All caught up!", hi: "सब काम पूरे!", mr: "सगळी कामे पूर्ण!" },
} as const;
export type Key = keyof typeof S;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: Key) => string }>({
  lang: "en", setLang: () => {}, t: (k) => S[k].en,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try { return (localStorage.getItem("pp_ui_lang") as Lang) || "en"; } catch { return "en"; }
  });
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem("pp_ui_lang", l); } catch { /* ignore */ }
  };
  return <Ctx.Provider value={{ lang, setLang, t: (k) => S[k][lang] }}>{children}</Ctx.Provider>;
}
export const useT = () => useContext(Ctx);
export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" }, { code: "hi", label: "हिंदी" }, { code: "mr", label: "मराठी" },
];
