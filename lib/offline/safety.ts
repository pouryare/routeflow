/** Which writes may be made offline, from `docs/crm-erp-plan.md` §4.5.
 *
 *  The rule: an offline write is safe when it records a FACT -- something that already
 *  happened, that the server cannot argue with. It is unsafe when it makes a CLAIM on a
 *  shared resource -- stock, route capacity, an authority decision -- because two
 *  devices offline can both make the same claim and only a server can arbitrate.
 *
 *  That rule maps onto the Phase 3 order machine: `submit` queues (the server validates
 *  on arrival), `approve` / `plan` / `freeze` do not. A claim op submitted offline is
 *  refused at the call site -- it never enters the outbox, because queue-then-reject
 *  would let someone believe they approved something they did not.
 *
 *  Pure module -- no `lib/db` / `lib/repo` import.
 */

export type OfflineOp =
  | "order.draftCreate"
  | "order.draftEdit"
  | "order.submit"
  | "delivery.start"
  | "delivery.complete"
  | "payment.record"
  | "cheque.record"
  | "complaint.record"
  | "customer.capture"
  | "order.approve"
  | "order.plan"
  | "order.freeze"
  | "credit.decide";

export type OfflineClass = "fact" | "claim";

export const OFFLINE_OPS: Record<OfflineOp, { class: OfflineClass; label_fa: string }> = {
  "order.draftCreate": { class: "fact", label_fa: "ثبت پیش‌نویس سفارش" },
  "order.draftEdit": { class: "fact", label_fa: "ویرایش پیش‌نویس سفارش" },
  "order.submit": { class: "fact", label_fa: "ارسال سفارش برای بررسی" },
  "delivery.start": { class: "fact", label_fa: "شروع مسیر" },
  "delivery.complete": { class: "fact", label_fa: "ثبت تحویل درِ محل" },
  "payment.record": { class: "fact", label_fa: "ثبت دریافت وجه" },
  "cheque.record": { class: "fact", label_fa: "ثبت دریافت چک" },
  "complaint.record": { class: "fact", label_fa: "ثبت شکایت" },
  "customer.capture": { class: "fact", label_fa: "ثبت مشتری تازه" },
  "order.approve": { class: "claim", label_fa: "تأیید سفارش" },
  "order.plan": { class: "claim", label_fa: "برنامه‌ریزی سفارش روی مسیر" },
  "order.freeze": { class: "claim", label_fa: "قطعی‌کردن مسیر" },
  "credit.decide": { class: "claim", label_fa: "تصمیم اعتباری" },
};

export const OFFLINE_OP_LIST = Object.keys(OFFLINE_OPS) as OfflineOp[];

export function offlineClass(op: OfflineOp): OfflineClass {
  return OFFLINE_OPS[op].class;
}

/** True when `op` may sit in the outbox. Every `fact` may; no `claim` may. */
export function mayQueueOffline(op: OfflineOp): boolean {
  return offlineClass(op) === "fact";
}

export function isOfflineOp(value: string): value is OfflineOp {
  return value in OFFLINE_OPS;
}
