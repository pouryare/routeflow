/** The tenant registry. Almost everything is scoped *to* one organisation and never
 *  needs to enumerate them; the exceptions are cross-tenant operators — the sweep cron
 *  (lib/sweepAuth) and the platform_owner surface. */

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
import { logPlatformAccess } from "@/lib/platformAccess";
import type { Session } from "@/lib/session";

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

/** A company's display name, or null if there is no such company (the acting-company banner). */
export function organizationName(organizationId: number): string | null {
  const row = getDb().prepare("SELECT name FROM organizations WHERE id = ?").get(organizationId) as { name: string } | undefined;
  return row?.name ?? null;
}

export interface OrganizationChoice {
  id: number;
  name: string;
  active: number;
}

/** Every company, by name, for the platform owner's acting-company picker. */
export function listOrganizations(): OrganizationChoice[] {
  return getDb()
    .prepare("SELECT id, name, active FROM organizations ORDER BY name")
    .all()
    .map((o) => ({ ...o })) as unknown as OrganizationChoice[];
}

/** The company with this id, or undefined when there is none. */
export function findOrganization(organizationId: number): OrganizationChoice | undefined {
  const row = getDb().prepare("SELECT id, name, active FROM organizations WHERE id = ?").get(organizationId) as OrganizationChoice | undefined;
  return row ? { ...row } : undefined;
}

/** Record that the platform owner switched into this company (platform_access_log). A switch into
 *  the company the session is already in is not cross-company access and is not logged. */
export function logActingOrgSwitch(session: Session, organizationId: number): void {
  logPlatformAccess(getDb(), session, "/api/admin/acting-org", organizationId);
}
