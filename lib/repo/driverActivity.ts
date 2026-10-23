import type { Db } from "@/lib/database/client";
import { groupFilter, type Session } from "@/lib/session";

/** Delivered stops per driver, for the activity streak on /sales/runs (item 14).
 *
 *  Scoped exactly as the rest of that page: drivers through `groupFilter(session)` on the
 *  users table, deliveries through `groupFilter(session, "dr.group_id")` on the runs they
 *  belong to (an owner's filter lands on `dr.organization_id`). A manager sees their own
 *  group's drivers and nothing of another group's day.
 *
 *  Every active driver in scope is returned, including one with no deliveries at all: an
 *  empty grid next to a name is information, a missing row is a mystery. */
export type DriverActivity = { id: number; name: string; dates: string[] };

export async function readDriverActivity(
  db: Db,
  session: Session,
  today: string,
  days = 84,
): Promise<DriverActivity[]> {
  const users = await groupFilter(session, "u.group_id");
  /* People who HOLD a van role, whoever their primary. The old `role = 'driver'` literal
     matched nobody the moment 'driver' stopped being a role, and this query fails SILENTLY:
     an empty list, no error, a board reporting that every driver is idle. Widening the
     literal fixed that but not this: a driver whose primary is something else is still
     absent, and they are exactly the person whose activity matters. */
  const people = await db
    .prepare(
      `SELECT u.id, u.display_name AS name FROM users u
        JOIN user_roles _r ON _r.user_id = u.id AND _r.role IN ('delivery_driver', 'field_rep')
        WHERE u.active = 1${users.sql}
        ORDER BY u.display_name`,
    )
    .all(...users.params) as unknown as { id: number; name: string }[];
  if (people.length === 0) return [];

  const since = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const runs = await groupFilter(session, "dr.group_id");
  const rows = await db
    .prepare(
      `SELECT dr.driver_user_id AS id, substr(ds.delivered_at, 1, 10) AS d
         FROM delivery_stops ds
         JOIN delivery_runs dr ON dr.id = ds.run_id
        WHERE ds.status = 'delivered' AND ds.delivered_at IS NOT NULL
          AND substr(ds.delivered_at, 1, 10) >= ?${runs.sql}`,
    )
    .all(since, ...runs.params) as unknown as { id: number; d: string }[];

  const byDriver = new Map<number, string[]>();
  for (const r of rows) {
    const list = byDriver.get(r.id) ?? [];
    list.push(r.d);
    byDriver.set(r.id, list);
  }
  return people.map((p) => ({ id: p.id, name: p.name, dates: byDriver.get(p.id) ?? [] }));
}
