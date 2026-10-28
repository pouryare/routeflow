/** SQL helpers for the few things worth spelling once (PostgreSQL).
 *
 *  App code writes these rather than the raw spelling so the rule lives in one place, and
 *  tests/sql-dialect-guard.test.ts refuses the SQLite-only spellings (the app ran on SQLite until
 *  the cut-over) anywhere outside lib/database/.
 *
 *  "Today" is never asked of the database: its clock is UTC, which is yesterday in Tehran until
 *  03:30. Pass tehranTodayIso() as a parameter instead. */

/** The values of `expr` across a group, joined by commas. `distinct` drops repeats. */
export function stringAgg(expr: string, opts: { distinct?: boolean } = {}): string {
  const d = opts.distinct ? "DISTINCT " : "";
  return `string_agg(${d}CAST(${expr} AS text), ',')`;
}

/** Whole days from `earlier` to `later`, both ISO dates (YYYY-MM-DD) or SQL expressions for one. */
export function daysBetween(later: string, earlier: string): string {
  return `(CAST(${later} AS date) - CAST(${earlier} AS date))`;
}

/** The larger of two values. */
export function greatest(a: string, b: string): string {
  return `GREATEST(${a}, ${b})`;
}

/** The ISO date `days` after the date in `expr`, as YYYY-MM-DD text like the stored dates. */
export function addDays(expr: string, days: number): string {
  return `CAST(CAST(${expr} AS date) + ${days} AS text)`;
}

/** `expr` rounded to `digits` places, halves away from zero as roundToman does. PostgreSQL rounds
 *  a double precision half to even, so it rounds the numeric instead. */
export function round(expr: string, digits = 0): string {
  const d = digits ? `, ${digits}` : "";
  return `ROUND(CAST(${expr} AS numeric)${d})`;
}
