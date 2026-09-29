import type { DatabaseSync } from "node:sqlite";

/** The one read the Login-As route needs: the user an owner asked to act as.
 *
 *  Raw SQL lives in lib/repo (tests/repo-boundary.test.ts). Whether the owner may act as
 *  this user is not decided here; lib/impersonation.ts's `impersonationRefusal` is the
 *  rule, and it is handed whatever this returns, including null. */
export type ImpersonationTarget = {
  id: number;
  role: string;
  group_id: number | null;
  organization_id: number;
  token_version: number;
  display_name: string;
  active: number;
};

export function readImpersonationTarget(db: DatabaseSync, userId: number): ImpersonationTarget | null {
  if (!Number.isInteger(userId)) return null;
  return (
    (db
      .prepare(
        "SELECT id, role, group_id, organization_id, token_version, display_name, active FROM users WHERE id = ?",
      )
      .get(userId) as ImpersonationTarget | undefined) ?? null
  );
}

export type ImpersonatableUser = {
  id: number;
  display_name: string;
  role: string;
  /** The FULL set. A dual-hat driver is not one hat, and the switcher that shows only
   *  `users.role` would misrepresent the very person this feature exists to inspect. */
  roles: string[];
  group_id: number | null;
  organization_id: number;
  organization_name: string;
  active: number;
};

/** Every account the switcher may offer, across EVERY organisation.
 *
 *  Not scoped to the caller's own org. Cross-tenant support is the entire purpose of the
 *  tool — the founder is the vendor, and a customer he does not work for is exactly the one
 *  he needs to look at. What makes that accountable rather than invisible is the audit
 *  column (impersonated_by) plus the platform_access_log the route writes.
 *
 *  Deactivated accounts are excluded, and so are deactivated ORGANISATIONS: offering one
 *  would mint a session that dies on the very next request, and the founder would blame
 *  the app for it. */
export function readImpersonatable(db: DatabaseSync): ImpersonatableUser[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.display_name, u.role, u.group_id, u.organization_id, u.active,
              o.name AS organization_name
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
        WHERE u.active = 1 AND o.active = 1
        ORDER BY o.name, u.display_name`
    )
    .all() as Array<Omit<ImpersonatableUser, "roles">>;

  // One grouped pass rather than a query per row: N+1 here is N queries per switcher open.
  const byUser = new Map<number, string[]>();
  for (const r of db
    .prepare("SELECT user_id, role FROM user_roles ORDER BY role")
    .all() as Array<{ user_id: number; role: string }>) {
    (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)!).push(r.role);
  }

  return rows.map((r) => ({
    ...r,
    // An account with no set rows falls back to its primary, mirroring the session rule,
    // so the switcher can never show someone as role-less while their session says otherwise.
    roles: byUser.get(r.id)?.length ? byUser.get(r.id)! : [r.role],
  }));
}
