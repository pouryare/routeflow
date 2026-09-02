/** Does a recurrence rule fire on a given Jalali date? Pure. The vocabulary is small on
 *  purpose (spec §9): `daily`, `weekly:<day>`, `monthly:<1-28>`. Anything richer becomes
 *  a Phase 7 `rules` sweep query instead.
 *
 *  `jalaliDate` is a `YYYY-MM-DD` Jalali string (see `spawnRecurringTasks`).
 */
import { jalaliToGregorian } from "@/lib/jalali";

/** Jalali weekday order: Saturday = 0 … Friday = 6. */
const DAYS = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"] as const;

function jalaliWeekday(jalaliDate: string): number {
  const [jy, jm, jd] = jalaliDate.split("-").map(Number);
  const g = jalaliToGregorian(jy, jm, jd);
  // JS getUTCDay(): Sunday = 0 … Saturday = 6. Shift so Saturday = 0 … Friday = 6.
  const dow = new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).getUTCDay();
  return (dow + 1) % 7;
}

export function rruleMatches(rrule: string, jalaliDate: string): boolean {
  if (rrule === "daily") return true;

  const sep = rrule.indexOf(":");
  if (sep < 0) return false;
  const head = rrule.slice(0, sep);
  const arg = rrule.slice(sep + 1);

  if (head === "weekly") {
    const idx = (DAYS as readonly string[]).indexOf(arg);
    return idx >= 0 && jalaliWeekday(jalaliDate) === idx;
  }

  if (head === "monthly") {
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1 || n > 28) return false;
    return Number(jalaliDate.split("-")[2]) === n;
  }

  return false;
}
