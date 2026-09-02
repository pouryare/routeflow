import type { DatabaseSync } from "node:sqlite";
import type { Session } from "./session";

/** Record that the vendor looked at a tenant's data.
 *
 *  Only writes when a platform_owner reads an organisation that is not their own. An
 *  owner inside their own company is not cross-tenant access and logging it would bury
 *  the rows that matter under ordinary traffic.
 *
 *  Deliberately not fatal: a failure here must not take a support session down. It is an
 *  audit trail, and a missing line is a smaller problem than an outage -- but it is a
 *  real problem, so it is not swallowed silently either.
 */
export function logPlatformAccess(
  db: DatabaseSync,
  session: Session,
  path: string,
  organizationId: number | null
): void {
  if (session.role !== "platform_owner") return;
  if (organizationId === null || organizationId === session.organizationId) return;

  try {
    db.prepare(
      `INSERT INTO platform_access_log (platform_user_id, organization_id, path, occurred_at)
       VALUES (?, ?, ?, ?)`
    ).run(session.user.id, organizationId, path, new Date().toISOString());
  } catch (err) {
    console.error("[platform-access-log] failed to record access", { path, organizationId, err });
  }
}
