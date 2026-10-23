import { userInOrg } from "./organizations";
import { getDb } from "@/lib/db";
import { orgClause } from "@/lib/orgScope";

/** The three reads and one write the avatar routes need.
 *
 *  Raw SQL lives in lib/repo (tests/repo-boundary.test.ts), so these two routes hold no
 *  `.prepare(` of their own. Splitting them here also puts the tenant rule in ONE place:
 *  the upload route and the admin PATCH must agree about who an owner may act on, and two
 *  copies of the same WHERE clause is how they eventually stop agreeing. */

/** The file stem behind a person's avatar, or null when they have no photo. Only people of this
 *  company (`organizationId` null = every company, platform owner only): a face is not shared across
 *  tenants, and an id alone reaches every tenant's staff. */
export async function readAvatarStem(userId: number, organizationId: number | null): Promise<string | null | undefined> {
  const org = orgClause("organization_id", organizationId);
  const row = await getDb().prepare(`SELECT avatar_stem FROM users WHERE id = ?${org.sql}`).get(userId, ...org.params) as
    | { avatar_stem: string | null }
    | undefined;
  // `undefined` (no such user) and `null` (a real user with no photo) are different
  // answers and the route turns them into different statuses, so neither is collapsed.
  return row?.avatar_stem;
}

/** Is this person of this company? The upload route's only authorisation-relevant read; the query lives with the tenants. */
export async function avatarUserInOrg(userId: number, organizationId: number): Promise<boolean> {
  return await userInOrg(getDb(), userId, organizationId);
}

/** Point a user at their freshly uploaded avatar.
 *
 *  avatar_url is the ROUTE and avatar_stem the FILE; both are written together so there is
 *  no state where the route resolves to a stem that does not exist. */
export async function setAvatar(
  userId: number,
  organizationId: number,
  avatarUrl: string,
  stem: string,
): Promise<void> {
  await getDb().prepare("UPDATE users SET avatar_url = ?, avatar_stem = ? WHERE id = ? AND organization_id = ?").run(
    avatarUrl,
    stem,
    userId,
    organizationId,
  );
}