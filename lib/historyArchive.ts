/** Which history is old enough to move to the archive twins (db/migrations/1762700000000_history-archive.sql).
 *
 *  Example: with 12 hot months, on 2026-11-09 everything before 2025-11-09 moves. The cutoff is a
 *  plain date: the log tables keep their times as ISO text, and any time on an earlier day sorts
 *  before "2025-11-09" however it is written. */

export const DEFAULT_HOT_MONTHS = 12;
export const MIN_HOT_MONTHS = 3;
export const MAX_HOT_MONTHS = 120;

export function validHotMonths(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= MIN_HOT_MONTHS && n <= MAX_HOT_MONTHS;
}

/** The first day that stays hot: `months` calendar months before `today` (YYYY-MM-DD). A day
 *  the earlier month does not have (31 Aug minus 6 months) falls back to that month's last day. */
export function archiveCutoff(today: string, months: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const cy = Math.floor(total / 12);
  const cm = (total % 12) + 1;
  const last = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${cy}-${pad(cm)}-${pad(Math.min(d, last))}`;
}

/** The tables that move after the hot months, with the column that says when a row happened.
 *  A rule run moves only once it is resolved: an open one is still the rule engine's cooldown
 *  and escalation state (lib/repo/rules.ts). */
export const MONTHLY_ARCHIVE = [
  { table: "events", time: "occurred_at", also: "" },
  { table: "notifications", time: "created_at", also: "" },
  { table: "rule_runs", time: "fired_at", also: "AND resolved_at IS NOT NULL" },
  { table: "order_events", time: "created_at", also: "" },
] as const;
