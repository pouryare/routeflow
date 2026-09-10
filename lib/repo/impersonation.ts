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
