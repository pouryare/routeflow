/** The coverage report's two big reads, as functions of the session. */

import { getDb, type Customer, type District } from "@/lib/db";
import { readFacilities } from "@/lib/facilities";
import { groupFilter, groupFilterWithShared, type Session } from "@/lib/session";

/** Districts are shared reference data with no organization_id, so only the group guard applies to
 *  them; customers carry the column and keep the full guard. */
export async function reportRows(session: Session): Promise<{ districts: District[]; customers: Customer[] }> {
  const db = getDb();
  const fd = await groupFilter(session, "group_id", { shared: true });
  const f = await groupFilter(session);
  const districts = await db.prepare(`SELECT * FROM districts WHERE 1 = 1${fd.sql}`).all(...fd.params) as unknown as District[];
  const customers = await db
    .prepare(`SELECT * FROM customers WHERE 1 = 1${f.sql} ORDER BY business_name`)
    .all(...f.params) as unknown as Customer[];
  return { districts, customers };
}

/** Sites the caller may see: their group's plus the company-wide ones. */
export async function reportFacilities(session: Session) {
  return await readFacilities(getDb(), await groupFilterWithShared(session));
}
