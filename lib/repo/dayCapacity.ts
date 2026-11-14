import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";

const OPEN = "('DRAFT', 'PENDING_REVIEW', 'PENDING_CREDIT', 'ON_HOLD', 'CONFIRMED', 'PLANNED', 'READY', 'OUT_FOR_DELIVERY')";

/** FB35: how many open orders already name this delivery day. `exceptOrderId` leaves out the order being saved. */
export async function ordersOnDay(db: Db, orgId: number, day: string, exceptOrderId = 0): Promise<number> {
  const r = (await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE organization_id = ? AND requested_day = ? AND id <> ? AND status IN ${OPEN}`).get(orgId, day, exceptOrderId)) as { n: number };
  return Number(r.n);
}

export const dayTaken = (orgId: number, day: string) => ordersOnDay(getDb(), orgId, day);
