import type { DatabaseSync } from "node:sqlite";

/** The organisation a user belongs to, for stamping rows that carry no tenant of their own.
 *
 *  The commission rate and payment tables are read with `organization_id = ?`. Rows inserted
 *  without the column stayed NULL until the next boot's backfill, so a rate or payment an
 *  owner had just entered was missing from their own screen. Null (not a guess) when the user
 *  is unknown, which is what the backfill does too. */
export function orgOfUser(db: DatabaseSync, ...userIds: (number | null | undefined)[]): number | null {
  for (const id of userIds) {
    if (id == null) continue;
    const row = db.prepare("SELECT organization_id FROM users WHERE id = ?").get(id) as
      | { organization_id: number | null }
      | undefined;
    if (row?.organization_id != null) return row.organization_id;
  }
  return null;
}
