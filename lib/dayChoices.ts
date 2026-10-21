import { addDaysIso } from "@/lib/flows/dates";
import { holidaysForJalaliYear } from "@/lib/holidays";
import { faJalaliDate, toJalali } from "@/lib/jalali";
import { faNum } from "@/lib/format";

/** The days a person actually means: "today", "tomorrow", "Saturday". Typing a date into a
 *  calendar is the last resort, not the first thing shown.
 *
 *  Pure: it takes today and the holidays it should know about. Iran's week ends on Friday, so
 *  Friday is always kept but flagged. A holiday is REMOVED when picking a working day (a delivery
 *  cannot be promised for Nowruz) and FLAGGED but kept when picking freely (a reminder may land on
 *  a holiday). The solar holidays are computable offline; the lunar ones live in the database, so
 *  a caller that has them passes them in. */
export interface DayChoice {
  kind: "day" | "other";
  iso?: string;
  label: string;
  sub?: string;
  flag?: "weekend" | "holiday";
}

const WEEKDAY = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
const weekdayOf = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
const FRIDAY = 5;

function flagOf(iso: string, holidays: Set<string>): DayChoice["flag"] {
  if (holidays.has(iso)) return "holiday";
  return weekdayOf(iso) === FRIDAY ? "weekend" : undefined;
}

function labelOf(iso: string, today: string): string {
  const offset = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (offset === 0) return "امروز";
  if (offset === 1) return "فردا";
  if (offset === 2) return "پس‌فردا";
  const j = toJalali(iso);
  return `${WEEKDAY[weekdayOf(iso)]}${j ? ` ${faNum(j.jd)}` : ""}`;
}

export function dayChoices(
  today: string,
  opts: { holidays: Set<string>; count?: number; skipHolidays?: boolean },
): DayChoice[] {
  const { holidays, count = 5, skipHolidays = true } = opts;
  const out: DayChoice[] = [];
  for (let i = 0; i < 90 && out.length < count; i += 1) {
    const iso = addDaysIso(today, i);
    if (skipHolidays && holidays.has(iso)) continue;
    out.push({ kind: "day", iso, label: labelOf(iso, today), sub: faJalaliDate(iso), flag: flagOf(iso, holidays) });
  }
  out.push({ kind: "other", label: "روز دیگر…" });
  return out;
}

/** A swipeable strip: `days` consecutive days from `start`, nothing hidden, holidays and Fridays marked. */
export function weekDays(start: string, days: number, holidays: Set<string>): DayChoice[] {
  return Array.from({ length: days }, (_, i) => {
    const iso = addDaysIso(start, i);
    return { kind: "day" as const, iso, label: labelOf(iso, start), sub: faJalaliDate(iso), flag: flagOf(iso, holidays) };
  });
}

/** The solar-calendar holidays within `days` of `start`, as ISO dates. The lunar ones are not
 *  knowable here (see lib/holidays.ts); callers that have them add them to the set. */
export function solarHolidaysAround(start: string, days: number): Set<string> {
  const a = toJalali(start);
  const b = toJalali(addDaysIso(start, days));
  const out = new Set<string>();
  if (!a || !b) return out;
  for (let y = a.jy; y <= b.jy; y += 1) for (const h of holidaysForJalaliYear(y)) out.add(h.iso);
  return out;
}
