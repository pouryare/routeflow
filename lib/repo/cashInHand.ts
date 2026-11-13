import { getDb } from "@/lib/db";

export class HandoverError extends Error {}

export interface Holding { userId: number; name: string; amount: number; since: string; through: string; count: number }

const HOLDERS = "('field_rep','delivery_driver','phone_sales')";

/** D1: the cash each field person collected since the office last counted them (voided receipts left out). */
export async function holdings(organizationId: number): Promise<Holding[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT p.received_by AS user_id, u.display_name AS name, SUM(p.amount_toman) AS amount, MIN(p.received_at) AS since, MAX(p.received_at) AS through, COUNT(*) AS n
         FROM payments p JOIN users u ON u.id = p.received_by
        WHERE p.organization_id = ? AND p.method = 'CASH' AND p.voided_at IS NULL AND u.role IN ${HOLDERS}
          AND p.received_at > COALESCE((SELECT MAX(h.through_at) FROM cash_handovers h WHERE h.organization_id = p.organization_id AND h.holder_id = p.received_by), '')
        GROUP BY p.received_by, u.display_name HAVING SUM(p.amount_toman) > 0 ORDER BY MIN(p.received_at)`
    )
    .all(organizationId)) as unknown as { user_id: number; name: string; amount: number; since: string; through: string; n: number }[];
  return rows.map((r) => ({ userId: Number(r.user_id), name: r.name, amount: Number(r.amount), since: r.since, through: r.through, count: Number(r.n) }));
}

/** The office confirms the count of one person's cash up to `through`. A different amount needs a reason. */
export async function confirmHandover(organizationId: number, holderId: number, through: string, counted: number, reason: string, by: number): Promise<void> {
  const h = (await holdings(organizationId)).find((x) => x.userId === holderId);
  if (!h) throw new HandoverError("پولی در دست این نفر ثبت نشده است");
  const db = getDb();
  const row = (await db
    .prepare(
      `SELECT COALESCE(SUM(amount_toman), 0) AS s FROM payments
        WHERE organization_id = ? AND received_by = ? AND method = 'CASH' AND voided_at IS NULL AND received_at <= ?
          AND received_at > COALESCE((SELECT MAX(through_at) FROM cash_handovers WHERE organization_id = ? AND holder_id = ?), '')`
    )
    .get(organizationId, holderId, through, organizationId, holderId)) as { s: number };
  const expected = Number(row.s);
  if (expected <= 0) throw new HandoverError("پولی در دست این نفر ثبت نشده است");
  if (counted !== expected && !reason.trim()) throw new HandoverError("برای اختلاف، دلیل را بنویسید");
  await db
    .prepare("INSERT INTO cash_handovers (organization_id, holder_id, through_at, expected_toman, counted_toman, reason, confirmed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(organizationId, holderId, through, expected, counted, counted === expected ? null : reason.trim().slice(0, 300), by, new Date().toISOString());
}
