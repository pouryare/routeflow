import type { Db } from "@/lib/database/client";
import type { OrderEventRow } from "@/lib/orderEvents";
import type { FunnelRow } from "@/lib/orderFunnel";

/** The two reads behind /sales/journey's modes. Raw SQL lives in lib/repo/
 *  (tests/repo-boundary.test.ts); the decisions made from these rows are pure and live
 *  beside them in lib/orderEvents.ts and lib/orderFunnel.ts.
 *
 *  Visibility: readOrderEvents trusts the caller, exactly as readJourney does, because
 *  the caller hands over an order chosen from its own scoped list. readFunnelRows takes
 *  that same list's scope (`orderFilter(session)`, alias `o`), so the funnel can never
 *  count an order the list would hide. */

export async function readOrderEvents(db: Db, orderId: number): Promise<OrderEventRow[]> {
  return await db
    .prepare(
      `SELECT e.id, e.from_status, e.to_status, e.action, u.display_name AS actor_name,
              e.note, e.created_at AS at
         FROM order_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.order_id = ?
        ORDER BY e.id`,
    )
    .all(orderId) as unknown as OrderEventRow[];
}

/** One row per order in scope: its status now and every status its events name.
 *
 *  Scope is the caller's `orderFilter(session)` (alias `o`), the same one the order list on
 *  the page uses, so the funnel can never count an order the list would hide. */
export async function readFunnelRows(db: Db, scope: { sql: string; params: number[] }): Promise<FunnelRow[]> {
  const rows = await db
    .prepare(
      `SELECT o.status AS status,
              (SELECT group_concat(COALESCE(e.from_status, '') || ',' || e.to_status, ',')
                 FROM order_events e WHERE e.order_id = o.id) AS seen
         FROM orders o
        WHERE 1 = 1${scope.sql}`,
    )
    .all(...scope.params) as unknown as { status: string; seen: string | null }[];
  return rows.map((r) => ({ status: r.status, seen: (r.seen ?? "").split(",").filter(Boolean) }));
}
