import { clamp } from "@/lib/math";
/** Health composites — a pure module, no `db` import.
 *
 *  Source §6 Tier 3: Customer Health Score, Salesperson Score, Driver Score. Each is a
 *  weighted mean of a handful of 0–100 factors, returning the score, a band, and the
 *  reasons that dragged it down — the drill-down and the Action Center both read
 *  `reasons`, so a low score is never a bare number.
 *
 *  Bands match Phase 8 `repHealth`: good ≥ 70, watch ≥ 40, else risk.
 *
 *  The weights here are hand-set constants, like `capacity_factors` — a Phase 10
 *  learning candidate. They are kept explicit and in one place for that reason.
 */

export type Band = "good" | "watch" | "risk";

export function band(score: number): Band {
  if (score >= 70) return "good";
  if (score >= 40) return "watch";
  return "risk";
}

const clampScore = (n: number): number => clamp(n, 0, 100);

/** Linear map: `x` at or below `x0` → 0, at or above `x1` → 100, between → proportional.
 *  `x1 < x0` inverts it (more `x` is worse). */
function ramp(x: number, x0: number, x1: number): number {
  if (x1 === x0) return x >= x1 ? 100 : 0;
  return clampScore(((x - x0) / (x1 - x0)) * 100);
}

/** Order-trend factor: below 0.5× → 0, 1.0× → 50, at/above 1.1× → 100, linear between. */
function trendScore(r: number): number {
  if (r <= 0.5) return 0;
  if (r <= 1) return ((r - 0.5) / 0.5) * 50;
  if (r < 1.1) return 50 + ((r - 1) / 0.1) * 50;
  return 100;
}

interface Factor {
  score: number;
  weight: number;
  reason: string;
}

/** Weighted mean of the live factors (a factor with weight 0 is skipped and the rest
 *  re-normalise), plus the sub-midpoint reasons ordered by how much weight×deficit each
 *  costs. */
function combine(factors: Factor[]): { score: number; band: Band; reasons: string[] } {
  const live = factors.filter((f) => f.weight > 0);
  const totalWeight = live.reduce((s, f) => s + f.weight, 0) || 1;
  const score = Math.round(live.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight);
  const reasons = live
    .filter((f) => f.score < 50)
    .sort((a, b) => (50 - b.score) * b.weight - (50 - a.score) * a.weight)
    .map((f) => f.reason);
  return { score, band: band(score), reasons };
}

// ---- Customer -----------------------------------------------------------------

export interface CustomerHealthInput {
  /** null = never ordered */
  days_since_last_order: number | null;
  /** the customer's own historical cadence; null when there is only one order */
  mean_interval_days: number | null;
  orders_this_q: number;
  orders_prev_q: number;
  overdue_toman: number;
  /** 0 or absent = no limit set */
  credit_limit_toman: number;
  complaints_90d: number;
  /** 0–1 gross margin on this customer's delivered lines */
  margin_pct: number;
}

/** Toman of overdue that pins the payment factor to 0 when there is no credit limit. */
const OVERDUE_FLOOR_TOMAN = 5_000_000;

