/** Territory groups, as the owner's admin screens manage them. Every statement names the
 *  company: `organizationId` null means "every company" and is only ever passed for a
 *  platform_owner who has not picked one (see `orgScopeId`). */

import { getDb } from "@/lib/db";
import { recomputeCustomerGroups } from "@/lib/groups";
import { orgClause } from "@/lib/orgScope";

export function listGroups(organizationId: number | null): Record<string, unknown>[] {
  const org = orgClause("g.organization_id", organizationId);
  return getDb()
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM districts d WHERE d.group_id = g.id) AS district_count,
              (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id AND u.active = 1) AS user_count
       FROM groups g WHERE 1 = 1${org.sql} ORDER BY g.name`
    )
    .all(...org.params) as unknown as Record<string, unknown>[];
}

/** Two different names can slugify to the same string, and slug is UNIQUE per company, so a
 *  collision would surface as a duplicate-name error nobody can act on. Suffix instead. Only
 *  this company's slugs count: another tenant's slug is no collision, and treating it as one
 *  would leak that it exists. */
function uniqueSlug(base: string, organizationId: number): string {
  const taken = getDb().prepare("SELECT 1 FROM groups WHERE slug = ? AND organization_id = ?");
  if (!taken.get(base, organizationId)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.get(candidate, organizationId)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Throws the database's UNIQUE error on a duplicate name; callers map it to a 409. */
export function createGroup(organizationId: number, name: string, slugBase: string, color: string): number {
  const result = getDb()
    .prepare("INSERT INTO groups (name, slug, color, active, created_at, organization_id) VALUES (?, ?, ?, 1, ?, ?)")
    .run(name, uniqueSlug(slugBase, organizationId), color, new Date().toISOString(), organizationId);
  return Number(result.lastInsertRowid);
}

export function groupExists(id: number, organizationId: number | null): boolean {
  const own = orgClause("organization_id", organizationId);
  return !!getDb().prepare(`SELECT id FROM groups WHERE id = ?${own.sql}`).get(id, ...own.params);
}

/** `sets` are `column = ?` fragments chosen by the route from a fixed list, never from input. */
export function updateGroup(id: number, organizationId: number | null, sets: string[], values: (string | number)[]): void {
  const own = orgClause("organization_id", organizationId);
  getDb().prepare(`UPDATE groups SET ${sets.join(", ")} WHERE id = ?${own.sql}`).run(...(values as never[]), id, ...own.params);
}

export function groupMemberCount(id: number): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE group_id = ?").get(id) as { n: number }).n;
}

/** Territory returns to unclaimed, then the group goes; returns how many customers were regrouped. */
export function deleteGroup(id: number, organizationId: number | null): number {
  const db = getDb();
  const own = orgClause("organization_id", organizationId);
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE districts SET group_id = NULL WHERE group_id = ?").run(id);
    db.prepare("UPDATE saved_locations SET group_id = NULL WHERE group_id = ?").run(id);
    db.prepare("UPDATE lead_lists SET group_id = NULL WHERE group_id = ?").run(id);
    db.prepare("UPDATE facilities SET group_id = NULL WHERE group_id = ?").run(id);
    db.prepare(`DELETE FROM groups WHERE id = ?${own.sql}`).run(id, ...own.params);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  // Its customers are now in nobody's territory; the cache has to say so.
  return recomputeCustomerGroups(db, organizationId);
}
