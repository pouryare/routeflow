import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";

/** Record that a row went away, so a device that pulled it before the delete finds out.
 *  Without a tombstone a hard delete never propagates -- the row just silently persists
 *  on every device that had it.
 *
 *  Call this from every hard DELETE of an offline-relevant row. Status changes (an order
 *  moving to CANCELLED) are NOT deletes and need no tombstone -- the row is still there,
 *  the pull sees its new `updated_at`. */
export async function tombstone(
  organizationId: number,
  entityType: string,
  entityId: number,
  db?: Db
): Promise<void> {
  await (db ?? getDb())
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

/** Tombstones for one org written by transaction `xid` or later: the PostgreSQL watermark
 *  (lib/repo/syncPull.ts). Rows from before sync_xid existed hold transaction 0
 *  (db/migrations/1762600100000_sync-xid-indexes.sql). */
export async function tombstonesSinceXid(organizationId: number, xid: string, db?: Db): Promise<Tombstone[]> {
  return (await (db ?? getDb())
    .prepare(
      `SELECT entity_type, entity_id, deleted_at FROM deleted_rows
        WHERE organization_id = ? AND sync_xid >= CAST(? AS xid8)
        ORDER BY deleted_at`
    )
    .all(organizationId, xid)) as unknown as Tombstone[];
}