export function customerHealth(i: CustomerHealthInput): { score: number; band: Band; reasons: string[] } {
  // cadence: how many "normal intervals" since the last order
  let cadence: number;
  if (i.days_since_last_order === null) {
    cadence = 0;
  } else {
    const interval = i.mean_interval_days && i.mean_interval_days > 0 ? i.mean_interval_days : 30;
    const ratio = i.days_since_last_order / interval;
    cadence = ramp(ratio, 3, 1); // 1× → 100, 3× → 0
  }
  const cadenceReason =
    i.days_since_last_order === null ? "هرگز سفارشی ثبت نکرده" : "سفارش‌ها از ریتم همیشگی عقب افتاده";

  // trend: this quarter vs last — 0.5× → 0, 1.0× → 50, ≥1.1× → 100
  let trend: number;
  if (i.orders_prev_q <= 0) {
    trend = i.orders_this_q > 0 ? 100 : 50;
  } else {
    trend = trendScore(i.orders_this_q / i.orders_prev_q);
  }

  // payment: overdue against the limit (or a floor)
  const limit = i.credit_limit_toman > 0 ? i.credit_limit_toman : OVERDUE_FLOOR_TOMAN;
  const payment = i.overdue_toman <= 0 ? 100 : ramp(i.overdue_toman, limit, 0);

  // complaints: −25 each
  const complaints = clampScore(100 - i.complaints_90d * 25);

  // margin: 0% → 0, ≥25% → 100
  const margin = ramp(i.margin_pct, 0, 0.25);

  return combine([
    { score: cadence, weight: 0.35, reason: cadenceReason },
    { score: trend, weight: 0.25, reason: "روند سفارش‌ها نزولی است" },
    { score: payment, weight: 0.2, reason: "بدهی معوق نزدیک سقف اعتبار" },
    { score: complaints, weight: 0.1, reason: "شکایت کیفی باز دارد" },
    { score: margin, weight: 0.1, reason: "حاشیهٔ سود این مشتری پایین است" },
  ]);
}

// ---- Salesperson ------------------------------------------------------------------

export interface SalespersonScoreInput {
  /** actual / target this month, from the targets repo */
  target_fraction: number;
  active_customers: number;
  assigned_customers: number;
  /** 0–1 */
  sample_conversion: number;
  /** their book's overdue / their book's delivered revenue, 0–1+ */
  overdue_ratio: number;
  /** tasks closed before their due date / tasks that had a due date, 0–1 */
  on_time_task_ratio: number;
}

export function salespersonScore(i: SalespersonScoreInput): { score: number; band: Band; reasons: string[] } {
  const target = ramp(i.target_fraction, 0.3, 1);
  const coverage =
    i.assigned_customers > 0 ? ramp(i.active_customers / i.assigned_customers, 0, 0.8) : 50;
  const sample = ramp(i.sample_conversion, 0, 0.35);
  const overdue = ramp(i.overdue_ratio, 0.4, 0); // inverted: 0 → 100, ≥0.4 → 0
  const tasks = clampScore(i.on_time_task_ratio * 100);

  return combine([
    { score: target, weight: 0.35, reason: "از هدف فروش ماه عقب است" },
    { score: coverage, weight: 0.2, reason: "بخش بزرگی از مشتری‌های واگذارشده غیرفعال‌اند" },
    { score: sample, weight: 0.15, reason: "نرخ تبدیل نمونه پایین است" },
    { score: overdue, weight: 0.15, reason: "نسبت مطالبات معوق دفترش بالاست" },
    { score: tasks, weight: 0.15, reason: "کارها را دیر می‌بندد" },
  ]);
}

// ---- Driver --------------------------------------------------------------------

export interface DriverScoreInput {
  /** 0–1 */
  on_time_delivery: number;
  /** delivered packs / ordered packs, 0–1 */
  fill_rate: number;
  /** failed stops / stops, 0–1 */
  failed_ratio: number;
  /** null when there is no timing data — the factor is dropped and the rest re-normalise */
  stops_per_hour: number | null;
}

export function driverScore(i: DriverScoreInput): { score: number; band: Band; reasons: string[] } {
  const onTime = clampScore(i.on_time_delivery * 100);
  const fill = clampScore(i.fill_rate * 100);
  const failed = ramp(i.failed_ratio, 0.15, 0); // inverted
  const pace = i.stops_per_hour === null ? 0 : ramp(i.stops_per_hour, 1, 4);

  return combine([
    { score: onTime, weight: 0.4, reason: "تحویل به‌موقع پایین است" },
    { score: fill, weight: 0.3, reason: "نرخ پرشدن سفارش پایین است" },
    { score: failed, weight: 0.2, reason: "نسبت تحویل ناموفق بالاست" },
    { score: pace, weight: i.stops_per_hour === null ? 0 : 0.1, reason: "سرعت توقف‌ها کند است" },
  ]);
}
