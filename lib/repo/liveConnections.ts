/* Every open live stream, for the owner's "who is connected" card (idea L8, from Mercure's active
 * subscriptions). Example: the owner wonders whether driver Reza's phone is getting updates; the
 * card on «وضعیت سامانه» shows «رضا · اندروید · وصل از ۸:۱۲ · الان» without a phone call.
 *
 * Each app server writes its own rows (lib/live/hub.ts): one when a stream opens, a refresh every
 * heartbeat, a delete when it closes, and on start it clears what an earlier run of itself left.
 * A row not refreshed for a minute belongs to a server that died, and is not shown. */
import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";

export interface LiveConnectionRow {
  id: string;
  user_id: number | null;
  name: string | null;
  device: string | null;
  opened_at: string;
  last_seen: string;
  slow: boolean;
}

export async function openConnection(
  c: { id: string; organizationId: number; userId: number | null; server: string; device: string | null; lastEventId: number },
  db: Db = getDb()
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO live_connections (id, organization_id, user_id, server, device, last_event_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(c.id, c.organizationId, c.userId, c.server, c.device?.slice(0, 200) ?? null, c.lastEventId);
}

export async function closeConnection(id: string, db: Db = getDb()): Promise<void> {
  await db.prepare("DELETE FROM live_connections WHERE id = ?").run(id);
}

/** One heartbeat's refresh of this server's streams, in one statement. */
export async function touchConnections(rows: { id: string; lastEventId: number; slow: boolean }[], db: Db = getDb()): Promise<void> {
  if (rows.length === 0) return;
  await db
    .prepare(
      `UPDATE live_connections c SET last_seen = now(), last_event_id = u.last_id, slow = u.slow
         FROM unnest(CAST(? AS text[]), CAST(? AS bigint[]), CAST(? AS boolean[])) AS u(id, last_id, slow)
        WHERE c.id = u.id`
    )
    .run(`{${rows.map((r) => r.id).join(",")}}`, `{${rows.map((r) => r.lastEventId).join(",")}}`, `{${rows.map((r) => r.slow).join(",")}}`);
}

/** What an earlier run of this server left behind (it stopped without closing its streams). */
export async function clearServerConnections(server: string, db: Db = getDb()): Promise<void> {
  await db.prepare("DELETE FROM live_connections WHERE server = ?").run(server);
}

/** The company's open streams, people first by name, then display links. */
export async function connectionsOf(organizationId: number, db: Db = getDb()): Promise<LiveConnectionRow[]> {
  const rows = (await db
    .prepare(
      `SELECT c.id, c.user_id, u.display_name AS name, c.device, c.opened_at, c.last_seen, c.slow
         FROM live_connections c LEFT JOIN users u ON u.id = c.user_id
        WHERE c.organization_id = ? AND c.last_seen > now() - interval '60 seconds'
        ORDER BY u.display_name NULLS LAST, c.opened_at`
    )
    .all(organizationId)) as unknown as LiveConnectionRow[];
  return rows.map((r) => ({ ...r, slow: Boolean(r.slow) })); // the driver hands booleans back as 0 or 1
}
