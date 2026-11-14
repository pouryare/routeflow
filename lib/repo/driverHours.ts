import { getDb } from "@/lib/db";
import { groupFilter, type Session } from "@/lib/session";
import { driverDays, type DriverDay, type HoursRun } from "@/lib/driverHours";

/** Driver-days for the last `days` days (run dates, Tehran), in the manager's own groups. */
export async function driverHoursFor(session: Session, fromDate: string): Promise<DriverDay[]> {
  const scope = await groupFilter(session, "dr.group_id");
  const rows = (await getDb()
    .prepare(
      `SELECT dr.driver_user_id, u.display_name AS driver_name, dr.run_date, dr.status, dr.started_at, dr.finished_at
         FROM delivery_runs dr JOIN users u ON u.id = dr.driver_user_id
        WHERE dr.organization_id = ? AND dr.run_date >= ?${scope.sql}`
    )
    .all(session.organizationId, fromDate, ...scope.params)) as unknown as HoursRun[];
  return driverDays(rows.map((r) => ({ ...r, driver_user_id: Number(r.driver_user_id) })));
}
