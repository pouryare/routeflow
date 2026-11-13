/* B1: a manager credits a customer for goods returned after delivery. It is a CREDIT_NOTE payment (lib/repo/payments.ts):
 * it settles the oldest unpaid orders like any receipt and posts Dr 4102 sales returns / Cr receivables, but is not
 * counted as money collected. Voiding it works as for any payment. It moves no stock: restock, quarantine or write-off
 * the goods on the stock page (F80). */
import type { Session } from "@/lib/session";
import { tehranTodayIso } from "@/lib/jalali";
import { CREDIT_NOTE_REASONS, isCreditNoteReason } from "@/lib/creditNote";
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
