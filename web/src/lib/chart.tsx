/** Shared Recharts styling so every chart's tooltip and legend match the rest of the UI in both themes. */
export const tooltipProps = {
  contentStyle: { borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", fontSize: 12 },
  labelStyle: { color: "var(--ink)", fontWeight: 600 },
  itemStyle: { color: "var(--ink-2)" },
  cursor: { fill: "var(--surface-2)", opacity: 0.6 },
};
export const legendProps = {
  iconSize: 10,
  wrapperStyle: { fontSize: 12, paddingTop: 8 },
  formatter: (value: string) => <span style={{ color: "var(--ink-2)" }}>{value}</span>,
};
export const axisTick = { fontSize: 11, fill: "var(--ink-3)" };
