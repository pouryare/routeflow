/** The slow-queries card's arithmetic, kept apart from the database read so it can be tested.
 *
 *  Example: a query that ran 40 times at 180 ms each is "slow" (over 100 ms on average) and
 *  took 7.2 s in all; one that ran 9,000 times at 2 ms is fast each time but costs 18 s, so the
 *  card shows both numbers. */

export interface SlowQueryRow {
  id: string;
  query: string;
  calls: number;
  mean_ms: number;
  total_ms: number;
}

/** Above this average a query is marked for a look (the audit's worst page query was 145 ms). */
export const SLOW_MS = 100;

/** The housekeeping the database adapter sends around every statement, which says nothing about
 *  the app's own queries. */
const NOISE = /^\s*(SAVEPOINT|RELEASE|ROLLBACK|BEGIN|COMMIT|SET\s|SELECT set_config|LISTEN|UNLISTEN|NOTIFY)/i;

/** PostgreSQL's own foreign-key checks (`SELECT 1 FROM ONLY "public"."users" x ... FOR KEY SHARE OF x`). */
const KEY_CHECK = /FROM ONLY "[^"]+"\."[^"]+" x WHERE .* FOR KEY SHARE OF x/i;

export function isAppQuery(query: string): boolean {
  return !NOISE.test(query) && !KEY_CHECK.test(query) && !/pg_stat_statements/i.test(query);
}

/** One line of SQL to show: whitespace folded, cut at `max` characters with "…". */
export function shortSql(query: string, max = 160): string {
  const one = query.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Milliseconds as people read them: "0.4 ms", "145 ms", "7.2 s", "3.1 min"; under 0.1 ms is 0.1
 *  with `under` set, so the card says «کمتر از ۰٫۱» instead of a misleading 0. */
export function readableMs(ms: number): { value: number; unit: "ms" | "s" | "min"; under?: true } {
  if (ms < 0.1) return { value: 0.1, unit: "ms", under: true };
  if (ms >= 60_000) return { value: Math.round(ms / 6_000) / 10, unit: "min" };
  if (ms >= 1_000) return { value: Math.round(ms / 100) / 10, unit: "s" };
  return { value: ms >= 10 ? Math.round(ms) : Math.round(ms * 10) / 10, unit: "ms" };
}
