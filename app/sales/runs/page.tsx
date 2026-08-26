import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, groupFilter, orderFilter } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { readOrders } from "@/lib/orders";
import RunPlanner from "@/components/sales/RunPlanner";

export const dynamic = "force-dynamic";

/** Planning the van's day: which confirmed orders go on whose run.
 *
 *  Only confirmed orders are offered. A draft is a list somebody is still editing, and
 *  loading a van from one means the quantities can change after it has left the depot.
 */
export default async function RunsPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");
  if (session.role === "salesperson") redirect("/sales");

  const db = getDb();
  const userScope = groupFilter(session);

  const drivers = plain(
    db
      .prepare(
        `SELECT id, display_name FROM users
          WHERE role = 'driver' AND active = 1${userScope.sql}
          ORDER BY display_name`
      )
      .all(...userScope.params)
  ) as unknown as { id: number; display_name: string }[];

  const runScope = groupFilter(session, "dr.group_id");
  const runs = plain(
    db
      .prepare(
        `SELECT dr.id, dr.run_date, dr.status, u.display_name AS driver_name,
                COUNT(ds.id) AS stop_count,
                COALESCE(SUM(CASE WHEN ds.status = 'pending' THEN 1 ELSE 0 END), 0) AS remaining
           FROM delivery_runs dr
           JOIN users u ON u.id = dr.driver_user_id
           LEFT JOIN delivery_stops ds ON ds.run_id = dr.id
          WHERE 1 = 1${runScope.sql}
          GROUP BY dr.id
          ORDER BY dr.run_date DESC, dr.id DESC
          LIMIT 30`
      )
      .all(...runScope.params)
  ) as unknown as {
    id: number;
    run_date: string;
    status: string;
    driver_name: string;
    stop_count: number;
    remaining: number;
  }[];

  // Confirmed orders not already on a run -- the pool a manager is choosing from.
  const scope = orderFilter(session);
  const unassigned = readOrders(db, scope, { status: "confirmed", limit: 200 }).filter((order) => {
    const on = db
      .prepare("SELECT 1 FROM delivery_stops WHERE order_id = ?")
      .get(order.id);
    return on === undefined;
  });

  return (
    <RunPlanner
      drivers={drivers}
      runs={runs}
      orders={unassigned.map((o) => ({
        id: o.id,
        order_no: o.order_no,
        customer_name: o.customer_name,
        total_toman: o.total_toman,
        order_date: o.order_date,
      }))}
    />
  );
}
