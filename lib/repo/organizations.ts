/** The tenant registry. Almost everything is scoped *to* one organisation and never
 *  needs to enumerate them; the exceptions are cross-tenant operators — the sweep cron
 *  (lib/sweepAuth) and the platform_owner surface. */

import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";
import { logPlatformAccess } from "@/lib/platformAccess";
import type { Session } from "@/lib/session";

/** Every organisation id, ascending. */
export async function allOrgIds(): Promise<number[]> {
  return (
    await getDb().prepare("SELECT id FROM organizations ORDER BY id").all() as { id: number }[]
  ).map((r) => r.id);
}

/** Does this user exist in this tenant? The authorisation-relevant read behind any route
 *  that attaches something to a user id it was handed (avatars, commission plans). */
export async function userInOrg(db: Db, userId: number, organizationId: number): Promise<boolean> {
  return !!await db
    .prepare("SELECT id FROM users WHERE id = ? AND organization_id = ?")
    .get(userId, organizationId);
}

/** A company's display name, or null if there is no such company (the acting-company banner). */
export async function organizationName(organizationId: number): Promise<string | null> {
  const row = await getDb().prepare("SELECT name FROM organizations WHERE id = ?").get(organizationId) as { name: string } | undefined;
  return row?.name ?? null;
}

export interface OrganizationChoice {
  id: number;
  name: string;
  active: number;
}

/** Every company, by name, for the platform owner's acting-company picker. */
export async function listOrganizations(): Promise<OrganizationChoice[]> {
  return (await getDb()
    .prepare("SELECT id, name, active FROM organizations ORDER BY name")
    .all())
    .map((o) => ({ ...o })) as unknown as OrganizationChoice[];
}

/** The company with this id, or undefined when there is none. */
export async function findOrganization(organizationId: number): Promise<OrganizationChoice | undefined> {
  const row = await getDb().prepare("SELECT id, name, active FROM organizations WHERE id = ?").get(organizationId) as OrganizationChoice | undefined;
  return row ? { ...row } : undefined;
}

/** Record that the platform owner switched into this company (platform_access_log). A switch into
 *  the company the session is already in is not cross-company access and is not logged. */
export async function logActingOrgSwitch(session: Session, organizationId: number): Promise<void> {
  await logPlatformAccess(getDb(), session, "/api/admin/acting-org", organizationId);
}
