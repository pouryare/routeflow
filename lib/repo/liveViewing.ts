/* Who has a record open right now (idea L6, from Supabase presence with state). Example: Sara
 * opens order 1042 while the manager already has it open; both see «مدیر هم این سفارش را باز کرده»
 * before either saves over the other. The open page refreshes its row every 20 seconds; a row
 * older than 45 seconds no longer counts, so a phone that died without saying goodbye drops off. */
import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";

export type ViewedType = "order" | "run" | "customer";
export interface Viewer {
  id: number;
  name: string;
}

export async function touchViewing(organizationId: number, userId: number, type: ViewedType, id: number, db: Db = getDb()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO live_viewing (user_id, organization_id, entity_type, entity_id, seen_at) VALUES (?, ?, ?, ?, now())
       ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET organization_id = EXCLUDED.organization_id, seen_at = now()`
    )
    .run(userId, organizationId, type, id);
}

export async function leaveViewing(organizationId: number, userId: number, type: ViewedType, id: number, db: Db = getDb()): Promise<void> {
  await db
    .prepare("DELETE FROM live_viewing WHERE organization_id = ? AND user_id = ? AND entity_type = ? AND entity_id = ?")
    .run(organizationId, userId, type, id);
}

/** Everyone with this record open now; at most 10. */
export async function viewersOf(organizationId: number, type: ViewedType, id: number, db: Db = getDb()): Promise<Viewer[]> {
  const rows = (await db
    .prepare(
      `SELECT v.user_id AS id, u.display_name AS name
         FROM live_viewing v JOIN users u ON u.id = v.user_id
        WHERE v.organization_id = ? AND v.entity_type = ? AND v.entity_id = ?
          AND v.seen_at > now() - interval '45 seconds'
        ORDER BY v.user_id LIMIT 10`
    )
    .all(organizationId, type, id)) as { id: number; name: string }[];
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}
