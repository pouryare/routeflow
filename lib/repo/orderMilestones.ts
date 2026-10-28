import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";

/** True when `userId` has created exactly one order since Tehran midnight, i.e. the one just
 *  placed is their first of the day. Drives the confetti on the order form.
 *
 *  shortcut: Tehran midnight is taken as 00:00 at +03:30 (Iran has no daylight saving now);
 *  revisit if that changes. */
export async function isFirstOrderToday(userId: number, organizationId: number, now = new Date()): Promise<boolean> {
  const since = new Date(`${tehranTodayIso(now)}T00:00:00+03:30`).toISOString();
  const row = (await getDb()
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE created_by = ? AND organization_id = ? AND created_at >= ?")
    .get(userId, organizationId, since)) as { n: number | string };
  return Number(row.n) === 1;
}
