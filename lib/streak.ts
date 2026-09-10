/** A person's working days as an activity streak (item 14, `stats-activity-streak`).
 *
 *  The user asked for avatars on /sales/runs; the spec's point is that a grid of days
 *  answers "who is actually working" in a way a name on a row cannot. One cell per day,
 *  weeks as columns, the Persian week (Saturday first) down the side, shaded by how much
 *  happened that day.
 *
 *  Pure: dates in, grid out. Dates are `YYYY-MM-DD` and handled in UTC, so the grid never
 *  shifts a day across a time-zone boundary. A date repeated N times is N events that day. */

export type StreakLevel = 0 | 1 | 2 | 3 | 4;
export type StreakCell = { date: string; n: number; level: StreakLevel; future: boolean };
export type Streak = {
  /** Columns of seven cells, oldest week first; each column runs Saturday → Friday. */
  weeks: StreakCell[][];
  /** Events inside the window. */
  total: number;
  /** Days with anything on them inside the window. */
  activeDays: number;
  /** Consecutive active days ending today, or ending yesterday when today is still empty
   *  (a day in progress should not read as a broken streak). */
  current: number;
  /** The longest run of consecutive active days inside the window. */
  longest: number;
};

const DAY = 86_400_000;
const toMs = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** 0 for Saturday … 6 for Friday. */
const persianWeekday = (ms: number) => (new Date(ms).getUTCDay() + 1) % 7;

export function buildStreak(dates: string[], today: string, weeks = 12): Streak {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = d.slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const end = toMs(today);
  /* The first column starts on the Saturday on or before the window's first day, so every
     column is a whole Saturday-to-Friday week and the rows line up. */
  const firstDay = end - (weeks * 7 - 1) * DAY;
  const start = firstDay - persianWeekday(firstDay) * DAY;

  const inWindow = (ms: number) => ms >= firstDay && ms <= end;
  let max = 0;
  for (const [d, n] of counts) if (inWindow(toMs(d))) max = Math.max(max, n);
  const level = (n: number): StreakLevel => {
    if (n <= 0 || max === 0) return 0;
    return Math.min(4, Math.max(1, Math.ceil((n / max) * 4))) as StreakLevel;
  };

  const grid: StreakCell[][] = [];
  let total = 0;
  let activeDays = 0;
  for (let ms = start, col: StreakCell[] = []; ms <= end + 6 * DAY; ms += DAY) {
    const date = toDate(ms);
    const future = ms > end;
    const n = !future && ms >= firstDay ? counts.get(date) ?? 0 : 0;
    if (n > 0) {
      total += n;
      activeDays += 1;
    }
    col.push({ date, n, level: level(n), future });
    if (col.length === 7) {
      grid.push(col);
      col = [];
      if (ms >= end) break;
    }
  }

  const active = (ms: number) => (counts.get(toDate(ms)) ?? 0) > 0;
  let current = 0;
  for (let ms = active(end) ? end : end - DAY; ms >= firstDay && active(ms); ms -= DAY) current += 1;

  let longest = 0;
  for (let ms = firstDay, run = 0; ms <= end; ms += DAY) {
    run = active(ms) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  return { weeks: grid, total, activeDays, current, longest };
}
