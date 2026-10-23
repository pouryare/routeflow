/** SQL that SQLite and PostgreSQL spell differently, in one place (Wave P, phase 1).
 *
 *  App code writes these helpers instead of the SQLite spelling, so the PostgreSQL adapter
 *  changes what they return and nothing else. tests/sql-dialect-guard.test.ts refuses the
 *  SQLite-only spellings anywhere outside lib/database/.
 *
 *  "Today" is never asked of the database: SQLite's date('now') is the UTC day, which is
 *  yesterday in Tehran until 03:30. Pass tehranTodayIso() as a parameter instead. */

export type Dialect = "sqlite" | "postgres";

/** The database the app talks to. SQLite until the cut-over sets DB_DIALECT=postgres. */
export function dialect(): Dialect {
  return process.env.DB_DIALECT === "postgres" ? "postgres" : "sqlite";
}

/** The values of `expr` across a group, joined by commas. `distinct` drops repeats. */
export function stringAgg(expr: string, opts: { distinct?: boolean } = {}): string {
  const d = opts.distinct ? "DISTINCT " : "";
  return dialect() === "postgres" ? `string_agg(${d}CAST(${expr} AS text), ',')` : `GROUP_CONCAT(${d}${expr})`;
}

/** Whole days from `earlier` to `later`, both ISO dates (YYYY-MM-DD) or SQL expressions for one. */
export function daysBetween(later: string, earlier: string): string {
  return dialect() === "postgres"
    ? `(CAST(${later} AS date) - CAST(${earlier} AS date))`
    : `(julianday(${later}) - julianday(${earlier}))`;
}

/** The larger of two values (SQLite's two-argument MAX). */
export function greatest(a: string, b: string): string {
  return dialect() === "postgres" ? `GREATEST(${a}, ${b})` : `MAX(${a}, ${b})`;
}

/** The ISO date `days` after the date in `expr`, as YYYY-MM-DD text like the stored dates. */
export function addDays(expr: string, days: number): string {
  return dialect() === "postgres" ? `CAST(CAST(${expr} AS date) + ${days} AS text)` : `date(${expr}, '+${days} days')`;
}
