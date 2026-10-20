/** The tenant registry. Almost everything is scoped *to* one organisation and never
 *  needs to enumerate them; the exceptions are cross-tenant operators — the sweep cron
 *  (lib/sweepAuth) and the platform_owner surface. */

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";

/** Every organisation id, ascending. */
export function allOrgIds(): number[] {
  return (
    getDb().prepare("SELECT id FROM organizations ORDER BY id").all() as { id: number }[]
  ).map((r) => r.id);
}

/** Does this user exist in this tenant? The authorisation-relevant read behind any route
 *  that attaches something to a user id it was handed (avatars, commission plans). */
export function userInOrg(db: DatabaseSync, userId: number, organizationId: number): boolean {
  return !!db
    .prepare("SELECT id FROM users WHERE id = ? AND organization_id = ?")
    .get(userId, organizationId);
}
