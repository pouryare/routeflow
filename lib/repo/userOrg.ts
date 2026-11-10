import type { Db } from "@/lib/database/client";

/** The organisation a user belongs to, for stamping rows that carry no tenant of their own.
 *
 *  The commission rate and payment tables are read with `organization_id = ?`. Rows inserted
 *  without the column stayed NULL until the next boot's backfill, so a rate or payment an
 *  owner had just entered was missing from their own screen. Null (not a guess) when the user
 *  is unknown, which is what the backfill does too. */
export async function orgOfUser(db: Db, ...userIds: (number | null | undefined)[]): Promise<number | null> {
  for (const id of userIds) {
    if (id == null) continue;
    const row = await db.prepare("SELECT organization_id FROM users WHERE id = ?").get(id) as
      | { organization_id: number | null }
      | undefined;
    if (row?.organization_id != null) return row.organization_id;
  }
  return null;
}

/** Display name and organisation of many users in one query, by id (the statement pages read one
 *  user row per person). */
export async function namesOf(db: Db, userIds: number[]): Promise<Map<number, { display_name: string; organization_id: number | null }>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .prepare(`SELECT id, display_name, organization_id FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`)
    .all(...userIds) as unknown as { id: number; display_name: string; organization_id: number | null }[];
  return new Map(rows.map((r) => [r.id, r]));
}
