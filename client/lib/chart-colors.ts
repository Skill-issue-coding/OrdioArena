/**
 * 12 predefined chart colours, one per hue sector around the colour wheel.
 * Each string references a CSS custom property defined in globals.css so the
 * colours adapt to light/dark mode automatically.
 *
 * Use CHART_COLORS[playerIndex % CHART_COLORS.length] to assign a stable,
 * distinct colour to each player regardless of their avatar background colour.
 */
export const CHART_COLORS: readonly string[] = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
  "var(--chart-10)",
  "var(--chart-11)",
  "var(--chart-12)",
] as const;

/** Returns the chart colour for a given 0-based player index. */
export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}
