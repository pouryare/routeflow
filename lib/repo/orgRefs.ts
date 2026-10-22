/** "Is this row one of this company's?" for the ids a write is handed. A route that attaches
 *  something to an id from the request body (a price to a product, a rate to a person, an order
 *  to a run) asks here first; without it the id alone reaches every tenant's rows.
 *
 *  `organizationId` null means every company, and is only passed for a platform_owner who has
 *  not picked one (see `orgScopeId`). */

import { getDb } from "@/lib/db";
import { orgClause } from "@/lib/orgScope";

/** Tables this helper may name: a fixed list, because the name goes into the statement text. */
type OrgTable = "users" | "products" | "orders" | "customers" | "delivery_runs" | "groups" | "facilities" | "saved_locations";

export function inOrg(table: OrgTable, id: number, organizationId: number | null): boolean {
  if (!Number.isInteger(id)) return false;
  const org = orgClause("organization_id", organizationId);
  return !!getDb().prepare(`SELECT 1 FROM ${table} WHERE id = ?${org.sql}`).get(id, ...org.params);
}

/** An account of this company that holds one of `roles` (the SET of roles, not the primary column:
 *  a driver who also sells still earns a sales rate). */
export function userWithRoleInOrg(userId: number, roles: readonly string[], organizationId: number | null): boolean {
  if (!Number.isInteger(userId) || roles.length === 0) return false;
  const org = orgClause("u.organization_id", organizationId);
  return !!getDb()
    .prepare(
      `SELECT 1 FROM users u JOIN user_roles r ON r.user_id = u.id
        WHERE u.id = ? AND r.role IN (${roles.map(() => "?").join(", ")})${org.sql}`
    )
    .get(userId, ...roles, ...org.params);
}
