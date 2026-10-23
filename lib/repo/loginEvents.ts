import { getDb } from "@/lib/db";

/** F110: the sign-in log. One row per attempt on a real account: a success, a wrong password, a
 *  deactivated account or a wrong second-step code. An attempt with a username that does not
 *  exist is NOT stored: it would keep whatever a stranger typed, which can be someone's password
 *  pasted into the wrong box. Kept 90 days; older rows are pruned on each write. */

export type LoginResult = "success" | "bad_password" | "inactive" | "bad_code";

const KEEP_DAYS = 90;

export function recordLogin(input: {
  organizationId: number;
  userId: number;
  result: LoginResult;
  ip: string | null;
  userAgent: string | null;
  now?: Date;
}): void {
  const db = getDb();
  const now = input.now ?? new Date();
  db.prepare(
    `INSERT INTO login_events (organization_id, user_id, result, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.organizationId,
    input.userId,
    input.result,
    input.ip && input.ip !== "unknown" ? input.ip.slice(0, 64) : null,
    input.userAgent ? input.userAgent.slice(0, 300) : null,
    now.toISOString()
  );
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
  db.prepare("DELETE FROM login_events WHERE organization_id = ? AND created_at < ?").run(input.organizationId, cutoff);
}

export interface LoginEventRow {
  id: number;
  user_id: number;
  display_name: string;
  result: LoginResult;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

const SELECT = `SELECT e.id, e.user_id, u.display_name, e.result, e.ip, e.user_agent, e.created_at
                  FROM login_events e JOIN users u ON u.id = e.user_id`;

/** The organisation's newest sign-ins, for the owner. */
export function recentLogins(organizationId: number, limit = 100): LoginEventRow[] {
  return getDb()
    .prepare(`${SELECT} WHERE e.organization_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT ?`)
    .all(organizationId, limit) as unknown as LoginEventRow[];
}

/** One person's own newest sign-ins, for /settings/security. */
export function myRecentLogins(organizationId: number, userId: number, limit = 10): LoginEventRow[] {
  return getDb()
    .prepare(`${SELECT} WHERE e.organization_id = ? AND e.user_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT ?`)
    .all(organizationId, userId, limit) as unknown as LoginEventRow[];
}

/** Each user's last successful sign-in, for the users admin page. */
export function lastSignInByUser(organizationId: number): Map<number, string> {
  const rows = getDb()
    .prepare(
      `SELECT user_id, MAX(created_at) AS at FROM login_events
        WHERE organization_id = ? AND result = 'success' GROUP BY user_id`
    )
    .all(organizationId) as unknown as { user_id: number; at: string }[];
  return new Map(rows.map((r) => [r.user_id, r.at]));
}
