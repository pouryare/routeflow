/** What the schedule page (runs view and month plan) reads. Every query carries the caller's scope:
 *  runs through `groupFilter` (which names the company for an owner), visit plans through the entity
 *  they are about (`entityGroupFilter`), so one company never sees another's stops or visits. */

import { getDb, plain } from "@/lib/db";
import { VAN_ROLES } from "@/lib/roles";
import { entityGroupFilter, groupFilter, orderFilter, type Session } from "@/lib/session";
import { readPlannableOrders } from "@/lib/repo/dayPlan";
import { readRunDrafts } from "@/lib/repo/runDrafts";

export interface ScheduleRun {
  id: number;
  run_date: string;
  status: string;
  driver_user_id: number;
  group_id: number | null;
  driver_name: string;
  collected_toman: number;
}

export async function runsViewData(session: Session) {
  const db = getDb();
  const userScope = await groupFilter(session);

  // The van-role SET, not the legacy `role = 'driver'` that matched nobody after the rename.
  const vanRoleList = VAN_ROLES.map((r) => `'${r}'`).join(", ");
  const drivers = plain(
    await db
      .prepare(
        `SELECT id, display_name FROM users
          WHERE role IN (${vanRoleList}) AND active = 1${userScope.sql}
          ORDER BY display_name`,
      )
      .all(...userScope.params),
  ) as unknown as { id: number; display_name: string }[];

  // stop_count comes from runStops on the client side so the load and the unload are counted.
  const runScope = await groupFilter(session, "dr.group_id");
  const runs = plain(
    await db
      .prepare(
        `SELECT dr.id, dr.run_date, dr.status, dr.driver_user_id, dr.group_id,
                u.display_name AS driver_name,
                COALESCE(SUM(ds.collected_toman), 0) AS collected_toman
           FROM delivery_runs dr
           JOIN users u ON u.id = dr.driver_user_id
           LEFT JOIN delivery_stops ds ON ds.run_id = dr.id
          WHERE 1 = 1${runScope.sql}
          GROUP BY dr.id
          ORDER BY dr.run_date DESC, dr.id DESC
          LIMIT 30`,
      )
      .all(...runScope.params),
  ) as unknown as ScheduleRun[];

  // Kilograms per run, from the frozen order_lines: a van fills by weight, not by money.
  const kgRows = plain(
    await db
      .prepare(
        `SELECT ds.run_id,
                COALESCE(SUM(ol.packs_ordered * (p.kg_per_base_unit * ol.qty_per_pack)), 0) AS kg
           FROM delivery_stops ds
           JOIN delivery_runs dr ON dr.id = ds.run_id
           JOIN orders o ON o.id = ds.order_id
           JOIN order_lines ol ON ol.order_id = o.id
           JOIN products p ON p.id = ol.product_id
          WHERE 1 = 1${runScope.sql}
          GROUP BY ds.run_id`,
      )
      .all(...runScope.params),
  ) as unknown as { run_id: number; kg: number }[];

  return {
    drivers,
    runs,
    kgByRun: new Map(kgRows.map((r) => [r.run_id, Number(r.kg)])),
    // Confirmed orders on no run: read once so the map's pins and the lanes' cards are the same array.
    plannable: await readPlannableOrders(db, orderFilter(session)),
    // A draft is private to one user: a server-side fact, never something the client filters.
    drafts: await readRunDrafts(db, session.organizationId, session.user.id),
  };
}

export async function planViewData(session: Session, from: string, to: string) {
  const db = getDb();
  // Qualified: the runs query joins delivery_runs to users, and for an owner this fragment filters on
  // organization_id, a column both tables carry.
  const scope = await groupFilter(session, "r.group_id");
  const runs = plain(
    await db
      .prepare(
        `SELECT r.id, r.run_date, r.status,
                COALESCE(u.display_name, 'بدون راننده') AS driver,
                (SELECT COUNT(*) FROM delivery_stops s WHERE s.run_id = r.id) AS stops
           FROM delivery_runs r
           LEFT JOIN users u ON u.id = r.driver_user_id
          WHERE r.run_date >= ? AND r.run_date <= ?${scope.sql}
          ORDER BY r.run_date, r.id`
      )
      .all(from, to, ...scope.params)
  ) as unknown as { id: number; run_date: string; status: string; driver: string; stops: number }[];

  /* Planned visits, with what each is FOR, named by the shop rather than an id. Scoped through the
     entity each visit is about: this read had no scope at all, so one company's calendar listed
     every other company's visits and customer names. */
  const entity = await entityGroupFilter(session, "v");
  const visits = plain(
    await db
      .prepare(
        `SELECT v.id, v.planned_date, v.status, v.purpose, v.entity_type, v.entity_id,
                COALESCE(c.business_name, d.name, 'بدون نام') AS who,
                c.city AS where_
           FROM visit_plans v${entity.joins}
           LEFT JOIN customers c ON v.entity_type = 'customer' AND c.id = v.entity_id
           LEFT JOIN districts d ON v.entity_type = 'district' AND d.id = v.entity_id
          WHERE v.planned_date >= ? AND v.planned_date <= ?${entity.sql}
          ORDER BY v.planned_date, v.sort_order, v.id`
      )
      .all(from, to, ...entity.params)
  ) as unknown as {
    id: number;
    planned_date: string;
    status: string;
    purpose: string | null;
    who: string;
    where_: string | null;
  }[];

  return { runs, visits };
}
