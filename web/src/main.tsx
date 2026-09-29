import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import "./index.css";
import { getToken } from "./lib/api";
import { useMe } from "./lib/auth";
import { I18nProvider } from "./lib/i18n";
import { ThemeProvider, useTheme } from "./lib/theme";
import { MotionConfig } from "motion/react";

// Route-level code splitting: a buyer opening a pay link downloads only the pay page, not charts & dashboards.
const page = <T extends string>(load: () => Promise<Record<T, React.ComponentType<any>>>, name: T) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const Shell = lazy(() => import("./components/Layout"));
const Today = page(() => import("./pages/Today"), "Today");
const Invoices = page(() => import("./pages/Invoices"), "Invoices");
const Customers = page(() => import("./pages/Customers"), "Customers");
const Cash = page(() => import("./pages/Cash"), "Cash");
const Accuracy = page(() => import("./pages/Accuracy"), "Accuracy");
const CreditCheck = page(() => import("./pages/CreditCheck"), "CreditCheck");
const Settings = page(() => import("./pages/Settings"), "Settings");
const Onboarding = page(() => import("./pages/Onboarding"), "Onboarding");
const AuthPage = page(() => import("./pages/Auth"), "AuthPage");
const Notice = page(() => import("./pages/Notice"), "Notice");
const Pay = page(() => import("./pages/Pay"), "Pay");

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });
const Spinner = () => <div className="grid h-full min-h-[50vh] place-items-center"><span className="size-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;

function Guard({ children, needsOnboarded = true }: { children: ReactNode; needsOnboarded?: boolean }) {
  const loc = useLocation();
  const { data, isLoading } = useMe();
  if (!getToken()) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (isLoading || !data) return <Spinner />;
  if (needsOnboarded && !data.org.onboarded) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

function App() {
  const { dark } = useTheme();
  return (
    <>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={getToken() ? <Navigate to="/" /> : <AuthPage mode="login" />} />
          <Route path="/signup" element={getToken() ? <Navigate to="/" /> : <AuthPage mode="signup" />} />
          <Route path="/welcome" element={<Guard needsOnboarded={false}><Onboarding /></Guard>} />
          <Route path="/pay/:token" element={<Pay />} />
          <Route path="/notice/:buyerId" element={<Guard><Notice /></Guard>} />
          <Route element={<Guard><Shell /></Guard>}>
            <Route index element={<Today />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="customers" element={<Customers />} />
            <Route path="cash" element={<Cash />} />
            <Route path="impact" element={<Accuracy />} />
            <Route path="accuracy" element={<Navigate to="/impact" replace />} />
            <Route path="credit-check" element={<CreditCheck />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Suspense>
      <Toaster position="top-center" richColors closeButton theme={dark ? "dark" : "light"} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <I18nProvider>
          <MotionConfig reducedMotion="user">
            <BrowserRouter><App /></BrowserRouter>
          </MotionConfig>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
