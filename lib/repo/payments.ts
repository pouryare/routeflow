import { cache } from "react";
import { isToman } from "@/lib/money";
import type { DatabaseSync } from "node:sqlite";
import { makeRepo } from "./base";
import { lineTotalToman, type LineSnapshot } from "@/lib/orderMath";
import type { CustomerDebt } from "@/lib/types";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { tryEmitEvent } from "./events";
/* The business meaning of a receipt lives in ledgerPostings, NOT here and NOT in the
   engine. postJournal stays the only writer of journals; keeping the mapping in a
   separate file makes "one function writes a journal" structural rather than a comment
   a later editor can route around with a special case. */
import { postReceipt, postReceiptReversal, receiptJournalIdFor } from "./ledgerPostings";

export type { CustomerDebt };

/** A refusal the caller shows the user, not a bug. */
export class PaymentError extends Error {}

export type PaymentMethod =
  | "CASH"
  | "POS"
  | "CARD_TO_CARD"
  | "CHEQUE"
  | "CREDIT_NOTE"
  | "OTHER";

export interface PaymentRow {
  id: number;
  organization_id: number;
  customer_id: number;
  amount_toman: number;
  method: PaymentMethod;
  received_at: string;
  received_by: number;
  reference: string | null;
  receipt_photo_stem: string | null;
  cheque_id: number | null;
  delivery_stop_id: number | null;
  note: string | null;
  voided_at: string | null;
  voided_by: number | null;
  void_reason: string | null;
  created_at: string;
}

/** One slice of a payment. `order_id === null` means the slice sits on the customer's
 *  account as an unallocated credit. */
export interface AllocationInput {
  order_id: number | null;
  amount_toman: number;
}

export interface RecordPaymentInput {
  customer_id: number;
  amount_toman: number;
  method: PaymentMethod;
  received_at: string;
  received_by: number;
  reference?: string | null;
  receipt_photo_stem?: string | null;
  cheque_id?: number | null;
  delivery_stop_id?: number | null;
  note?: string | null;
  /** An explicit split. When omitted, FIFO over the customer's oldest unpaid
   *  delivered orders, remainder on account. */
  allocations?: AllocationInput[];
  /** Permit a per-order allocation that exceeds the order's outstanding balance. */
  allow_overpay?: boolean;
  /** Phase 4: the client-generated idempotency key when the cash was taken offline. */
  client_uuid?: string | null;
}

export const paymentsRepo = makeRepo<PaymentRow>("payments", { tenant: true });

const isWholeToman = (n: unknown): n is number => typeof n === "number" && isToman(n);

interface OutstandingOrder {
  id: number;
  order_date: string;
  delivered_at: string | null;
  total_toman: number;
  paid_toman: number;
}

/** Every delivered order for a customer, oldest first, with its frozen total and its
 *  current paid cache. The one query Tasks 2, 3 and 7 all age or settle against. */
export function deliveredOrdersForCustomer(
  db: DatabaseSync,
  organizationId: number,
  customerId: number
): OutstandingOrder[] {
  const orders = db
    .prepare(
      `SELECT o.id, o.order_date, o.delivered_at, o.paid_toman
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
        WHERE o.customer_id = ? AND c.organization_id = ? AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
        ORDER BY o.order_date, o.id`
    )
    .all(customerId, organizationId) as unknown as Omit<OutstandingOrder, "total_toman">[];

  const lineStmt = db.prepare(
    `SELECT packs_ordered, packs_delivered, unit_price_toman, unit_cost_toman,
            qty_per_pack, kg_per_base_unit
       FROM order_lines WHERE order_id = ?`
  );

  return orders.map((o) => {
    const lines = lineStmt.all(o.id) as unknown as LineSnapshot[];
    const total_toman = lines.reduce((sum, l) => sum + lineTotalToman(l), 0);
    return { ...o, total_toman };
  });
}

/** Fill the customer's oldest unpaid delivered orders first; whatever is left over
 *  becomes an on-account slice (`order_id: null`). Reads only -- returns the split. */
