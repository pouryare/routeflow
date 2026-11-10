/* The slowest queries the app runs, from PostgreSQL's pg_stat_statements, for the platform
 * owner's card on «وضعیت سامانه». The text is the normalised statement ($1, $2 in place of
 * values), so no customer data shows; the counters are the whole server's, hence platform owner only.
 *
 * Without pg_read_all_stats a role sees the text of its own statements only, which is exactly the
 * app's: no extra grant is needed. If the extension is not loaded (shared_preload_libraries) the
 * read fails and the card says so instead of breaking the page. */
import { getDb } from "@/lib/db";
import { isAppQuery, type SlowQueryRow } from "@/lib/slowQueries";

export async function slowQueries(limit = 10): Promise<{ rows: SlowQueryRow[]; since: string | null } | null> {
  const db = getDb();
  try {
    const raw = (await db
      .prepare(
        `SELECT queryid::text AS id, query, calls, mean_exec_time AS mean_ms, total_exec_time AS total_ms
           FROM pg_stat_statements
          WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND userid = (SELECT oid FROM pg_roles WHERE rolname = current_user)
            AND calls >= 3
          ORDER BY mean_exec_time DESC
          LIMIT ?`
      )
      .all(limit * 4)) as unknown as SlowQueryRow[];
    const info = (await db.prepare("SELECT stats_reset::text AS since FROM pg_stat_statements_info").get()) as { since: string } | undefined;
    return { rows: raw.filter((r) => isAppQuery(r.query)).slice(0, limit), since: info?.since ?? null };
  } catch {
    return null;
  }
}
