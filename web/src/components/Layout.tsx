import { AnimatePresence, motion } from "motion/react";
import { BarChart3, FileText, LogOut, Menu, Moon, Search, Settings, ShieldCheck, Sparkles, Sun, Target, Users, X, Zap } from "lucide-react";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuthActions, useMe } from "../lib/auth";
import { cx } from "../lib/format";
import { LANGS, useT, type Key } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { TourProvider, useTour } from "../lib/tour";
import { TOUR_STEPS } from "../lib/tourSteps";
import { Assistant } from "./Assistant";
import { CommandPalette } from "./CommandPalette";
import { DrawerProvider } from "./Drawers";
import { ErrorBoundary } from "./ErrorBoundary";
import { GlossaryModal, HelpMenu, Kbd, ShortcutsModal } from "./Help";
import { Avatar } from "./ui";

// The sidebar switch translates menu labels only; customer messages follow Settings / each customer's language.
const MENU_LANG_HINT = "Menu language. Customer messages use the language set in Settings or on each customer.";

const NAV: { to: string; key: Key; icon: ReactNode; tour?: string }[] = [
  { to: "/", key: "today", icon: <Zap className="size-[18px]" /> },
  { to: "/invoices", key: "invoices", icon: <FileText className="size-[18px]" /> },
  { to: "/customers", key: "customers", icon: <Users className="size-[18px]" /> },
  { to: "/cash", key: "cash", icon: <BarChart3 className="size-[18px]" /> },
  { to: "/credit-check", key: "new_order", icon: <ShieldCheck className="size-[18px]" /> },
  { to: "/impact", key: "insights", icon: <Target className="size-[18px]" /> },
];

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx("flex items-center gap-2.5", className)}>
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="text-[17px] font-semibold tracking-tight ink">PayPredict</span>
    </div>
  );
}

