import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** One theme state for the whole app (layout, toasts, print pages stay in sync). */
const Ctx = createContext<{ dark: boolean; toggle: () => void }>({ dark: false, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("pp_theme");
      return saved ? saved === "dark" : window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("pp_theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);
  return <Ctx.Provider value={{ dark, toggle: () => setDark((d) => !d) }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);

/** Sets the browser tab title for the current page. */
export function usePageTitle(title: string) {
  useEffect(() => { document.title = title ? `${title} · PayPredict` : "PayPredict"; }, [title]);
}
