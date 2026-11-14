import { getDb } from "@/lib/db";
import { publishEphemeral } from "@/lib/repo/live";
import { groupFilter, type Session } from "@/lib/session";
import type { PositionIn } from "@/lib/vanPositions";

export interface VanDot { user_id: number; name: string; lat: number; lng: number; accuracy_m: number | null; recorded_at: string }

/** A driver's phone reports where it is. Kept only while one of their runs is in progress, so a driver who is
 *  off the clock is never tracked; null says there is no such run. Sends the dot to the owner and the managers of
 *  the run's group (an open map moves it at once). */
export async function recordPosition(session: Session, p: PositionIn): Promise<"saved" | "no_run"> {
  const db = getDb();
  const orgId = session.organizationId;
  const run = (await db
    .prepare("SELECT id, group_id FROM delivery_runs WHERE driver_user_id = ? AND organization_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1")
    .get(session.user.id, orgId)) as { id: number; group_id: number | null } | undefined;
  if (!run) return "no_run";
  const at = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO van_positions (organization_id, user_id, lat, lng, accuracy_m, recorded_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, accuracy_m = EXCLUDED.accuracy_m, recorded_at = EXCLUDED.recorded_at`
    )
    .run(orgId, session.user.id, p.lat, p.lng, p.accuracyM, at);
  const watchers = (await db
    .prepare("SELECT id FROM users WHERE organization_id = ? AND active = 1 AND (role = 'owner' OR (role = 'group_manager' AND group_id IS NOT DISTINCT FROM ?))")
    .all(orgId, run.group_id)) as { id: number }[];
  if (watchers.length > 0) {
    await publishEphemeral(orgId, { topic: "van.pos", users: watchers.map((w) => Number(w.id)), data: { u: session.user.id, n: session.user.display_name, la: p.lat, ln: p.lng, at } });
  }
  return "saved";
}

/** The dots this person may see: drivers with a run in progress in their groups, newest fix per driver. */
export async function vansFor(session: Session): Promise<VanDot[]> {
  const scope = await groupFilter(session, "dr.group_id");
  const rows = (await getDb()
    .prepare(
      `SELECT vp.user_id, u.display_name AS name, vp.lat, vp.lng, vp.accuracy_m, vp.recorded_at
         FROM van_positions vp JOIN users u ON u.id = vp.user_id
         JOIN delivery_runs dr ON dr.driver_user_id = vp.user_id AND dr.organization_id = vp.organization_id AND dr.status = 'in_progress'
        WHERE vp.organization_id = ?${scope.sql}
        GROUP BY vp.user_id, u.display_name, vp.lat, vp.lng, vp.accuracy_m, vp.recorded_at ORDER BY u.display_name`
    )
    .all(session.organizationId, ...scope.params)) as unknown as VanDot[];
  return rows.map((r) => ({ ...r, user_id: Number(r.user_id) }));
}
