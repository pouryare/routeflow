import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { statementFor } from "@/lib/commissionLedger";
import { toJalali, jalaliToIsoDate } from "@/lib/jalali";
import type { Role } from "@/lib/roles";

/** The roles credited with orders. A field_rep's briefing is the van card, not this page. */
const SELLER_ROLES: Role[] = ["phone_sales"];

/** The current Jalali month up to today, the same window the commission page opens on. */
export function jalaliMonthSoFar(nowIso: string): { from: string; to: string } {
  const t = toJalali(nowIso)!;
  return { from: jalaliToIsoDate(t.jy, t.jm, 1), to: jalaliToIsoDate(t.jy, t.jm, t.jd) };
}

export interface EarningsSoFar {
  kg: number;
  orders: number;
  accrued_toman: number;
  paid_toman: number;
  owed_toman: number;
  from: string;
}

/** F19: «پورسانت این ماه تا امروز» for the person selling. Read-only, from the same
 *  statementFor the commission page and payroll read, so the card cannot disagree with them.
 *  Only for the selling roles, and only their own statement; null when the month has nothing
 *  credited and nothing is owed, so the briefing does not open on a row of zeros. */
export async function earningsSoFar(session: Session, nowIso = new Date().toISOString()): Promise<EarningsSoFar | null> {
  if (!SELLER_ROLES.includes(session.role)) return null;
  const period = jalaliMonthSoFar(nowIso);
  const s = await statementFor(getDb(), session.user.id, period);
  if (s.orders.length === 0 && s.owed_toman === 0) return null;
  return {
    kg: s.kg,
    orders: s.orders.length,
    accrued_toman: s.accrued_toman,
    paid_toman: s.paid_toman,
    owed_toman: s.owed_toman,
    from: period.from,
  };
}
