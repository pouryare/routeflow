/* T24: the limits that guard guessing (sign-in, second step, own password) kept in Postgres. Fixed windows like
 * lib/rateLimit.ts, but one table, so a restart or a second app copy does not reset a guesser. Each rule is a
 * short or a long window ("5 a minute and 20 an hour"); the call is refused if ANY window is full.
 * lib/rateLimit.ts stays in memory for the busy, harmless ones (live updates): a database round trip per ping
 * would cost more than the limit protects. */
import { getDb } from "@/lib/db";

export interface LimitRule {
  max: number;
  windowMs: number;
}

export async function rateLimitDb(
  key: string,
  rules: LimitRule[]
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const db = getDb();
  const now = Date.now();
  let wait = 0;
  for (const r of rules) {
    const row = (await db
      .prepare(
        `INSERT INTO rate_limits (key, attempts, reset_at) VALUES (?, 1, ?)
         ON CONFLICT (key) DO UPDATE SET
           attempts = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.attempts + 1 END,
           reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
         RETURNING attempts, reset_at`
      )
      .get(`${key}|${r.windowMs}`, now + r.windowMs, now, now, now + r.windowMs)) as { attempts: number; reset_at: number | string };
    if (row.attempts > r.max) wait = Math.max(wait, Math.ceil((Number(row.reset_at) - now) / 1000));
  }
  // Forget windows that ended, now and then, so one-off keys do not pile up.
  if (Math.random() < 0.02) await db.prepare("DELETE FROM rate_limits WHERE reset_at < ?").run(now - 3600_000);
  return { allowed: wait === 0, retryAfterSeconds: wait };
}

/** After a successful sign-in the person's own counters start again. */
export async function rateLimitDbReset(key: string, rules: LimitRule[]): Promise<void> {
  const db = getDb();
  for (const r of rules) await db.prepare("DELETE FROM rate_limits WHERE key = ?").run(`${key}|${r.windowMs}`);
}
