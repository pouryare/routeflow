import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";

/** Record that a row went away, so a device that pulled it before the delete finds out.
 *  Without a tombstone a hard delete never propagates -- the row just silently persists
 *  on every device that had it.
 *
 *  Call this from every hard DELETE of an offline-relevant row. Status changes (an order
 *  moving to CANCELLED) are NOT deletes and need no tombstone -- the row is still there,
 *  the pull sees its new `updated_at`. */
export function tombstone(
  organizationId: number,
  entityType: string,
  entityId: number,
  db?: DatabaseSync
): void {
  (db ?? getDb())
    .prepare(
      "INSERT INTO deleted_rows (organization_id, entity_type, entity_id, deleted_at) VALUES (?, ?, ?, ?)"
    )
    .run(organizationId, entityType, entityId, new Date().toISOString());
}

export interface Tombstone {
  entity_type: string;
  entity_id: number;
  deleted_at: string;
}

/** Tombstones for one org since a watermark (exclusive). `since` null = all of them. */
export function tombstonesSince(
  organizationId: number,
  since: string | null,
  db?: DatabaseSync
): Tombstone[] {
  const conn = db ?? getDb();
  return since
    ? (conn
        .prepare(
          "SELECT entity_type, entity_id, deleted_at FROM deleted_rows WHERE organization_id = ? AND deleted_at > ? ORDER BY deleted_at"
        )
        .all(organizationId, since) as unknown as Tombstone[])
    : (conn
        .prepare(
          "SELECT entity_type, entity_id, deleted_at FROM deleted_rows WHERE organization_id = ? ORDER BY deleted_at"
        )
        .all(organizationId) as unknown as Tombstone[]);
}