export function autoAllocateFIFO(
  organizationId: number,
  customerId: number,
  amount_toman: number
): AllocationInput[] {
  if (!isWholeToman(amount_toman) || amount_toman <= 0) {
    throw new PaymentError("مبلغ را به تومان، بدون اعشار و بیشتر از صفر وارد کنید");
  }
  const db = paymentsRepo.db();
  const orders = deliveredOrdersForCustomer(db, organizationId, customerId);

  const out: AllocationInput[] = [];
  let left = amount_toman;
  for (const o of orders) {
    if (left <= 0) break;
    const outstanding = Math.max(0, o.total_toman - o.paid_toman);
    if (outstanding <= 0) continue;
    const take = Math.min(left, outstanding);
    out.push({ order_id: o.id, amount_toman: take });
    left -= take;
  }
  if (left > 0) out.push({ order_id: null, amount_toman: left });
  return out;
}

/** Reset one order's `paid_toman` cache and `payment_status` from its live, non-voided
 *  allocations. Called after every allocation change. */
export function recomputeOrderPayment(organizationId: number, orderId: number): void {
  recomputeOrderPaymentTxn(paymentsRepo.db(), organizationId, orderId);
}

export function recomputeOrderPaymentTxn(
  db: DatabaseSync,
  organizationId: number,
  orderId: number
): void {
  const paid = Number(
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(a.amount_toman), 0) AS paid
             FROM payment_allocations a
             JOIN payments p ON p.id = a.payment_id
            WHERE a.order_id = ? AND p.voided_at IS NULL AND p.organization_id = ?`
        )
        .get(orderId, organizationId) as { paid: number }
    ).paid
  );

  const lines = db
    .prepare(
      `SELECT packs_ordered, packs_delivered, unit_price_toman, unit_cost_toman,
              qty_per_pack, kg_per_base_unit
         FROM order_lines WHERE order_id = ?`
    )
    .all(orderId) as unknown as LineSnapshot[];
  const total = lines.reduce((sum, l) => sum + lineTotalToman(l), 0);

  const status = paid >= total && total > 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
  db.prepare(
    "UPDATE orders SET paid_toman = ?, payment_status = ?, updated_at = ? WHERE id = ? AND organization_id = ?"
  ).run(paid, status, new Date().toISOString(), orderId, organizationId);
}

function validateAllocations(
  db: DatabaseSync,
  organizationId: number,
  input: RecordPaymentInput
): AllocationInput[] {
  const allocs =
    input.allocations ??
    autoAllocateFIFO(organizationId, input.customer_id, input.amount_toman);

  const sum = allocs.reduce((s, a) => {
    if (!isWholeToman(a.amount_toman)) {
      throw new PaymentError("مبلغ تخصیص را به تومان و بدون اعشار وارد کنید");
    }
    return s + a.amount_toman;
  }, 0);
  if (sum !== input.amount_toman) {
    throw new PaymentError("جمع تخصیص‌ها با مبلغ دریافت برابر نیست");
  }

  const byOrder = new Map<number, number>();
  for (const a of allocs) {
    if (a.order_id === null) continue;
    const order = db
      .prepare("SELECT id, customer_id, organization_id FROM orders WHERE id = ?")
      .get(a.order_id) as
      | { id: number; customer_id: number; organization_id: number | null }
      | undefined;
    // A missing or cross-tenant order is not found -- the data-layer form of 404-not-403.
    // orders.organization_id is stamped at creation and always set; a NULL here is only
    // ever a hand-seeded test row, which the boot backfill would fix in production.
    if (!order || (order.organization_id !== null && order.organization_id !== organizationId)) {
      throw new PaymentError("سفارش پیدا نشد");
    }
    if (order.customer_id !== input.customer_id) {
      throw new PaymentError("سفارش به این مشتری تعلق ندارد");
    }
    byOrder.set(a.order_id, (byOrder.get(a.order_id) ?? 0) + a.amount_toman);
  }

  if (!input.allow_overpay) {
    for (const [orderId, allocated] of byOrder) {
      const existing = Number(
        (
          db
            .prepare(
              `SELECT COALESCE(SUM(a.amount_toman), 0) AS paid
                 FROM payment_allocations a
                 JOIN payments p ON p.id = a.payment_id
                WHERE a.order_id = ? AND p.voided_at IS NULL AND p.organization_id = ?`
            )
            .get(orderId, organizationId) as { paid: number }
        ).paid
      );
      const lines = db
        .prepare(
          `SELECT packs_ordered, packs_delivered, unit_price_toman, unit_cost_toman,
                  qty_per_pack, kg_per_base_unit
             FROM order_lines WHERE order_id = ?`
        )
        .all(orderId) as unknown as LineSnapshot[];
      const total = lines.reduce((sum, l) => sum + lineTotalToman(l), 0);
      if (existing + allocated > total) {
        throw new PaymentError("تخصیص از باقی‌ماندهٔ سفارش بیشتر است");
      }
    }
  }

  return allocs;
}

/** A payment is recorded when the money arrives, so a date well in the future is a typo,
 *  and one years back is almost certainly a wrong year. An unparseable string used to reach
 *  the database and fail later as an empty 500. */
function assertReasonableReceivedAt(receivedAt: unknown): void {
  const t = typeof receivedAt === "string" ? Date.parse(receivedAt) : NaN;
  const day = 86_400_000;
  if (Number.isNaN(t) || t > Date.now() + day || t < Date.now() - 5 * 366 * day) {
    throw new PaymentError("تاریخ دریافت معتبر نیست");
  }
}

/** Insert a payment and its allocations inside a transaction the caller already owns.
 *  `recordDelivery` and the cheque path both need this so the money write joins their
 *  own atomic block. */
export function recordPaymentTxn(
  db: DatabaseSync,
  organizationId: number,
  input: RecordPaymentInput
): number {
  if (!isWholeToman(input.amount_toman) || input.amount_toman <= 0) {
    throw new PaymentError("مبلغ را به تومان، بدون اعشار و بیشتر از صفر وارد کنید");
  }
  assertReasonableReceivedAt(input.received_at);
  const customer = db
    .prepare("SELECT organization_id FROM customers WHERE id = ?")
    .get(input.customer_id) as { organization_id: number | null } | undefined;
  // NULL organization_id is only a hand-seeded test row -- the boot backfill sets it in
  // production. A non-null mismatch is a genuine cross-tenant write and is refused.
  if (!customer || (customer.organization_id !== null && customer.organization_id !== organizationId)) {
    throw new PaymentError("مشتری پیدا نشد");
  }

  const allocs = validateAllocations(db, organizationId, input);
  const now = new Date().toISOString();

  const paymentId = Number(
    db
      .prepare(
        `INSERT INTO payments
           (organization_id, customer_id, amount_toman, method, received_at, received_by,
            reference, receipt_photo_stem, cheque_id, delivery_stop_id, client_uuid, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        organizationId,
        input.customer_id,
        input.amount_toman,
        input.method,
        input.received_at,
        input.received_by,
        input.reference ?? null,
        input.receipt_photo_stem ?? null,
        input.cheque_id ?? null,
        input.delivery_stop_id ?? null,
        input.client_uuid ?? null,
        input.note ?? null,
        now
      ).lastInsertRowid
  );

  const insAlloc = db.prepare(
    "INSERT INTO payment_allocations (payment_id, order_id, amount_toman, created_at) VALUES (?, ?, ?, ?)"
  );
  for (const a of allocs) insAlloc.run(paymentId, a.order_id, a.amount_toman, now);

  const orderIds = [
    ...new Set(allocs.filter((a) => a.order_id !== null).map((a) => a.order_id as number)),
  ];
  for (const orderId of orderIds) {
    recomputeOrderPaymentTxn(db, organizationId, orderId);
  }

  tryEmitEvent(
    organizationId,
    {
      kind: "payment.recorded",
      entity_type: "payment",
      entity_id: paymentId,
      actor_user_id: input.received_by,
      // order_ids is what recipientsFor("payment.recorded") resolves salespeople from --
      // one payment can span several orders, so it threads the distinct allocation ids.
      metadata: {
        amount_toman: input.amount_toman,
        method: input.method,
        customer_id: input.customer_id,
        order_ids: orderIds,
      },
    },
    db
  );

  /* The receipt posts in the SAME transaction as the payments row. Two systems that
     record the same money must agree or they will not: if this throws, the payment is
     rolled back with it, and there is never a receipt in one system and not the other.

     postReceipt takes `db` and opens NOTHING -- the caller's BEGIN IMMEDIATE is already
     open here, and a nested BEGIN throws in SQLite. That is the whole reason
     recordPayment/recordPaymentTxn exists as a pair. */
  postReceipt(db, {
    organizationId,
    paymentId,
    customerId: input.customer_id,
    amountToman: input.amount_toman,
    method: input.method,
    receivedAt: input.received_at,
    receivedBy: input.received_by,
    memo: input.note ?? null,
  });

  return paymentId;
}

