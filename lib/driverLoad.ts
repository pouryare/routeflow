/** A driver's recent load per run — the bars that turn "am I being fair to Reza?" from a
 *  feeling into something you can see.
 *
 *  Pure: run dates and weights in, bars and a fair line out.
 *
 *  The fair line is the driver's OWN RECENT MEAN, not a vehicle capacity. That is a policy
 *  choice and the app does not enforce it: it draws the line and leaves the decision to the
 *  person doing the planning. Capacity is the safer number and the mean is the truer one —
 *  "does this week look like his normal week" is the question actually being asked. */

import { DAY, toMs, toDate, persianWeekday } from "./persianWeek";

export interface LoadPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  kg: number;
}

export interface LoadBar {
  /** The Saturday that starts this bar's week. */
  weekStart: string;
  kg: number;
}

export interface RecentLoads {
  /** Oldest first, exactly `count` bars. A week with no run is a ZERO bar, not a gap —
   *  Bahram matters: a MISSING row is a mystery, an empty grid is an answer. */
  bars: LoadBar[];
  /** The fair line, or null before there is a full week of history to average. */
  meanKg: number | null;
}

/** Saturday-to-Friday, matching `streak.ts` — the same "week" the grid above draws. */
/** The Saturday on or before `ms`. */
const weekStartOf = (ms: number) => ms - persianWeekday(ms) * DAY;

export function recentLoads(points: LoadPoint[], today: string, count = 6): RecentLoads {
  const thisWeek = weekStartOf(toMs(today));

  const totals = new Map<number, number>();
  for (const p of points) {
    const start = weekStartOf(toMs(p.date.slice(0, 10)));
    totals.set(start, (totals.get(start) ?? 0) + p.kg);
  }

  const bars: LoadBar[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = thisWeek - i * 7 * DAY;
    bars.push({ weekStart: toDate(start), kg: totals.get(start) ?? 0 });
  }

  /* The mean EXCLUDES the current week.
   *
   * This week is half-spent. Averaging it in drags the number down — which is how a streak
   * grid and a bar chart come to disagree while sitting side by side on the same screen. The
   * week is still SHOWN as a bar; it just does not get a vote on what "normal" means. */
  const complete = bars.filter((b) => toMs(b.weekStart) < thisWeek && b.kg > 0);
  const meanKg =
    complete.length === 0 ? null : complete.reduce((n, b) => n + b.kg, 0) / complete.length;

  return { bars, meanKg };
}