const navCls = ({ isActive }: { isActive: boolean }) => cx("focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
  isActive ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200" : "ink-2 hover:bg-[var(--surface-2)] hover:text-[var(--ink)]");

function Layout({ tourKey }: { tourKey: string }) {
  const { data: me } = useMe();
  const { t, lang, setLang } = useT();
  const { dark, toggle } = useTheme();
  const { logout } = useAuthActions();
  const { start, active: touring } = useTour();
  const nav = useNavigate();
  const [askOpen, setAskOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [glossary, setGlossary] = useState(false);
  const gPressed = useRef(0);

  // First visit after onboarding: start the tour automatically, once.
  useEffect(() => {
    let seen = false;
    try { seen = !!localStorage.getItem(tourKey); } catch { /* ignore */ }
    if (!seen) { const id = setTimeout(() => start(0), 900); return () => clearTimeout(id); }
  }, [tourKey, start]);

  // Global keyboard shortcuts (ignored while typing or touring).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      const el = e.target as HTMLElement;
      if (touring || e.ctrlKey || e.metaKey || e.altKey || el.closest("input, textarea, select, [contenteditable=true]")) return;
      const k = e.key.toLowerCase();
      if (k === "/") { e.preventDefault(); setPalette(true); }
      else if (e.key === "?") setShortcuts(true);
      else if (k === "a") setAskOpen(true);
      else if (k === "g") gPressed.current = Date.now();
      else if (Date.now() - gPressed.current < 1200) {
        const to = { t: "/", i: "/invoices", c: "/customers", f: "/cash", o: "/credit-check" }[k];
        if (to) { nav(to); gPressed.current = 0; }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [touring, nav]);

  return (
    <div className="min-h-full lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-white">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col overflow-y-auto border-r line bg-[var(--surface)] px-4 py-5 lg:flex">
        <Logo className="px-2" />
        <div className="mt-1 truncate px-2 text-xs ink-3">{me?.org.name}</div>
        <button data-tour="search" onClick={() => setPalette(true)}
          className="focus-ring mt-5 flex items-center gap-2 rounded-xl border line bg-[var(--bg)] px-3 py-2 text-sm ink-3 hover:border-brand-300">
          <Search className="size-4" /><span className="flex-1 text-left">Search…</span><Kbd>Ctrl</Kbd><Kbd>K</Kbd>
        </button>
        <nav className="mt-4 space-y-1" aria-label="Main">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.to === "/"} className={navCls}>{n.icon}{t(n.key)}</NavLink>)}
        </nav>
        <button data-tour="ask" onClick={() => setAskOpen(true)}
          className="focus-ring mt-5 flex items-center gap-3 rounded-xl bg-gradient-to-br from-brand-600 to-violet-600 px-3 py-3 text-left text-sm font-medium text-white shadow-lg shadow-brand-600/25 transition-transform hover:scale-[1.01]">
          <Sparkles className="size-[18px]" />
          <span className="flex-1">{t("ask")}<span className="block text-xs font-normal text-white/75">Your AI credit manager</span></span>
          <kbd className="rounded bg-white/20 px-1.5 text-[11px]">A</kbd>
        </button>
        <div className="mt-auto space-y-1 pt-6">
          <HelpMenu onShortcuts={() => setShortcuts(true)} onGlossary={() => setGlossary(true)} />
          <NavLink to="/settings" className={navCls}><Settings className="size-[18px]" />{t("settings")}</NavLink>
          <div className="flex items-center gap-1 px-2 pt-2" data-tour="prefs">
            <span className="pr-1 text-[11px] ink-3" title={MENU_LANG_HINT}>Menu</span>
            {LANGS.map((l) => (
              <button key={l.code} onClick={() => setLang(l.code)} aria-pressed={lang === l.code} title={MENU_LANG_HINT}
                className={cx("focus-ring rounded-lg px-2 py-1 text-xs font-medium", lang === l.code ? "bg-[var(--surface-2)] ink" : "ink-3 hover:ink-2")}>{l.label}</button>
            ))}
            <button onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} className="focus-ring ml-auto grid size-8 place-items-center rounded-lg ink-2 hover:bg-[var(--surface-2)]">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-xl border line p-2.5">
            <Avatar name={me?.user.name || "U"} size={34} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium ink">{me?.user.name}</div>
              <div className="truncate text-xs ink-3">{me?.user.email}</div>
            </div>
            <button onClick={logout} aria-label="Log out" title="Log out" className="focus-ring grid size-8 place-items-center rounded-lg ink-3 hover:text-rose-600"><LogOut className="size-4" /></button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b line bg-[var(--surface)]/85 px-4 py-2.5 backdrop-blur lg:hidden">
        <Logo />
        <div className="flex items-center gap-0.5">
          <button data-tour="search" onClick={() => setPalette(true)} aria-label="Search" className="focus-ring grid size-9 place-items-center rounded-lg ink-2"><Search className="size-4" /></button>
          <HelpMenu compact onShortcuts={() => setShortcuts(true)} onGlossary={() => setGlossary(true)} />
          <button onClick={toggle} aria-label="Toggle dark mode" className="focus-ring grid size-9 place-items-center rounded-lg ink-2">{dark ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
        <ErrorBoundary>
          <Suspense fallback={<div className="grid min-h-[40vh] place-items-center"><span className="size-7 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>}>
            <Outlet context={{ openAssistant: () => setAskOpen(true) }} />
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* Mobile bottom nav */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t line bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {NAV.slice(0, 3).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}
            className={({ isActive }) => cx("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium", isActive ? "text-brand-600 dark:text-brand-200" : "ink-3")}>
            {n.icon}{t(n.key)}
          </NavLink>
        ))}
        <button data-tour="ask" onClick={() => setAskOpen(true)} className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-violet-600 dark:text-violet-300">
          <Sparkles className="size-[18px]" />Ask AI
        </button>
        <button onClick={() => setMore(true)} aria-label="More" className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ink-3">
          <Menu className="size-[18px]" />More
        </button>
      </nav>

      {/* Mobile "More" sheet */}
      <AnimatePresence>
        {more && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div className="absolute inset-0 bg-slate-950/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMore(false)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 32, stiffness: 320 }}
              className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-[var(--surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-pop)]">
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full surface-2" />
              <div className="flex items-center justify-between px-1"><span className="font-semibold ink">More</span>
                <button onClick={() => setMore(false)} aria-label="Close" className="grid size-8 place-items-center rounded-full ink-2"><X className="size-4" /></button></div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[...NAV.slice(3), { to: "/settings", key: "settings" as Key, icon: <Settings className="size-[18px]" /> }].map((n) => (
                  <NavLink key={n.to} to={n.to} onClick={() => setMore(false)} className="focus-ring flex items-center gap-3 rounded-2xl border line p-3.5 text-sm font-medium ink">{n.icon}{t(n.key)}</NavLink>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-1 px-1">
                <span className="pr-1 text-xs ink-3">Menu</span>
                {LANGS.map((l) => <button key={l.code} onClick={() => setLang(l.code)} title={MENU_LANG_HINT} className={cx("rounded-lg px-3 py-1.5 text-sm", lang === l.code ? "bg-[var(--surface-2)] font-medium ink" : "ink-3")}>{l.label}</button>)}
                <button onClick={logout} className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-rose-600"><LogOut className="size-4" />Log out</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <CommandPalette open={palette} onClose={() => setPalette(false)} onAsk={() => setAskOpen(true)} />
      <ShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} />
      <GlossaryModal open={glossary} onClose={() => setGlossary(false)} />
      <Assistant open={askOpen} onClose={() => setAskOpen(false)} enabled={!!me?.assistant_enabled} />
    </div>
  );
}

/** App shell (lazy-loaded): drawers, guided tour and navigation around every signed-in page. */
export default function Shell() {
  const { data: me } = useMe();
  const tourKey = `pp_tour_${me?.user.id ?? "anon"}`;
  return (
    <DrawerProvider>
      <TourProvider steps={TOUR_STEPS} storageKey={tourKey}>
        <Layout tourKey={tourKey} />
      </TourProvider>
    </DrawerProvider>
  );
}