/** Record a payment. Opens its own transaction; for a call from inside one, use
 *  `recordPaymentTxn`. */
export function recordPayment(organizationId: number, input: RecordPaymentInput): number {
  const db = paymentsRepo.db();
  db.exec("BEGIN IMMEDIATE");
  try {
    const id = recordPaymentTxn(db, organizationId, input);
    db.exec("COMMIT");
    return id;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function listPayments(
  organizationId: number,
  filter?: { customer_id?: number }
): PaymentRow[] {
  const rows = filter?.customer_id
    ? paymentsRepo.list(organizationId, { customer_id: filter.customer_id } as Partial<PaymentRow>)
    : paymentsRepo.list(organizationId);
  return rows.sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
}

export function getPayment(organizationId: number, id: number): PaymentRow | undefined {
  return paymentsRepo.get(organizationId, id);
}

/** Record that a payment (a POS or card-to-card receipt) has a photo, and stamp the
 *  stem onto the payment. The image bytes are written by the route, like the customer
 *  photo path. One transaction. */
export function attachReceiptPhoto(
  organizationId: number,
  paymentId: number,
  fileStem: string,
  caption?: string | null
): void {
  const db = paymentsRepo.db();
  if (!paymentsRepo.get(organizationId, paymentId)) throw new PaymentError("دریافت پیدا نشد");
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO photos (entity_type, entity_id, file_stem, caption, taken_at, created_at)
       VALUES ('payment', ?, ?, ?, ?, ?)`
    ).run(paymentId, fileStem, caption ?? null, now, now);
    db.prepare(
      "UPDATE payments SET receipt_photo_stem = ? WHERE id = ? AND organization_id = ?"
    ).run(fileStem, paymentId, organizationId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function allocationsOfPayment(
  organizationId: number,
  paymentId: number
): { order_id: number | null; amount_toman: number }[] {
  const db = paymentsRepo.db();
  const payment = paymentsRepo.get(organizationId, paymentId);
  if (!payment) throw new PaymentError("دریافت پیدا نشد");
  return db
    .prepare(
      "SELECT order_id, amount_toman FROM payment_allocations WHERE payment_id = ? ORDER BY id"
    )
    .all(paymentId) as unknown as { order_id: number | null; amount_toman: number }[];
}

/** Replace a payment's allocations wholesale, inside one transaction.
 *
 *  This is the write behind the allocation UI. Allocation used to be FIFO and invisible:
 *  a customer 40M on account could not see which orders it covered, let alone disagree.
 *  The money was never wrong — the screen just refused to explain it.
 *
 *  Two things this deliberately does NOT do:
 *
 *  - It does not touch the payment's own row or its ledger journal. Re-allocating does not
 *    move money; the receipt is still the receipt, still Dr cash / Cr AR. Only the
 *    attribution between orders changes, so there is nothing new to post. (A future
 *    "split a receipt into two" feature WOULD need a journal, and would not belong here.)
 *  - It does not delete allocations and reinsert them in two steps. The old rows go and the
 *    new ones land in ONE transaction, because a crash between them would leave a payment
 *    whose rows sum to nothing at all — and every order's `paid_toman` cache quietly wrong,
 *    with nothing to recompute it from.
 *
 *  Every order it TOUCHED is recomputed, not just the ones in the new list: moving money
 *  OFF an order must reset that order, and it is no longer in the new list by definition. */
export function replaceAllocations(
  organizationId: number,
  paymentId: number,
  allocations: AllocationInput[]
): void {
  const db = paymentsRepo.db();
  const payment = db
    .prepare(
      "SELECT customer_id, amount_toman, voided_at FROM payments WHERE id = ? AND organization_id = ?"
    )
    .get(paymentId, organizationId) as
    | { customer_id: number; amount_toman: number; voided_at: string | null }
    | undefined;
  // Another org's payment reads as not found, and a voided one is immutable: voiding
  // DROPPED its allocations, so there is nothing left to re-point at anything.
  if (!payment) throw new PaymentError("دریافت پیدا نشد");
  if (payment.voided_at) throw new PaymentError("دریافت باطل‌شده قابل ویرایش نیست");

  const kept = allocations.filter((a) => a.amount_toman > 0);
  const sum = kept.reduce((s, a) => {
    if (!isWholeToman(a.amount_toman)) throw new PaymentError("مبلغ تخصیص را به تومان و بدون اعشار وارد کنید");
    return s + a.amount_toman;
  }, 0);
  // The sum must equal the RECEIPT, not the remainder: allocation explains where the whole
  // payment went, and an unexplained gap is exactly what this screen exists to remove.
  if (sum !== payment.amount_toman) {
    throw new PaymentError("جمع تخصیص‌ها با مبلغ دریافت برابر نیست");
  }

  // Which orders are fair game: this customer's delivered orders, each with what it is
  // worth. An order outside that set is refused outright.
  const open = new Map(
    deliveredOrdersForCustomer(db, organizationId, payment.customer_id).map((o) => [
      o.id,
      o.total_toman,
    ])
  );

  const touched = new Set<number>();
  for (const a of kept) {
    if (a.order_id === null) continue;
    const total = open.get(a.order_id);
    if (total === undefined) throw new PaymentError("سفارش متعلق به این مشتری نیست");
    // This payment's OWN current holding is excluded, so re-sending the same split is not
    // read as doubling it. Everything else already on the order is a hard ceiling.
    const elsewhere = Number(
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(a2.amount_toman), 0) AS amt
               FROM payment_allocations a2 JOIN payments p2 ON p2.id = a2.payment_id
              WHERE a2.order_id = ? AND p2.organization_id = ? AND p2.voided_at IS NULL AND p2.id <> ?`
          )
          .get(a.order_id, organizationId, paymentId) as { amt: number }
      ).amt
    );
    if (elsewhere + a.amount_toman > total) {
      throw new PaymentError("تخصیص بیش از مبلغ سفارش است");
    }
    touched.add(a.order_id);
  }

  // Everything the OLD allocations touched has to be reset too.
  for (const row of db
    .prepare("SELECT order_id FROM payment_allocations WHERE payment_id = ? AND order_id IS NOT NULL")
    .all(paymentId) as unknown as { order_id: number }[]) {
    touched.add(row.order_id);
  }

  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM payment_allocations WHERE payment_id = ?").run(paymentId);
    const ins = db.prepare(
      "INSERT INTO payment_allocations (payment_id, order_id, amount_toman, created_at) VALUES (?, ?, ?, ?)"
    );
    for (const a of kept) ins.run(paymentId, a.order_id, a.amount_toman, now);
    for (const orderId of touched) recomputeOrderPaymentTxn(db, organizationId, orderId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Void a payment: mark it, drop its allocations, and reset every order it had
 *  touched. Reversible only by recording a fresh payment. */
export function voidPayment(
  organizationId: number,
  id: number,
  voidedBy: number,
  reason: string
): void {
  const db = paymentsRepo.db();
  db.exec("BEGIN IMMEDIATE");
  try {
    voidPaymentTxn(db, organizationId, id, voidedBy, reason);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const ZERO_DEBT = (): CustomerDebt => ({
  total: 0,
  bucket_0_7: 0,
  bucket_8_30: 0,
  bucket_30_plus: 0,
});

/** Asked once per database handle: migrations finish inside getDb(), so the column is either
 *  there for the life of the handle or it is not, and re-reading the schema on every debt
 *  lookup cost a PRAGMA per customer on the dashboard. */
const openingBalanceColumn = new WeakMap<DatabaseSync, boolean>();
function customersHasOpeningBalance(db: DatabaseSync): boolean {
  let has = openingBalanceColumn.get(db);
  if (has === undefined) {
    has = (db.prepare("PRAGMA table_info(customers)").all() as unknown as { name: string }[]).some(
      (c) => c.name === "opening_balance_toman"
    );
    openingBalanceColumn.set(db, has);
  }
  return has;
}

function ageDays(nowISO: string, refISO: string): number {
  return Math.floor((Date.parse(nowISO) - Date.parse(refISO)) / 86_400_000);
}

function bucketOf(debt: CustomerDebt, days: number, amount: number): void {
  if (days < 8) debt.bucket_0_7 += amount;
  else if (days < 31) debt.bucket_8_30 += amount;
  else debt.bucket_30_plus += amount;
}

/** A customer's live balance, computed -- never stored.
 *
 *  `total` is `opening_balance + Σ(delivered order totals) − Σ(non-voided allocations
 *  for this customer, on-account slices included)`. The three buckets age each
 *  still-unpaid delivered order by `asOf − delivered_at` (falling back to the order
 *  date); the opening balance is old by definition and lands wholly in `bucket_30_plus`.
 */
export function customerDebt(
  organizationId: number,
  customerId: number,
  asOf?: string
): CustomerDebt {
  const db = paymentsRepo.db();
  const now = asOf ?? new Date().toISOString();

  const opening = customersHasOpeningBalance(db)
    ? Number(
        (
          db
            .prepare(
              "SELECT COALESCE(opening_balance_toman, 0) AS ob FROM customers WHERE id = ? AND organization_id = ?"
            )
            .get(customerId, organizationId) as { ob: number } | undefined
        )?.ob ?? 0
      )
    : 0;

  const allocated = Number(
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(a.amount_toman), 0) AS s
             FROM payment_allocations a
             JOIN payments p ON p.id = a.payment_id
            WHERE p.customer_id = ? AND p.organization_id = ? AND p.voided_at IS NULL`
        )
        .get(customerId, organizationId) as { s: number }
    ).s
  );

  const debt = ZERO_DEBT();
  debt.total = opening;
  debt.bucket_30_plus = opening;

  for (const o of deliveredOrdersForCustomer(db, organizationId, customerId)) {
    debt.total += o.total_toman;
    const outstanding = Math.max(0, o.total_toman - o.paid_toman);
    if (outstanding > 0) bucketOf(debt, ageDays(now, o.delivered_at ?? o.order_date), outstanding);
  }
  debt.total -= allocated;
  return debt;
}

/** Every customer's debt in one pass, for the dashboard and reports. */
export function customerDebtsForOrg(
  organizationId: number,
  asOf?: string
): Map<number, CustomerDebt> {
  const db = paymentsRepo.db();
  const now = asOf ?? new Date().toISOString();
  const out = new Map<number, CustomerDebt>();

  const hasOpening = customersHasOpeningBalance(db);
  const customers = db
    .prepare(
      hasOpening
        ? "SELECT id, COALESCE(opening_balance_toman, 0) AS ob FROM customers WHERE organization_id = ?"
        : "SELECT id, 0 AS ob FROM customers WHERE organization_id = ?"
    )
    .all(organizationId) as unknown as { id: number; ob: number }[];
  for (const c of customers) {
    const d = ZERO_DEBT();
    d.total = c.ob;
    d.bucket_30_plus = c.ob;
    out.set(c.id, d);
  }

  /* Order totals are summed in SQL. Each line is rounded to whole Toman BEFORE it is added,
     exactly as lineTotalToman does (round half away from zero, on the delivered packs when
     there are any and the ordered ones otherwise), so the sum is the same integer the
     per-line JS arithmetic produced. Only the orders still owing anything come back to JS,
     where the ageing buckets are applied -- a few thousand rows instead of every line the
     organisation has ever delivered. tests/debts-aggregate.test.ts holds this equal to the
     original row-by-row version. */
  /* One pass: the per-order totals are materialised once, then read two ways -- a row per
     customer (their delivered total) and a row per order that still owes something (for the
     ageing buckets). kind 0 / kind 1 tells the two apart. */
  const rows = db
    .prepare(
      `WITH ot AS MATERIALIZED (
         SELECT o.customer_id AS customer_id, o.order_date AS order_date, o.delivered_at AS delivered_at,
                o.paid_toman AS paid_toman, COALESCE(lt.total, 0) AS total
           FROM orders o
           JOIN customers c ON c.id = o.customer_id
           LEFT JOIN (
             SELECT order_id,
                    SUM(CAST(ROUND(COALESCE(packs_delivered, packs_ordered) * unit_price_toman) AS INTEGER)) AS total
               FROM order_lines GROUP BY order_id
           ) lt ON lt.order_id = o.id
          WHERE c.organization_id = ? AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
       )
       SELECT 0 AS kind, customer_id, SUM(total) AS amount, NULL AS order_date, NULL AS delivered_at
         FROM ot GROUP BY customer_id
       UNION ALL
       SELECT 1, customer_id, total - paid_toman, order_date, delivered_at
         FROM ot WHERE total > paid_toman`
    )
    .all(organizationId) as unknown as {
    kind: number;
    customer_id: number;
    amount: number;
    order_date: string | null;
    delivered_at: string | null;
  }[];
  for (const r of rows) {
    const d = out.get(r.customer_id);
    if (!d) continue;
    if (r.kind === 0) d.total += r.amount;
    else bucketOf(d, ageDays(now, r.delivered_at ?? r.order_date!), r.amount);
  }

  const allocRows = db
    .prepare(
      `SELECT p.customer_id, COALESCE(SUM(a.amount_toman), 0) AS allocated
         FROM payment_allocations a
         JOIN payments p ON p.id = a.payment_id
        WHERE p.organization_id = ? AND p.voided_at IS NULL
        GROUP BY p.customer_id`
    )
    .all(organizationId) as unknown as { customer_id: number; allocated: number }[];
  for (const r of allocRows) {
    const d = out.get(r.customer_id);
    if (d) d.total -= r.allocated;
  }

  return out;
}

/** customerDebtsForOrg, memoised for the length of one server render.
 *
 *  The dashboard asks for the whole organisation's debt three times in one request -- the
 *  stat tiles, the health overview and the action center's overdue bucket -- and each pass
 *  walks every delivered order and line. React's cache() shares one result across those
 *  calls inside a single RSC render and discards it afterwards; outside a render (route
 *  handlers, scripts, tests) it simply calls through, so nothing can go stale. Callers must
 *  treat the Map as read-only. */
export const customerDebtsForOrgOnce = cache((organizationId: number) => customerDebtsForOrg(organizationId));

export function voidPaymentTxn(
  db: DatabaseSync,
  organizationId: number,
  id: number,
  voidedBy: number,
  reason: string
): void {
  const payment = db
    .prepare(
      `SELECT id, customer_id, amount_toman, method, received_at, received_by, voided_at
         FROM payments WHERE id = ? AND organization_id = ?`
    )
    .get(id, organizationId) as
    | {
        id: number;
        customer_id: number;
        amount_toman: number;
        method: string;
        received_at: string;
        received_by: number;
        voided_at: string | null;
      }
    | undefined;
  if (!payment) throw new PaymentError("دریافت پیدا نشد");
  if (payment.voided_at) throw new PaymentError("این دریافت قبلاً باطل شده است");

  /* Read the ORIGINAL receipt journal BEFORE the UPDATE. The reversal points at it, and
     after this function runs the voided payment is excluded from the backfill's work
     list -- so a later attempt to find it would find nothing. Order is half the fix. */
  const originalJournalId = receiptJournalIdFor(payment.id);

  const touched = (
    db
      .prepare(
        "SELECT DISTINCT order_id FROM payment_allocations WHERE payment_id = ? AND order_id IS NOT NULL"
      )
      .all(id) as unknown as { order_id: number }[]
  ).map((r) => r.order_id);

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE payments SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?"
  ).run(now, voidedBy, reason, id);
  db.prepare("DELETE FROM payment_allocations WHERE payment_id = ?").run(id);

  /* A payment recorded before the ledger existed has no receipt journal. Voiding it must
     not invent a reversal for money the ledger never saw -- that would post a credit with
     no matching debit and break the trial balance. Skipping is the honest answer, and the
     backfill leaves that payment unposted in both systems, consistently. */
  if (originalJournalId !== undefined) {
    postReceiptReversal(db, {
      organizationId,
      paymentId: payment.id,
      customerId: payment.customer_id,
      amountToman: payment.amount_toman,
      method: payment.method,
      originalJournalId,
      reversedAt: now,
      reversedBy: voidedBy,
      reason,
    });
  }

  for (const orderId of touched) recomputeOrderPaymentTxn(db, organizationId, orderId);
}
