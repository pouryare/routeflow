import { getDb } from "@/lib/db";
import { deliveredOrdersForCustomer, recomputeOrderPaymentTxn, PaymentError } from "@/lib/repo/payments";

/** F63: money a customer paid that is not yet on any order (the on-account slices of live payments). */
export async function onAccountCredit(orgId: number, customerId: number): Promise<number> {
  const r = (await getDb()
    .prepare(
      `SELECT COALESCE(SUM(a.amount_toman), 0) AS s FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
        WHERE a.order_id IS NULL AND p.customer_id = ? AND p.organization_id = ? AND p.voided_at IS NULL`,
    )
    .get(customerId, orgId)) as { s: number };
  return Number(r.s);
}

/** Moves on-account credit (oldest first) onto one delivered order, up to what the order still owes. Returns the amount moved.
 *  Re-pointing a slice moves no money (the receipt already credited the customer's account), so no journal is posted. */
export async function applyCreditToOrder(orgId: number, orderId: number): Promise<number> {
  const db = getDb();
  const order = (await db.prepare("SELECT id, customer_id FROM orders WHERE id = ? AND organization_id = ?").get(orderId, orgId)) as { id: number; customer_id: number } | undefined;
  if (!order) throw new PaymentError("سفارش پیدا نشد");
  const row = (await deliveredOrdersForCustomer(db, orgId, order.customer_id)).find((o) => o.id === orderId);
  if (!row) throw new PaymentError("فقط سفارش تحویل‌شده بدهی دارد");
  let need = Math.max(0, row.total_toman - row.paid_toman);
  if (need === 0) throw new PaymentError("این سفارش بدهی ندارد");
  const slices = (await db
    .prepare(
      `SELECT a.id, a.payment_id, a.amount_toman, a.created_at FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
        WHERE a.order_id IS NULL AND p.customer_id = ? AND p.organization_id = ? AND p.voided_at IS NULL ORDER BY a.id`,
    )
    .all(order.customer_id, orgId)) as unknown as { id: number; payment_id: number; amount_toman: number; created_at: string }[];
  if (slices.length === 0) throw new PaymentError("مشتری اعتبار روی حساب ندارد");
  let applied = 0;
  await db.tx(async () => {
    for (const s of slices) {
      if (need <= 0) break;
      const take = Math.min(need, Number(s.amount_toman));
      if (take === Number(s.amount_toman)) await db.prepare("UPDATE payment_allocations SET order_id = ? WHERE id = ?").run(orderId, s.id);
      else {
        await db.prepare("UPDATE payment_allocations SET amount_toman = amount_toman - ? WHERE id = ?").run(take, s.id);
        await db.prepare("INSERT INTO payment_allocations (payment_id, order_id, amount_toman, created_at) VALUES (?, ?, ?, ?)").run(s.payment_id, orderId, take, s.created_at);
      }
      need -= take;
      applied += take;
    }
    await recomputeOrderPaymentTxn(db, orgId, orderId);
  });
  return applied;
}

/** The customer an order belongs to, or undefined when the order is not in this company. */
export async function orderCustomer(orgId: number, orderId: number): Promise<{ customer_id: number } | undefined> {
  return (await getDb().prepare("SELECT customer_id FROM orders WHERE id = ? AND organization_id = ?").get(orderId, orgId)) as { customer_id: number } | undefined;
}
