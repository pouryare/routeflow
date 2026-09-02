/** The KPI vocabulary — a pure module, no `db` import.
 *
 *  `METRICS` is the closed set of metric keys that appear in `kpi_snapshots.metric`
 *  and `kpi_definitions.metric`. Source §6 calls these Tier 1 — essential — and every
 *  one has a seeded definition (`seedKpiDefinitions` in lib/db.ts) carrying the seven
 *  attributes a figure needs to be a management KPI rather than a report.
 *
 *  The Data Dictionary constants below are the "fix a contested definition once" rule
 *  from the same section: "Active Customer = at least one confirmed order in the last
 *  60 days" is a number here, not an argument in a meeting.
 */

import { faNum } from "../format";

export const METRICS = [
  "net_sales",
  "gross_profit",
  "gross_margin",
  "orders",
  "aov",
  "active_customers",
  "new_customers",
  "lost_customers",
  "repeat_rate",
  "collection_rate",
  "overdue_receivables",
  "on_time_delivery",
  "fulfillment_rate",
  "sample_conversion",
] as const;

export type Metric = (typeof METRICS)[number];

/** Metrics whose `value` is a 0–1 ratio. These keep `numerator` / `denominator` on the
 *  snapshot so a drill-down re-aggregates the parts instead of averaging averages. */
export const RATIO_METRICS: readonly Metric[] = [
  "gross_margin",
  "repeat_rate",
  "collection_rate",
  "on_time_delivery",
  "fulfillment_rate",
  "sample_conversion",
];

/** Is "more" good (`up`) or bad (`down`)? Drives the on-track colour and the "چرا؟"
 *  headline wording. Only two metrics want less of themselves. */
export const METRIC_DIRECTION: Record<Metric, "up" | "down"> = {
  net_sales: "up",
  gross_profit: "up",
  gross_margin: "up",
  orders: "up",
  aov: "up",
  active_customers: "up",
  new_customers: "up",
  lost_customers: "down",
  repeat_rate: "up",
  collection_rate: "up",
  overdue_receivables: "down",
  on_time_delivery: "up",
  fulfillment_rate: "up",
  sample_conversion: "up",
};

const METRIC_SET: ReadonlySet<string> = new Set(METRICS);

export function isMetric(s: string): s is Metric {
  return METRIC_SET.has(s);
}

export function isRatio(m: Metric): boolean {
  return RATIO_METRICS.includes(m);
}

/** A label for a metric value. Money metrics show a grouped integer (the « تومان »
 *  suffix is added by the caller near the number so a bare axis label stays short);
 *  ratios show a whole percent; counts show a grouped integer. Formatting only —
 *  never use this to compare or store. */
export function formatMetric(m: Metric, value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (isRatio(m)) return `${faNum(Math.round(value * 100))}٪`;
  return faNum(Math.round(value));
}

// ---- Data Dictionary (source §6) -------------------------------------------------

/** "Active Customer = at least one confirmed order in the last 60 days." */
export const ACTIVE_WINDOW_DAYS = 60;
/** A repeat buyer has at least this many orders inside the period. */
export const REPEAT_MIN_ORDERS = 2;
/** A sample counts as converted if a non-sample order from the same customer follows
 *  within this many days. */
export const SAMPLE_CONVERT_DAYS = 30;
/** On-time = delivered on the planned date or earlier; no positive grace. */
export const ON_TIME_GRACE_DAYS = 0;
