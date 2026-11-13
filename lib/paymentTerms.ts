/** D5: payment term kinds and the due date they give. Pure.
 *  Example: delivered 12 Aban 1405, «end of month + 10 days» → due 10 Azar (the month has 30 days, ends on the 30th, +10). */
import { jalaliMonthLength, jalaliToIsoDate, toJalali } from "./jalali";

export const TERM_KINDS = [
  { id: "cod", label: "نقد هنگام تحویل" },
  { id: "days", label: "چند روز بعد از تحویل" },
  { id: "eom", label: "آخر ماه به‌اضافهٔ چند روز" },
] as const;

export type TermKind = (typeof TERM_KINDS)[number]["id"];

export const isTermKind = (v: unknown): v is TermKind => TERM_KINDS.some((k) => k.id === v);

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The day payment is due, as 'YYYY-MM-DD', from the day of delivery. */
export function dueDateFor(kind: TermKind, days: number, deliveredDay: string): string {
  const n = Math.max(0, Math.trunc(days));
  if (kind === "cod") return deliveredDay;
  if (kind === "days") return addDays(deliveredDay, n);
  const j = toJalali(deliveredDay);
  if (!j) return addDays(deliveredDay, n);
  return addDays(jalaliToIsoDate(j.jy, j.jm, jalaliMonthLength(j.jy, j.jm)), n);
}

export function termLabel(kind: TermKind, days: number): string {
  return kind === "cod" ? "نقد هنگام تحویل" : kind === "days" ? `${days.toLocaleString("fa-IR")} روز بعد از تحویل` : `آخر ماه + ${days.toLocaleString("fa-IR")} روز`;
}
