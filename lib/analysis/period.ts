/** A Jalali «YYYY-MM» period string ↔ the Gregorian ISO half-open date range it covers.
 *
 *  Pure. Every analysis query filters `order_date >= from AND order_date < toExcl`
 *  rather than pulling a Jalali month out in JS row-by-row — a Persian month straddles
 *  two Gregorian ones, so this conversion has to happen once, at the boundary.
 *
 *  Same shape as the private `periodRange` in lib/repo/targets.ts; lifted here so the
 *  margin / snapshot / why repos share one definition of "this month".
 */

import { jalaliToIsoDate, jalaliMonthLength, toJalali } from "../jalali";

export interface PeriodRange {
  /** inclusive, `YYYY-MM-DD` */
  from: string;
  /** exclusive, `YYYY-MM-DD` — the first day of the next Jalali month */
  toExcl: string;
}

/** `'1405-06'` → `{ from: '2026-08-23', toExcl: '2026-09-23' }` (illustrative). */
export function periodRange(period: string): PeriodRange {
  const [jy, jm] = period.split("-").map(Number);
  if (!jy || !jm || jm < 1 || jm > 12) {
    throw new Error(`bad Jalali period '${period}' — expected 'YYYY-MM'`);
  }
  const from = jalaliToIsoDate(jy, jm, 1).slice(0, 10);
  const lastDay = jalaliMonthLength(jy, jm);
  const endInclusive = jalaliToIsoDate(jy, jm, lastDay).slice(0, 10);
  const d = new Date(`${endInclusive}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return { from, toExcl: d.toISOString().slice(0, 10) };
}

/** The Jalali «YYYY-MM» an ISO date falls in. */
export function periodOf(iso: string): string {
  const j = toJalali(iso);
  if (!j) return iso.slice(0, 7);
  return `${j.jy}-${String(j.jm).padStart(2, "0")}`;
}

/** The Jalali «YYYY-MM» `n` months before `period` (n may be negative for the future). */
export function shiftPeriod(period: string, n: number): string {
  const [jy, jm] = period.split("-").map(Number);
  const zero = jy * 12 + (jm - 1) - n;
  const y = Math.floor(zero / 12);
  const m = (zero % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** This Jalali month, from a clock value (defaults to now). */
export function currentPeriod(nowIso: string = new Date().toISOString()): string {
  return periodOf(nowIso);
}
