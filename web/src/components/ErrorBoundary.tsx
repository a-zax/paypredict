import { RefreshCw, TriangleAlert } from "lucide-react";
import { Component, type ReactNode } from "react";

/** Friendly fallback instead of a blank screen if a page crashes (e.g. a network hiccup while loading a chunk). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("PayPredict page error:", error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-500/10"><TriangleAlert className="size-6" /></div>
        <h2 className="mt-4 text-lg font-semibold ink">Something went wrong on this page</h2>
        <p className="mt-1 text-sm ink-2">Your data is safe. This is usually a brief connection problem - try again.</p>
        <button onClick={() => window.location.reload()}
          className="focus-ring mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
          <RefreshCw className="size-4" />Reload
        </button>
      </div>
    );
  }
}
