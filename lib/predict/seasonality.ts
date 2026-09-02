/** Season shape — a pure module, no `db` import.
 *
 *  The demand recursion (lib/predict/smoothing) runs on a deseasonalised series: strip
 *  the season out with `deseasonalise` before smoothing, put it back with
 *  `reseasonalise` after. These are the *shipped* defaults — a tenant that has tuned
 *  its own `seasonal_factors` rows overrides them at the repo layer.
 *
 *  Both arrays are normalised to mean 1 so deseasonalising a full year is revenue-
 *  neutral.
 */

import { toJalali } from "@/lib/jalali";

function meanNormalise(raw: number[]): number[] {
  const sum = raw.reduce((s, x) => s + x, 0);
  const factor = sum > 0 ? raw.length / sum : 1;
  return raw.map((x) => x * factor);
}

/** Jalali month 1–12: a Nowruz lift, an Esfand run-up, a mid-summer dip. */
export const DEFAULT_MONTH_FACTORS: number[] = meanNormalise([
  1.12, 1.05, 1.0, 0.95, 0.9, 0.9, 0.95, 1.0, 1.03, 1.03, 1.07, 1.0,
]);

/** Day of week, Saturday = 0: a wholesale week that all but closes Thursday/Friday. */
export const DEFAULT_DOW_FACTORS: number[] = meanNormalise([1.15, 1.15, 1.1, 1.05, 1.0, 0.75, 0.6]);

/** Saturday-first weekday index (0–6) for an ISO date, read at UTC midnight so a
 *  local-timezone parse cannot shift it across a day boundary. */
function dowIndex(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const jsDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return (jsDow + 1) % 7; // 0 = Saturday
}

/** The combined multiplier for a date: month factor × day-of-week factor. */
export function seasonalIndex(monthFactors: number[], dowFactors: number[], iso: string): number {
  const j = toJalali(iso);
  const monthFactor = j ? (monthFactors[j.jm - 1] ?? 1) : 1;
  const dowFactor = dowFactors[dowIndex(iso)] ?? 1;
  return monthFactor * dowFactor;
}

/** The month-only multiplier — what the monthly demand recursion uses. */
export function monthIndex(monthFactors: number[], iso: string): number {
  const j = toJalali(iso);
  return j ? (monthFactors[j.jm - 1] ?? 1) : 1;
}

export function deseasonalise(y: number, idx: number): number {
  return idx > 0 ? y / idx : y;
}

export function reseasonalise(yhat: number, idx: number): number {
  return yhat * idx;
}
