/** Photo metadata. A photo is *of* a customer, district or facility and inherits that row's
 *  scope: reads apply `entityGroupFilter("p")`, single-photo routes check `canReachEntity`. */

import { getDb, logActivity, type Photo } from "@/lib/db";
import { withEntityLabels } from "@/lib/repo/entityLabels";

type Filter = { joins: string; sql: string; params: number[] };

export function listPhotos(filter: Filter, entityType: string | null, entityId: string | null) {
  const db = getDb();
  const rows = (
    entityType && entityId
      ? db
          .prepare(`SELECT p.* FROM photos p${filter.joins} WHERE p.entity_type = ? AND p.entity_id = ?${filter.sql} ORDER BY p.taken_at DESC`)
          .all(entityType, Number(entityId), ...filter.params)
      : db
          .prepare(`SELECT p.* FROM photos p${filter.joins} WHERE 1 = 1${filter.sql} ORDER BY p.taken_at DESC LIMIT 500`)
          .all(...filter.params)
  ) as unknown as Photo[];
  // A display label for the standalone gallery view.
  return withEntityLabels(db, rows);
}

export function findPhoto(id: number): Photo | undefined {
  return getDb().prepare("SELECT * FROM photos WHERE id = ?").get(id) as Photo | undefined;
}

export function addPhoto(entityType: string, entityId: number, stem: string, caption: string | null, actor: { name: string; id: number }): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(`INSERT INTO photos (entity_type, entity_id, file_stem, caption, taken_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(entityType, entityId, stem, caption, now, now);
  logActivity(db, {
    entity_type: entityType as never,
    entity_id: entityId,
    event_type: "note",
    old_value: null,
    new_value: null,
    note: "عکس جدید اضافه شد",
    changed_by: actor.name,
    changed_by_user_id: actor.id,
  });
  return Number(result.lastInsertRowid);
}

export function deletePhoto(id: number): void {
  getDb().prepare("DELETE FROM photos WHERE id = ?").run(id);
}
