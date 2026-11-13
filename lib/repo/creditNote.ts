/* B1: a manager credits a customer for goods returned after delivery. It is a CREDIT_NOTE payment (lib/repo/payments.ts):
 * it settles the oldest unpaid orders like any receipt and posts Dr 4102 sales returns / Cr receivables, but is not
 * counted as money collected. Voiding it works as for any payment. It moves no stock: restock, quarantine or write-off
 * the goods on the stock page (F80). */
import type { Session } from "@/lib/session";
import { tehranTodayIso } from "@/lib/jalali";
import { isOwner } from "@/lib/roles";
import { getDb } from "@/lib/db";
import { CREDIT_NOTE_REASONS, isCreditNoteReason, mayRefundCash } from "@/lib/creditNote";
import { thresholdsFor } from "@/lib/repo/thresholds";
import { postCashRefund } from "@/lib/repo/ledgerPostings";
import { customerDebt, PaymentError, recordPayment } from "@/lib/repo/payments";

export async function issueCreditNote(s: Session, customerId: number, amount: unknown, reason: unknown): Promise<number> {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) throw new PaymentError("مبلغ را به تومان و بیشتر از صفر وارد کنید");
  if (!isCreditNoteReason(reason)) throw new PaymentError("دلیل برگشت را انتخاب کنید");
  const owed = (await customerDebt(s.organizationId, customerId)).total;
  if (amount > owed) throw new PaymentError("مبلغ از مانده‌ی مشتری بیشتر است");
  const label = CREDIT_NOTE_REASONS.find((r) => r.id === reason)!.label;
  return await recordPayment(s.organizationId, {
    customer_id: customerId,
    amount_toman: amount,
    method: "CREDIT_NOTE",
    received_at: tehranTodayIso(),
    received_by: s.user.id,
    note: `برگشت از فروش: ${label}`,
  });
}

/** B1: the customer already paid, so the goods that came back are paid back in cash from the office box. A manager may do it
 *  up to the owner's limit; a bigger amount is the owner's. One entry in the books, one line on the customer's timeline. */
export async function refundInCash(s: Session, customerId: number, amount: unknown, reason: unknown): Promise<number> {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) throw new PaymentError("مبلغ را به تومان و بیشتر از صفر وارد کنید");
  if (!isCreditNoteReason(reason)) throw new PaymentError("دلیل برگشت را انتخاب کنید");
  const limit = (await thresholdsFor(s.organizationId)).refund_limit_toman;
  if (!mayRefundCash(isOwner(s.role), amount, limit)) throw new PaymentError("پرداخت نقدی این مبلغ فقط با مالک است؛ سقف شما کمتر است");
  const label = CREDIT_NOTE_REASONS.find((r) => r.id === reason)!.label;
  const db = getDb();
  const at = new Date().toISOString();
  return await db.tx(async () => {
    const id = Number(
      (await db.prepare("INSERT INTO cash_refunds (organization_id, customer_id, amount_toman, reason, paid_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(s.organizationId, customerId, amount, reason, s.user.id, at)).lastInsertRowid
    );
    const journal = await postCashRefund(db, { organizationId: s.organizationId, refundId: id, customerId, amountToman: amount, paidAt: tehranTodayIso(), paidBy: s.user.id, memo: `پرداخت نقدی بابت برگشت: ${label}` });
    await db.prepare("UPDATE cash_refunds SET journal_id = ? WHERE id = ?").run(journal, id);
    await db
      .prepare("INSERT INTO activities (organization_id, customer_id, user_id, type, note, occurred_at, created_at) VALUES (?, ?, ?, 'note', ?, ?, ?)")
      .run(s.organizationId, customerId, s.user.id, `پرداخت نقدی بابت برگشت (${label}): ${amount.toLocaleString("fa-IR")} تومان`, at, at);
    return id;
  });
}
