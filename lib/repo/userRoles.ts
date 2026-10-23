import { getDb } from "../db";
import type { Role } from "../roles";

/** Everyone's roles, and the queries that ask about them.
 *
 *  This module exists so nineteen call sites do not each grow a hand-written join. The rule
 *  it encodes: a query asking "who can do X" reads THIS table, never `users.role`.
 *  `users.role` is one person's PRIMARY role and says nothing about the rest.
 *
 *  `users.role` still exists and still matters — it is the fallback when this set is empty,
 *  and it is the escape hatch that lets you set a primary and have the picker never appear.
 *  But it is never the answer to "can this person do X". */

/** The full set for one person, ordered. Empty means "no explicit set" — the session
 *  falls back to `users.role` in that case, so an account created by a script that
 *  predates this table keeps working rather than reaching nothing. */
export async function rolesFor(userId: number): Promise<Role[]> {
  // `.all()` hands back { role } objects. The cast in the plan's version silenced that and
  // shipped the objects themselves — callers got `Role[]` in the type and rows at runtime.
  // Plucking the field is the whole fix, and it is why the first two tests failed rather
  // than passing on a lie.
  return (
    await getDb()
      .prepare("SELECT role FROM user_roles WHERE user_id = ? ORDER BY role")
      .all(userId) as Array<{ role: string }>
  ).map((r) => r.role as Role);
}

export async function hasRole(userId: number, role: Role): Promise<boolean> {
  return (
    await getDb()
      .prepare("SELECT 1 FROM user_roles WHERE user_id = ? AND role = ?")
      .get(userId, role) !== undefined
  );
}

/** Replace a person's set outright. An empty array leaves them with no roles, which
 *  `requireRole` reads as "reaches nothing" -- the same reading as an empty scope. */
export async function setRoles(userId: number, roles: Role[]): Promise<void> {
  const db = getDb();
  await db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(userId);
  const ins = db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)");
  for (const r of roles) await ins.run(userId, r);
}

/** Everyone in the organisation who HOLDS this role, whoever their primary is.
 *
 *  This is what the nineteen §3.3 sites need: a person whose primary is `delivery_driver`
 *  but who also holds `field_rep` must appear in both lists. */
export async function usersWithRole(
  organizationId: number,
  role: Role
): Promise<Array<{ id: number; display_name: string; group_id: number | null }>> {
  return await getDb()
    .prepare(
      `SELECT u.id, u.display_name, u.group_id
         FROM users u JOIN user_roles r ON r.user_id = u.id
        WHERE u.organization_id = ? AND r.role = ? AND u.active = 1
        ORDER BY u.display_name`
    )
    .all(organizationId, role) as Array<{ id: number; display_name: string; group_id: number | null }>;
}

/** A reusable join for a query that filters people by a held role.
 *
 *  Usage: `FROM users u ${roleFilterJoin("u", "delivery_driver")}`. Built as one function so
 *  no call site hand-writes the join and forgets the tenant or the active flag. */
export function roleFilterJoin(alias: string, role: Role): string {
  return `JOIN user_roles ${alias}_r ON ${alias}_r.user_id = ${alias}.id AND ${alias}_r.role = '${role}'`;
}

/** A reusable EXISTS predicate, for a query that must MATCH a column holding a role name.
 *
 *  `roleFilterJoin` filters a people list. This is the other shape: `tasks.role_hint` and
 *  `task_rules.escalate_to_role` are plain TEXT holding a role NAME, and the question is
 *  "does this person hold the role this row names?" -- so the column moves to the other side
 *  of the comparison and cannot be a bound parameter. */
export function roleNameMatches(column: string, userIdParam: string): string {
  return `EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = ${userIdParam} AND r.role = ${column})`;
}
