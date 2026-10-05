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

/** What a day MEANS, which is not the same as how much happened on it.
 *
 *  `pending` and `planned` exist because "nothing was recorded" and "nothing happened" are
 *  different facts, and this grid is used to decide who carries tomorrow:
 *
 *  - pending — a RUN EXISTS but nothing has been filed. `driverActivity` fills a cell only for
 *    a recorded delivery (`status='delivered' AND delivered_at IS NOT NULL`), so a driver who
 *    drove out this morning and has not filed yet used to be invisible, and he looked idle.
 *  - planned — a future day that already has a run on it. This is what makes fairness reach
 *    TOMORROW rather than only yesterday: you can see who is already loaded before you commit.
 */
export type DayState = "delivered" | "pending" | "none" | "future" | "planned";

export type StreakCell = {
  date: string;
  n: number;
  level: StreakLevel;
  future: boolean;
  state: DayState;
};

export interface StreakOptions {
  weeks?: number;
  /** Weeks shown PAST today. Two is the point: fairness that cannot see tomorrow is not
   *  a fair answer to "whose load is heavy". */
  futureWeeks?: number;
  /** Days with a run but nothing recorded. */
  pending?: string[];
  /** Future days that already have a run. */
  planned?: string[];
}
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

export function buildStreak(dates: string[], today: string, weeks?: number): Streak;
export function buildStreak(dates: string[], today: string, opts: StreakOptions): Streak;
export function buildStreak(
  dates: string[],
  today: string,
  optsOrWeeks: number | StreakOptions = 12,
): Streak {
  // A number keeps the old shape working: /sales/runs' own summary is about the past, and
  // forward weeks are opt-in so that view does not silently change.
  const opts: StreakOptions =
    typeof optsOrWeeks === "number" ? { weeks: optsOrWeeks } : optsOrWeeks;
  const weeks = opts.weeks ?? 12;
  const futureWeeks = opts.futureWeeks ?? 0;
  const pendingDays = new Set((opts.pending ?? []).map((d) => d.slice(0, 10)));
  const plannedDays = new Set((opts.planned ?? []).map((d) => d.slice(0, 10)));
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = d.slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const end = toMs(today);
  /* The last column ends on the Friday on or after the window's last FUTURE day, so the
     trailing partial week is filled and the weekday rows stay aligned down the side --
     exactly the reason the past-only version snapped `start` back to a Saturday. */
  /* The window runs from `firstDay` to the end of the week containing `lastDay`, so the
   * trailing partial week is filled rather than left ragged -- the same reason the past-only
   * version snapped `start` back to a Saturday. */
  const lastDay = end + futureWeeks * 7 * DAY;
  const firstDay = end - (weeks * 7 - 1) * DAY;
  const start = firstDay - persianWeekday(firstDay) * DAY;
  const finish = lastDay + (6 - persianWeekday(lastDay)) * DAY;

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
  for (let ms = start, col: StreakCell[] = []; ms <= finish; ms += DAY) {
    const date = toDate(ms);
    const future = ms > end;
    const n = !future && ms >= firstDay ? counts.get(date) ?? 0 : 0;
    if (n > 0) {
      total += n;
      activeDays += 1;
    }
    /* A pending day is a day with a RUN on it, so it is shaded like work — but it is not a
       recorded delivery, which is why `n` stays 0 and the streak below ignores it. */
    const pending = !future && pendingDays.has(date);
    const planned = future && plannedDays.has(date);
    const state: DayState = n > 0
      ? "delivered"
      : pending
        ? "pending"
        : planned
          ? "planned"
          : future
            ? "future"
            : "none";
    col.push({ date, n, level: level(n), future, state });
    if (col.length === 7) {
      grid.push(col);
      col = [];
      if (ms >= finish) break;
    }
    /* A column is only complete when all seven days exist; without this the last partial
       week was pushed as a short column and the grid had 15 columns for a 14-column ask. */
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
