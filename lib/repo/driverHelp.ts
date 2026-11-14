import { getDb } from "@/lib/db";
import { flushNotifications } from "@/lib/repo/notifications";
import type { Session } from "@/lib/session";
import { helpBody, type HelpKind } from "@/lib/driverHelp";

/** A driver taps «نیاز به کمک»: the owner and the managers of the run's group get one CRITICAL notification
 *  (and its push) with the last GPS point and how old it is, the stops still pending and the driver's phone.
 *  Returns how many people were told, 0 when the driver has no open run. The manager re-plans by hand. */
export async function raiseDriverHelp(session: Session, kind: HelpKind): Promise<number> {
  const db = getDb();
  const orgId = session.organizationId;
  const run = (await db
    .prepare(
      `SELECT dr.id, dr.group_id FROM delivery_runs dr
        WHERE dr.driver_user_id = ? AND dr.organization_id = ? AND dr.status <> 'done'
        ORDER BY (dr.status = 'in_progress') DESC, dr.id DESC LIMIT 1`
    )
    .get(session.user.id, orgId)) as { id: number; group_id: number | null } | undefined;
  if (!run) return 0;
  const pending = Number(
    ((await db.prepare("SELECT COUNT(*) AS n FROM delivery_stops WHERE run_id = ? AND status = 'pending'").get(run.id)) as { n: number }).n
  );
  const pos = (await db
    .prepare("SELECT recorded_at FROM van_positions WHERE organization_id = ? AND user_id = ?")
    .get(orgId, session.user.id)) as { recorded_at: string } | undefined;
  const me = (await db.prepare("SELECT phone FROM users WHERE id = ?").get(session.user.id)) as { phone: string | null } | undefined;
  const now = new Date().toISOString();
  const body = helpBody({
    driver: session.user.display_name,
    phone: me?.phone ?? null,
    kind,
    pending,
    positionAgeMs: pos ? Date.now() - Date.parse(pos.recorded_at) : null,
  });
  const watchers = (await db
    .prepare("SELECT id FROM users WHERE organization_id = ? AND active = 1 AND (role = 'owner' OR (role = 'group_manager' AND group_id IS NOT DISTINCT FROM ?))")
    .all(orgId, run.group_id)) as { id: number }[];
  for (const w of watchers) {
    await db
      .prepare(
        `INSERT INTO notifications (organization_id, user_id, type_code, title_fa, body_fa, entity_type, entity_id, group_key, priority, created_at)
         VALUES (?, ?, 'driver.help', 'راننده کمک می‌خواهد', ?, 'delivery_run', ?, ?, 'CRITICAL', ?)`
      )
      .run(orgId, w.id, body, run.id, `driver.help:${session.user.id}:${now}`, now);
  }
  // The rules sweep has no timer of its own yet, and this one must not wait for it.
  if (watchers.length > 0) await flushNotifications(orgId).catch(() => undefined);
  return watchers.length;
}
