/* D3: a manager closes a small leftover balance with a reason, under the owner's limit. It is a LEFTOVER payment
 * (lib/repo/payments.ts): it settles the oldest unpaid orders like any receipt and posts Dr 5110 / Cr receivables,
 * but is not counted as money collected. Voiding it works as for any payment. */
import type { Session } from "@/lib/session";
import { isOwner } from "@/lib/roles";
import { tehranTodayIso } from "@/lib/jalali";
import { LEFTOVER_REASONS, isLeftoverReason, mayCloseLeftover } from "@/lib/leftover";
import { thresholdsFor } from "@/lib/repo/thresholds";
import { customerDebt, PaymentError, recordPayment } from "@/lib/repo/payments";

export async function closeLeftover(s: Session, customerId: number, amount: unknown, reason: unknown): Promise<number> {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) throw new PaymentError("مبلغ را به تومان و بیشتر از صفر وارد کنید");
  if (!isLeftoverReason(reason)) throw new PaymentError("دلیل بستن مانده را انتخاب کنید");
  const owed = (await customerDebt(s.organizationId, customerId)).total;
  if (amount > owed) throw new PaymentError("مبلغ از مانده‌ی مشتری بیشتر است");
  const limit = (await thresholdsFor(s.organizationId)).leftover_limit_toman;
  if (!mayCloseLeftover(isOwner(s.role), amount, limit)) throw new PaymentError("بستن این مبلغ فقط با مالک است؛ سقف شما کمتر است");
  const label = LEFTOVER_REASONS.find((r) => r.id === reason)!.label;
  return await recordPayment(s.organizationId, {
    customer_id: customerId,
    amount_toman: amount,
    method: "LEFTOVER",
    received_at: tehranTodayIso(),
    received_by: s.user.id,
    note: `بستن مانده: ${label}`,
  });
}
