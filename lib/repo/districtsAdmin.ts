/** Districts are shared geography (no organization_id); a company's hold on one is its group_id.
 *  Reads and writes here are therefore gated by the group the caller may reach, which the route
 *  decides with `canReachGroup` and passes in as `canReach`. */

import { getDb, logActivity, type District } from "@/lib/db";
import { recomputeCustomerGroups } from "@/lib/groups";
import { STATUS_LABEL } from "@/lib/types";

export function districtsSignature(): { c: number; m: string | null } {
  return getDb().prepare("SELECT COUNT(*) c, MAX(updated_at) m FROM districts").get() as { c: number; m: string | null };
}

export function findDistrict(id: number): District | undefined {
  return getDb().prepare("SELECT * FROM districts WHERE id = ?").get(id) as District | undefined;
}

/** parent_name is '' and not NULL because UNIQUE(name, level, parent_name) treats every NULL as
 *  distinct, so a NULL would let a second identical draw through. Throws UNIQUE on a duplicate. */
export function insertCustomDistrict(name: string, geometry: unknown, status: string, notes: string | null, groupId: number | null): number {
  const result = getDb()
    .prepare(
      `INSERT INTO districts (name, level, parent_name, boundary_geojson, coverage_status, notes, is_custom, group_id, updated_at)
       VALUES (?, 'mahalle', '', ?, ?, ?, 1, ?, ?)`
    )
    .run(name, JSON.stringify(geometry), status, notes, groupId, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

interface Actor {
  name: string;
  id: number;
}

const label = (s: string) => STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? s;

/** Status/notes edit of one district plus its activity-log lines, in one transaction. */
export function updateDistrict(existing: District, patch: { coverage_status?: string; notes?: string | null }, actor: Actor): void {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.coverage_status !== undefined) {
    sets.push("coverage_status = ?");
    values.push(patch.coverage_status);
  }
  if (patch.notes !== undefined) {
    sets.push("notes = ?");
    values.push(patch.notes);
  }
  sets.push("updated_at = ?");
  values.push(new Date().toISOString(), existing.id);

  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE districts SET ${sets.join(", ")} WHERE id = ?`).run(...(values as never[]));
    if (patch.coverage_status !== undefined && patch.coverage_status !== existing.coverage_status) {
      logActivity(db, {
        entity_type: "district", entity_id: existing.id, event_type: "status_change",
        old_value: label(existing.coverage_status), new_value: label(patch.coverage_status), note: null,
        changed_by: actor.name, changed_by_user_id: actor.id,
      });
    }
    if (patch.notes !== undefined && patch.notes !== existing.notes && patch.notes) {
      logActivity(db, {
        entity_type: "district", entity_id: existing.id, event_type: "note",
        old_value: null, new_value: null, note: patch.notes,
        changed_by: actor.name, changed_by_user_id: actor.id,
      });
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Every id the caller cannot reach, checked before anything is written, so a request is whole or refused. */
export function anyUnreachable(ids: number[], canReach: (groupId: number | null) => boolean): boolean {
  const stmt = getDb().prepare("SELECT group_id FROM districts WHERE id = ?");
  return ids.some((id) => {
    const row = stmt.get(id) as { group_id: number | null } | undefined;
    return !!row && !canReach(row.group_id);
  });
}

/** Sets status and/or group on many districts in one transaction. customers.group_id is a cache
 *  derived from which district contains each customer, so moving territory regroups the company's
 *  customers (after COMMIT: it opens its own transaction). */
export function bulkUpdateDistricts(
  ids: number[],
  change: { coverage_status?: string; group_id?: number | null },
  actor: Actor,
  organizationId: number | null
): { updated: number; regrouped: number } {
  const db = getDb();
  const now = new Date().toISOString();
  let updated = 0;
  db.exec("BEGIN");
  try {
    const getStmt = db.prepare("SELECT * FROM districts WHERE id = ?");
    const sets: string[] = [];
    if (change.coverage_status !== undefined) sets.push("coverage_status = ?");
    if (change.group_id !== undefined) sets.push("group_id = ?");
    sets.push("updated_at = ?");
    const updateStmt = db.prepare(`UPDATE districts SET ${sets.join(", ")} WHERE id = ?`);
    for (const id of ids) {
      const existing = getStmt.get(id) as District | undefined;
      if (!existing) continue;
      const values: unknown[] = [];
      if (change.coverage_status !== undefined) values.push(change.coverage_status);
      if (change.group_id !== undefined) values.push(change.group_id ?? null);
      values.push(now, id);
      updateStmt.run(...(values as never[]));
      updated++;
      if (change.coverage_status !== undefined && change.coverage_status !== existing.coverage_status) {
        logActivity(db, {
          entity_type: "district", entity_id: id, event_type: "status_change",
          old_value: label(existing.coverage_status), new_value: label(change.coverage_status), note: null,
          changed_by: actor.name, changed_by_user_id: actor.id,
        });
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { updated, regrouped: change.group_id !== undefined ? recomputeCustomerGroups(db, organizationId) : 0 };
}

export function deleteDistrict(id: number): void {
  getDb().prepare("DELETE FROM districts WHERE id = ?").run(id);
}
