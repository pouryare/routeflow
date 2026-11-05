import { getDb } from "@/lib/db";
import type { AccessUser } from "@/lib/accessReview";

/** The company's active users with their last successful sign-in and whether the authenticator is on. */
export async function accessUsers(organizationId: number): Promise<AccessUser[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT u.id, u.display_name, u.role, (u.totp_enabled_at IS NOT NULL) AS has_authenticator,
              (SELECT MAX(l.created_at) FROM login_events l WHERE l.user_id = u.id AND l.result = 'success') AS last_sign_in
         FROM users u
        WHERE u.organization_id = ? AND u.active = 1
        ORDER BY u.display_name`
    )
    .all(organizationId)) as (Omit<AccessUser, "has_authenticator"> & { has_authenticator: unknown })[];
  return rows.map((r) => ({ ...r, id: Number(r.id), has_authenticator: !!r.has_authenticator }));
}

/** Login-As started in the last 30 days: who looked as whom, and when. Newest first, at most 5. */
export async function recentImpersonations(organizationId: number, nowIso = new Date().toISOString()) {
  const since = new Date(Date.parse(nowIso) - 30 * 86_400_000).toISOString();
  return (await getDb()
    .prepare(
      `SELECT e.occurred_at AS at, a.display_name AS actor, t.display_name AS target
         FROM events e
         LEFT JOIN users a ON a.id = e.actor_user_id
         LEFT JOIN users t ON t.id = e.entity_id
        WHERE e.organization_id = ? AND e.kind = 'auth.impersonation_started' AND e.occurred_at >= ?
        ORDER BY e.occurred_at DESC LIMIT 5`
    )
    .all(organizationId, since)).map((r) => ({ ...r })) as { at: string; actor: string | null; target: string | null }[];
}
