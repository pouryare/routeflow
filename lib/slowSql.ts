import type { DatabaseSync } from "node:sqlite";

/** `ROUTEFLOW_SLOW_SQL_MS=200` logs every statement that takes 200ms or longer; unset, empty,
 *  zero or anything that is not a positive number leaves the database untouched. */
export function slowSqlThresholdMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.ROUTEFLOW_SLOW_SQL_MS);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const oneLine = (sql: string) => {
  const flat = sql.replace(/\s+/g, " ").trim();
  return flat.length > 240 ? `${flat.slice(0, 240)}…` : flat;
};

/** Times every statement on this handle and warns about the slow ones.
 *
 *  All of this app's database calls are synchronous, so one slow statement blocks the whole
 *  server for its duration -- and a missing index shows up only as "the page got slower" with
 *  nothing to point at. This puts the offending SQL in the log with its duration. It wraps the
 *  handle's own `prepare` and `exec`, so migrations and boot backfills are covered too; it is
 *  only installed when a threshold is configured, so the normal path pays nothing. */
export function instrumentSlowSql(db: DatabaseSync, thresholdMs: number): void {
  const report = (sql: string, started: number) => {
    const took = performance.now() - started;
    if (took >= thresholdMs) console.warn(`[slow-sql] ${Math.round(took)}ms ${oneLine(sql)}`);
  };

  const exec = db.exec.bind(db);
  db.exec = (sql: string) => {
    const started = performance.now();
    try {
      return exec(sql);
    } finally {
      report(sql, started);
    }
  };

  const prepare = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    const statement = prepare(sql);
    for (const method of ["run", "get", "all"] as const) {
      const original = statement[method].bind(statement) as (...args: unknown[]) => unknown;
      (statement as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        const started = performance.now();
        try {
          return original(...args);
        } finally {
          report(sql, started);
        }
      };
    }
    return statement;
  };
}
