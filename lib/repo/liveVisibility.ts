/* Whether one person may see one record, for the live stream (issue #58, idea L1). Each check is
 * the record's own list filter applied to a single id, so a live event never reaches someone the
 * list itself would not show it to. */
import { getDb } from "@/lib/db";

type Fragment = { sql: string; params: (string | number)[] };

/** One order, through the orders list's own filter (session.orderFilter, alias o). */
export async function orderPasses(orderId: number, filter: Fragment): Promise<boolean> {
  const row = await getDb().prepare(`SELECT 1 AS ok FROM orders o WHERE o.id = ?${filter.sql}`).get(orderId, ...filter.params);
  return !!row;
}

/** One run: a van role sees only the runs they drive; everyone else through the runs list's filter
 *  (groupFilter on dr.group_id), always inside their own company. */
export async function runPasses(runId: number, organizationId: number, rule: { driverId: number } | Fragment): Promise<boolean> {
  const db = getDb();
  const row =
    "driverId" in rule
      ? await db.prepare("SELECT 1 AS ok FROM delivery_runs dr WHERE dr.id = ? AND dr.organization_id = ? AND dr.driver_user_id = ?").get(runId, organizationId, rule.driverId)
      : await db.prepare(`SELECT 1 AS ok FROM delivery_runs dr WHERE dr.id = ? AND dr.organization_id = ?${rule.sql}`).get(runId, organizationId, ...rule.params);
  return !!row;
}
