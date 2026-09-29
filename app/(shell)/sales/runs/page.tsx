import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, groupFilter, orderFilter } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { readOrders } from "@/lib/orders";
import RunPlanner from "@/components/sales/RunPlanner";
import AssignmentBoard from "@/components/sales/AssignmentBoard";
import RunTimeline, { TimelineStop } from "@/components/sales/RunTimeline";
import DriverStreaks from "@/components/sales/DriverStreaks";
import { readDriverActivity } from "@/lib/repo/driverActivity";
import { buildStreak } from "@/lib/streak";
import PageHeader from "@/components/meridian/PageHeader";
import { isVanRole, VAN_ROLES } from "@/lib/roles";

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
  if (isVanRole(session.role)) redirect("/driver");
  if (session.role === "phone_sales") redirect("/sales");

  const db = getDb();
  const userScope = groupFilter(session);

  /* The van roles, inlined from the one list that defines them. This read
     `role = 'driver'`, which matched nobody after lib/db.ts renamed that role to
     `delivery_driver` — so the planner's driver dropdown was silently empty, with no
     error anywhere to say so. A gate written against a role NAME fails to match the
     moment the name changes; a gate written against the SET does not.
     tests/van-role-dropdown.test.ts holds both halves: that the SQL is right, and that
     this file is the SQL that runs. */
  const vanRoleList = VAN_ROLES.map((r) => `'${r}'`).join(", ");
  const drivers = plain(
    db
      .prepare(
        `SELECT id, display_name FROM users
          WHERE role IN (${vanRoleList}) AND active = 1${userScope.sql}
          ORDER BY display_name`
      )
      .all(...userScope.params)
  ) as unknown as { id: number; display_name: string }[];

  const runScope = groupFilter(session, "dr.group_id");
  const runs = plain(
    db
      .prepare(
        `SELECT dr.id, dr.run_date, dr.status, dr.driver_user_id, u.display_name AS driver_name,
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
    driver_user_id: number;
    driver_name: string;
    stop_count: number;
    remaining: number;
  }[];

  // Every stop on the runs above, in delivery order, with the order total each carries.
  // One query for all runs rather than one per run: at 30 runs the per-run version is 30
  // round trips to answer a question SQLite can answer once.
  const stopScope = groupFilter(session, "dr.group_id");
  const stopRows = plain(
    db
      .prepare(
        `SELECT ds.id, ds.run_id, ds.status, o.order_no,
                COALESCE(c.business_name, '—') AS customer_name,
                COALESCE(SUM(ol.packs_ordered * ol.unit_price_toman), 0) AS total_toman
           FROM delivery_stops ds
           JOIN delivery_runs dr ON dr.id = ds.run_id
           JOIN orders o ON o.id = ds.order_id
           LEFT JOIN customers c ON c.id = o.customer_id
           LEFT JOIN order_lines ol ON ol.order_id = o.id
          WHERE 1 = 1${stopScope.sql}
          GROUP BY ds.id
          ORDER BY ds.run_id, ds.sort_order, ds.id`
      )
      .all(...stopScope.params)
  ) as unknown as (TimelineStop & { run_id: number })[];

  const stopsByRun = new Map<number, TimelineStop[]>();
  for (const row of stopRows) {
    const { run_id, ...stop } = row;
    if (!stopsByRun.has(run_id)) stopsByRun.set(run_id, []);
    stopsByRun.get(run_id)!.push(stop);
  }

  /* Item 14: who has actually been on the road, as a streak of days. Same group scope as
     the runs above (lib/repo/driverActivity.ts). */
  const today = new Date().toISOString().slice(0, 10);

  // Confirmed orders not already on a run -- the pool a manager is choosing from.
  const scope = orderFilter(session);
  const unassigned = readOrders(db, scope, { status: "CONFIRMED", limit: 200 }).filter((order) => {
    const on = db
      .prepare("SELECT 1 FROM delivery_stops WHERE order_id = ?")
      .get(order.id);
    return on === undefined;
  });

  return (
    <>
    <PageHeader route="/sales/runs" />
    <div className="flex flex-col gap-[var(--space-6)]">
      <RunPlanner drivers={drivers} />
      <AssignmentBoard
        runs={runs}
        orders={unassigned.map((o) => ({
          id: o.id,
          order_no: o.order_no,
          customer_name: o.customer_name,
          total_toman: o.total_toman,
          order_date: o.order_date,
        }))}
      />
      <RunTimeline
        runs={runs
          .filter((r) => r.status !== "done")
          .map((r) => ({ ...r, stops: stopsByRun.get(r.id) ?? [] }))}
      />
      <DriverStreaks
        people={readDriverActivity(db, session, today).map((d) => ({
          id: d.id,
          name: d.name,
          streak: buildStreak(d.dates, today, 12),
        }))}
      />
    </div>    </>
  );
}
