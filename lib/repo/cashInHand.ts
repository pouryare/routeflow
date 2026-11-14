import { getDb } from "@/lib/db";
import { postHandover } from "@/lib/repo/ledgerPostings";

export class HandoverError extends Error {}

export interface Holding { userId: number; name: string; amount: number; since: string; through: string; count: number }

/** D1: the cash each field person collected since the office last counted them (voided receipts left out). */
export async function holdings(organizationId: number): Promise<Holding[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT p.received_by AS user_id, u.display_name AS name, SUM(p.amount_toman) AS amount, MIN(p.received_at) AS since, MAX(p.received_at) AS through, COUNT(*) AS n
         FROM payments p JOIN users u ON u.id = p.received_by
        WHERE p.organization_id = ? AND p.method = 'CASH' AND p.voided_at IS NULL AND p.in_hand = 1
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
        WHERE organization_id = ? AND received_by = ? AND method = 'CASH' AND in_hand = 1 AND voided_at IS NULL AND received_at <= ?
          AND received_at > COALESCE((SELECT MAX(through_at) FROM cash_handovers WHERE organization_id = ? AND holder_id = ?), '')`
    )
    .get(organizationId, holderId, through, organizationId, holderId)) as { s: number };
  const expected = Number(row.s);
  if (expected <= 0) throw new HandoverError("پولی در دست این نفر ثبت نشده است");
  if (counted !== expected && !reason.trim()) throw new HandoverError("برای اختلاف، دلیل را بنویسید");
  const now = new Date().toISOString();
  const why = counted === expected ? null : reason.trim().slice(0, 300);
  await db.tx(async () => {
    const id = Number(
      (await db
        .prepare("INSERT INTO cash_handovers (organization_id, holder_id, through_at, expected_toman, counted_toman, reason, confirmed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(organizationId, holderId, through, expected, counted, why, by, now)).lastInsertRowid
    );
    // The books move the cash from the person's box to the office, and book any gap.
    const journalId = await postHandover(db, { organizationId, handoverId: id, expectedToman: expected, countedToman: counted, postedAt: now, createdBy: by, memo: why });
    await db.prepare("UPDATE cash_handovers SET journal_id = ? WHERE id = ?").run(journalId, id);
  });
}

/** Whether a receipt's cash is still in a person's box: it went into one and the office has not counted past it yet. */
export async function stillInHand(paymentId: number): Promise<boolean> {
  const r = (await getDb()
    .prepare(
      `SELECT 1 AS yes FROM payments p
        WHERE p.id = ? AND p.in_hand = 1
          AND p.received_at > COALESCE((SELECT MAX(h.through_at) FROM cash_handovers h WHERE h.organization_id = p.organization_id AND h.holder_id = p.received_by), '')`
    )
    .get(paymentId)) as { yes: number } | undefined;
  return r !== undefined;
}

export interface CashGap { id: number; name: string; short: number; reason: string | null; at: string }

/** Counts of the last 7 days where the office found less cash than the person was expected to hold. */
export async function recentGaps(organizationId: number): Promise<CashGap[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const rows = (await getDb()
    .prepare(
      `SELECT h.id, u.display_name AS name, h.expected_toman - h.counted_toman AS short, h.reason, h.created_at AS at
         FROM cash_handovers h JOIN users u ON u.id = h.holder_id
        WHERE h.organization_id = ? AND h.counted_toman < h.expected_toman AND h.created_at >= ? ORDER BY h.id DESC`
    )
    .all(organizationId, since)) as unknown as { id: number; name: string; short: number; reason: string | null; at: string }[];
  return rows.map((r) => ({ ...r, id: Number(r.id), short: Number(r.short) }));
}
