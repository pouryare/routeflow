import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";
import { canReleaseHold, holdProblem } from "@/lib/customerHolds";

export interface HoldRow {
  id: number;
  customer_id: number;
  reason: string;
  expires_on: string;
  placed_by: number;
  placed_by_name: string | null;
  placed_at: string;
}

/** The hold in force on this customer today, or null. */
export async function activeHold(orgId: number, customerId: number, today = tehranTodayIso()): Promise<HoldRow | null> {
  const r = (await getDb()
    .prepare(
      `SELECT h.id, h.customer_id, h.reason, h.expires_on, h.placed_by, u.display_name AS placed_by_name, h.placed_at
         FROM customer_holds h LEFT JOIN users u ON u.id = h.placed_by
        WHERE h.organization_id = ? AND h.customer_id = ? AND h.released_at IS NULL AND h.expires_on >= ? ORDER BY h.id DESC LIMIT 1`,
    )
    .get(orgId, customerId, today)) as HoldRow | undefined;
  return r ? { ...r, id: Number(r.id), customer_id: Number(r.customer_id), placed_by: Number(r.placed_by) } : null;
}

/** Places a hold; returns the problem in words, or null once saved. One hold at a time: a second replaces nothing, it is refused. */
export async function placeHold(orgId: number, customerId: number, by: number, input: { reason: string; expiresOn: string }): Promise<string | null> {
  const today = tehranTodayIso();
  const reason = input.reason.trim();
  const problem = holdProblem({ reason, expiresOn: input.expiresOn, today });
  if (problem) return problem;
  const db = getDb();
  if (!(await db.prepare("SELECT 1 FROM customers WHERE id = ? AND organization_id = ?").get(customerId, orgId))) return "مشتری پیدا نشد";
  if (await activeHold(orgId, customerId, today)) return "این مشتری هم‌اکنون نگه داشته شده است";
  await db
    .prepare("INSERT INTO customer_holds (organization_id, customer_id, reason, expires_on, placed_by, placed_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(orgId, customerId, reason, input.expiresOn, by, new Date().toISOString());
  return null;
}

/** Lifts the hold in force; returns the problem in words, or null once released. */
export async function releaseHold(orgId: number, customerId: number, who: { userId: number; manager: boolean }): Promise<string | null> {
  const h = await activeHold(orgId, customerId);
  if (!h) return "نگه‌داشتنی در کار نیست";
  if (!canReleaseHold(who, h)) return "فقط کسی که نگه داشته یا مدیر می‌تواند آزاد کند";
  await getDb().prepare("UPDATE customer_holds SET released_by = ?, released_at = ? WHERE id = ? AND organization_id = ?").run(who.userId, new Date().toISOString(), h.id, orgId);
  return null;
}
