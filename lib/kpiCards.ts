/** How a KPI reads on a card: the number in the metric's own unit and the change against the last
 *  period, with whether that change is good. Pure, so "a rising return rate is bad news" is a
 *  tested fact and not something each card re-derives. */
export const RATIO_METRICS: ReadonlySet<string> = new Set([
  "gross_margin",
  "repeat_rate",
  "collection_rate",
  "on_time_delivery",
  "fulfillment_rate",
  "sample_conversion",
]);

const faInt = (n: number) => Math.round(n).toLocaleString("fa-IR");

/** «۴۲٪» for a ratio, «۱٬۲۰۰٬۰۰۰» for everything else, «—» for no value. */
export function formatKpi(metric: string, v: number | null): string {
  if (v === null) return "—";
  return RATIO_METRICS.has(metric) ? `${faInt(v * 100)}٪` : faInt(v);
}

export interface Delta {
  /** Direction of the change; `flat` under half a per mille. */
  dir: "up" | "down" | "flat";
  /** Whether that direction is good for THIS metric; null when flat. */
  good: boolean | null;
  /** «۱۲٪», unsigned: the arrow carries the sign. */
  text: string;
}

export function kpiDelta(c: { value: number | null; prev_value: number | null; delta_pct: number; direction: "up" | "down" }): Delta | null {
  if (c.prev_value === null || c.value === null) return null;
  const flat = Math.abs(c.delta_pct) < 0.0005;
  const dir = flat ? "flat" : c.delta_pct > 0 ? "up" : "down";
  return { dir, good: flat ? null : dir === c.direction, text: `${faInt(Math.abs(c.delta_pct) * 100)}٪` };
}
