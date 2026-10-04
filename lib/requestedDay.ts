import { faJalaliDate } from "./jalali";

/** The day a customer asked for — Phase 1 of the mixed-route plan.
 *
 *  «در اولین فرصت» is the ABSENCE of a day, not a flag. An earlier shape of this called it
 *  "ASAP", which reads as a boolean and invites an `is_asap` column that then has to be kept
 *  in step with `requested_day` forever. There is no such column here: `requested_day IS NULL`
 *  IS the label, and the day-splitter's raw material is exactly the set where `isUncommitted`
 *  is true.
 *
 *  Pure, with no I/O and no clock of its own: `resolveRequestedDay` takes the today it should
 *  measure from. That is what makes the week arithmetic assertable — a function that read
 *  `new Date()` could only ever be tested by freezing time, and a test that needs a fake clock
 *  is a test that rots the first time someone changes the setup. */

/** Which control the reader used. Recorded even after resolution to a date, so a week offset
 *  can still read «هفتهٔ بعد» rather than a date the driver never chose. */
export type RequestedKind = "soonest" | "week_offset" | "exact_date";

/** The three legal values, for a route validating a body rather than trusting it.
 *  Derived from the union on purpose: a hand-written literal at a call site is a second list,
 *  and this is exactly the drift `MANAGE_ROLES` / `OWNER_ROLES` exist to prevent elsewhere in
 *  this repo. */
export const REQUESTED_KINDS: readonly RequestedKind[] = [
  "soonest",
  "week_offset",
  "exact_date",
];

/** Whether a string is one of the three. A route's first question about an untrusted body. */
export function isRequestedKind(value: unknown): value is RequestedKind {
  return typeof value === "string" && (REQUESTED_KINDS as readonly string[]).includes(value);
}

/** ISO `YYYY-MM-DD`, or null — and null IS «در اولین فرصت». */
export type RequestedDay = string | null;

/** What an order with no committed day says on its card. Persian, never an English token and
 *  never a boolean — this string appears on hundreds of cards. */
export const UNCOMMITTED_LABEL = "در اولین فرصت";

export function isUncommitted(day: RequestedDay): boolean {
  return day === null;
}

/** What the card says. A committed day reads as a Jalali date, which is what every other date
 *  on a Persian screen shows; an uncommitted one says the words. */
export function requestedDayLabel(day: RequestedDay): string {
  return day === null ? UNCOMMITTED_LABEL : faJalaliDate(day);
}

/** A week offset resolved against a KNOWN today, so the arithmetic is testable.
 *
 *  `setUTCDate`, not milliseconds: the input is a bare civil date with no timezone, and
 *  adding `weeks * 7 * 86_400_000` through a local-time constructor silently shifts the day
 *  across a DST boundary — which would move a promise the driver made without any error.
 *
 *  Two refusals, both deliberate. A negative or fractional offset throws rather than rounding,
 *  because "next week" has no fractional reading and guessing one is how an order ends up
 *  promised for yesterday. And `'soonest'` throws: it has no offset to apply, and returning
 *  today's date would be the worst possible answer — it would look like a commitment nobody
 *  made, and the splitter would treat it as a PINNED order rather than as free material. */
export function resolveRequestedDay(
  kind: RequestedKind,
  weeks: number,
  todayIso: string,
): string {
  if (kind === "exact_date") return todayIso;
  if (kind === "soonest") {
    throw new Error("«در اولین فرصت» تاریخی ندارد");
  }
  if (!Number.isInteger(weeks) || weeks < 0) {
    throw new Error("فاصلهٔ هفته نامعتبر است");
  }
  const base = new Date(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) throw new Error("تاریخ نامعتبر");
  base.setUTCDate(base.getUTCDate() + weeks * 7);
  return base.toISOString().slice(0, 10);
}