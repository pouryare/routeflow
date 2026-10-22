/** The coverage report's two big reads, as functions of the session. */

import { getDb, type Customer, type District } from "@/lib/db";
import { readFacilities } from "@/lib/facilities";
import { groupFilter, groupFilterWithShared, type Session } from "@/lib/session";

/** Districts are shared reference data with no organization_id, so only the group guard applies to
 *  them; customers carry the column and keep the full guard. */
export function reportRows(session: Session): { districts: District[]; customers: Customer[] } {
  const db = getDb();
  const fd = groupFilter(session, "group_id", { shared: true });
  const f = groupFilter(session);
  const districts = db.prepare(`SELECT * FROM districts WHERE 1 = 1${fd.sql}`).all(...fd.params) as unknown as District[];
  const customers = db
    .prepare(`SELECT * FROM customers WHERE 1 = 1${f.sql} ORDER BY business_name`)
    .all(...f.params) as unknown as Customer[];
  return { districts, customers };
}

/** Sites the caller may see: their group's plus the company-wide ones. */
export function reportFacilities(session: Session) {
  return readFacilities(getDb(), groupFilterWithShared(session));
}
