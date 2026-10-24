/** Delivery runs as the planners (owner, group manager) list and create them. */

import { getDb } from "@/lib/db";
import { remainingByRun, stopCountsByRun } from "@/lib/repo/runStops";
import { addStop, createRun } from "@/lib/delivery";
import { orgClause } from "@/lib/orgScope";

type Scope = { sql: string; params: (string | number)[] };

export async function listRuns(scope: Scope, organizationId: number | null) {
  const db = getDb();
  const org = orgClause("dr.organization_id", organizationId);
  const rows = await db
    .prepare(
      `SELECT dr.id, dr.run_date, dr.status, u.display_name AS driver_name,
              COALESCE(SUM(ds.collected_toman), 0) AS collected_toman
         FROM delivery_runs dr
         JOIN users u ON u.id = dr.driver_user_id
         LEFT JOIN delivery_stops ds ON ds.run_id = dr.id
        WHERE 1 = 1${scope.sql}${org.sql}
        GROUP BY dr.id, u.id
        ORDER BY dr.run_date DESC, dr.id DESC
        LIMIT 60`
    )
    .all(...scope.params, ...org.params) as unknown as { id: number; collected_toman: number }[];

  /* stop_count and remaining come from runStops rather than the join above, so the load and the
   * unload are counted: they are stops, and this list is what somebody plans the day from. */
  const ids = rows.map((r) => r.id);
  const counts = await stopCountsByRun(db, ids);
  const remaining = await remainingByRun(db, ids);
  return rows.map((r) => ({ ...r, stop_count: counts.get(r.id) ?? 0, remaining: remaining.get(r.id) ?? 0 }));
}

/** An active driver of this company who holds the delivery role (the SET, so a driver whose primary
 *  role is something else still counts), with the group the caller's reach check needs. */
export async function findDriverInOrg(userId: number, organizationId: number | null): Promise<{ id: number; group_id: number | null } | undefined> {
  const db = getDb();
  const org = orgClause("organization_id", organizationId);
  const driver = await db.prepare(`SELECT id, group_id FROM users WHERE id = ? AND active = 1${org.sql}`).get(userId, ...org.params) as
    | { id: number; group_id: number | null }
    | undefined;
  if (!driver) return undefined;
  const canDrive = await db.prepare("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'delivery_driver'").get(userId);
  return canDrive ? driver : undefined;
}

export async function newRun(input: Parameters<typeof createRun>[1]): Promise<number> {
  return await createRun(getDb(), input);
}

export async function runGroup(runId: number, organizationId: number | null): Promise<{ id: number; group_id: number | null } | undefined> {
  const org = orgClause("organization_id", organizationId);
  return await getDb().prepare(`SELECT id, group_id FROM delivery_runs WHERE id = ?${org.sql}`).get(runId, ...org.params) as
    | { id: number; group_id: number | null }
    | undefined;
}

export async function orderForRun(orderId: number, organizationId: number | null): Promise<{ id: number; group_id: number | null; status: string } | undefined> {
  const org = orgClause("organization_id", organizationId);
  return await getDb().prepare(`SELECT id, group_id, status FROM orders WHERE id = ?${org.sql}`).get(orderId, ...org.params) as
    | { id: number; group_id: number | null; status: string }
    | undefined;
}

export async function addOrderToRun(runId: number, orderId: number, sortOrder: number): Promise<number> {
  return await addStop(getDb(), runId, orderId, sortOrder);
}
