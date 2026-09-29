/** Indian number formatting: 1234567 -> ₹12,34,567 ; compact -> ₹12.3 L / ₹1.2 Cr */
export function inr(x: number): string {
  return "₹" + Math.round(x).toLocaleString("en-IN");
}
export function inrShort(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e7) return `₹${(x / 1e7).toFixed(a >= 1e8 ? 1 : 2)} Cr`;
  if (a >= 1e5) return `₹${(x / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `₹${(x / 1e3).toFixed(0)}k`;
  return inr(x);
}
export function d(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!iso) return "-";
  return new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-IN", opts);
}
export function pct(x: number | null | undefined, digits = 0) {
  return x == null ? "-" : `${(x * 100).toFixed(digits)}%`;
}
export function relDays(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
