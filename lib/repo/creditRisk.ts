import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";
import { creditRisk, type RiskResult } from "@/lib/creditRisk";
import { customerDebtsForOrgOnce } from "@/lib/repo/payments";

/** F46: the score of each given customer of this company, by customer id. Advisory: shown, never enforced. */
export async function riskFor(orgId: number, customerIds: number[]): Promise<Map<number, RiskResult>> {
  const out = new Map<number, RiskResult>();
  if (customerIds.length === 0) return out;
  const db = getDb();
  const today = tehranTodayIso();
  const ids = customerIds.map(() => "?").join(", ");
  const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString();
  const overdue = (await db
    .prepare(
      `SELECT customer_id, MAX(?::date - due_date::date) AS days FROM orders
        WHERE organization_id = ? AND customer_id IN (${ids}) AND due_date < ? AND payment_status <> 'paid'
          AND status IN ('DELIVERED', 'PARTIALLY_DELIVERED', 'CLOSED') GROUP BY customer_id`
    )
    .all(today, orgId, ...customerIds, today)) as unknown as { customer_id: number; days: number }[];
  const bounced = (await db
    .prepare(`SELECT customer_id, COUNT(*) AS n FROM cheques WHERE organization_id = ? AND customer_id IN (${ids}) AND status = 'bounced' AND bounced_at >= ? GROUP BY customer_id`)
    .all(orgId, ...customerIds, day(180))) as unknown as { customer_id: number; n: number }[];
  const broken = (await db
    .prepare(
      `SELECT p.customer_id, COUNT(*) AS n FROM payment_promises p
        WHERE p.organization_id = ? AND p.customer_id IN (${ids}) AND p.cancelled_at IS NULL AND p.promised_date < ? AND p.promised_date >= ?
          AND COALESCE((SELECT SUM(pm.amount_toman) FROM payments pm WHERE pm.organization_id = p.organization_id AND pm.customer_id = p.customer_id
                         AND pm.voided_at IS NULL AND pm.received_at >= p.created_at), 0) < p.amount_toman GROUP BY p.customer_id`
    )
    .all(orgId, ...customerIds, today, day(90).slice(0, 10))) as unknown as { customer_id: number; n: number }[];
  const limits = (await db
    .prepare(`SELECT id, credit_limit_toman FROM customers WHERE organization_id = ? AND id IN (${ids})`)
    .all(orgId, ...customerIds)) as unknown as { id: number; credit_limit_toman: number | null }[];
  const debts = await customerDebtsForOrgOnce(orgId);
  const by = <T extends { customer_id: number }>(rows: T[]) => new Map(rows.map((r) => [Number(r.customer_id), r]));
  const o = by(overdue), b = by(bounced), p = by(broken);
  for (const c of limits) {
    out.set(
      Number(c.id),
      creditRisk({
        overdueDays: Number(o.get(Number(c.id))?.days ?? 0),
        bouncedCheques: Number(b.get(Number(c.id))?.n ?? 0),
        balanceToman: Number(debts.get(Number(c.id))?.total ?? 0),
        limitToman: c.credit_limit_toman === null ? null : Number(c.credit_limit_toman),
        brokenPromises: Number(p.get(Number(c.id))?.n ?? 0),
      })
    );
  }
  return out;
}
