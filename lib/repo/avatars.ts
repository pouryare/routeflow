import type { DatabaseSync } from "node:sqlite";

/** The three reads and one write the avatar routes need.
 *
 *  Raw SQL lives in lib/repo (tests/repo-boundary.test.ts), so these two routes hold no
 *  `.prepare(` of their own. Splitting them here also puts the tenant rule in ONE place:
 *  the upload route and the admin PATCH must agree about who an owner may act on, and two
 *  copies of the same WHERE clause is how they eventually stop agreeing. */

/** The file stem behind a person's avatar, or null when they have no photo. */
export function readAvatarStem(db: DatabaseSync, userId: number): string | null | undefined {
  const row = db.prepare("SELECT avatar_stem FROM users WHERE id = ?").get(userId) as
    | { avatar_stem: string | null }
    | undefined;
  // `undefined` (no such user) and `null` (a real user with no photo) are different
  // answers and the route turns them into different statuses, so neither is collapsed.
  return row?.avatar_stem;
}

/** Does this user exist in this tenant? The upload route's only authorisation-relevant read. */
export function userInOrg(db: DatabaseSync, userId: number, organizationId: number): boolean {
  return !!db
    .prepare("SELECT id FROM users WHERE id = ? AND organization_id = ?")
    .get(userId, organizationId);
}

/** Point a user at their freshly uploaded avatar.
 *
 *  avatar_url is the ROUTE and avatar_stem the FILE; both are written together so there is
 *  no state where the route resolves to a stem that does not exist. */
export function setAvatar(
  db: DatabaseSync,
  userId: number,
  avatarUrl: string,
  stem: string,
): void {
  db.prepare("UPDATE users SET avatar_url = ?, avatar_stem = ? WHERE id = ?").run(
    avatarUrl,
    stem,
    userId,
  );
}