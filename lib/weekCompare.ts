/** F67: "this week versus last" on the owner's and manager's briefing.
 *
 *  The week is Saturday to Friday. Mid-week, this week so far is set against the SAME days of
 *  last week (Saturday to the same weekday), not against the whole of last week: on a Monday a
 *  full week behind would read as a collapse every time. */
import { DAY, toMs, toDate, persianWeekday } from "@/lib/persianWeek";

export interface DayWindow {
  /** Inclusive `YYYY-MM-DD`. */
  from: string;
  /** Exclusive `YYYY-MM-DD`. */
  toExcl: string;
}

export function weekWindows(todayIso: string): { thisWeek: DayWindow; lastWeek: DayWindow; days: number } {
  const today = toMs(todayIso.slice(0, 10));
  const start = today - persianWeekday(today) * DAY;
  const end = today + DAY;
  return {
    thisWeek: { from: toDate(start), toExcl: toDate(end) },
    lastWeek: { from: toDate(start - 7 * DAY), toExcl: toDate(end - 7 * DAY) },
    days: persianWeekday(today) + 1,
  };
}

/** The change as a whole percent, or null when last week was zero and a percent means nothing. */
export function changePercent(now: number, before: number): number | null {
  if (before === 0) return null;
  return Math.round(((now - before) / before) * 100);
}
