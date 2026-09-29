/** Recording an order.
 *
 *  This is the module that replaces the paper slips. Everything it does that looks
 *  fussy is protecting one property: an order, once confirmed, means the same thing in
 *  six months as it did on the day it was taken. Commission is paid off these numbers.
 */

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import { resolvePrice } from "./catalogue";
import { toJalali } from "./jalali";
import { customerDebt } from "./repo/payments";
import { requestApproval } from "./repo/creditApprovals";
import { PRICED_ORDER_STATUSES, sqlStatusList } from "./orderStateMachine";
import type { OrderRole, OrderStatus } from "./orderStateMachine";
import {
  advanceOrder,
  appendOrderEvent,
  OrderError,
  OrderTransitionError,
  OrderRoleError,
} from "./repo/orders";
import {
  formatOrderNo,
  orderTotalToman,
  orderKg,
  orderMarginToman,
  lineTotalToman,
  lineKg,
  effectivePacks,
  type LineSnapshot,
} from "./orderMath";

export { OrderError, OrderTransitionError, OrderRoleError };

export interface LineInput {
  product_id: number;
  packaging_id: number;
  packs: number;
  is_reversal?: boolean;
  reverses_line_id?: number | null;
}

export interface CreateOrderInput {
  customer_id: number;
  order_date: string;
  created_by: number;
  organization_id: number;
  salesperson_user_id?: number | null;
  credit_override_by?: number | null;
  notes?: string | null;
  /** Phase 4: the client-generated idempotency key when this order was drafted offline. */
  client_uuid?: string | null;
  lines: LineInput[];
}

export interface OrderLine extends LineSnapshot {
  id: number;
  product_id: number;
  packaging_id: number;
  product_name: string;
  packaging_name: string;
  is_reversal: number;
  total_toman: number;
  kg: number;
}

export interface OrderDetail {
  id: number;
  order_no: string;
  customer_id: number;
  customer_name: string;
  group_id: number | null;
  salesperson_user_id: number | null;
  salesperson_name: string | null;
  status: string;
  order_date: string;
  delivered_at: string | null;
  payment_status: string;
  paid_toman: number;
  credit_override_by: number | null;
  notes: string | null;
  created_at: string;
  lines: OrderLine[];
  total_toman: number;
  kg: number;
  margin_toman: number;
}

/** The next number for the Jalali year the order falls in.
 *
 *  MAX + 1 over that year's rows, read inside the caller's transaction. The UNIQUE
 *  constraint on order_no is what actually guarantees no duplicate -- this only has to
 *  be right, not exclusive, and BEGIN IMMEDIATE in createOrder takes the write lock
 *  before the read so two concurrent writers cannot both see the same maximum. */
function nextOrderNo(db: DatabaseSync, orderDate: string, organizationId: number): string {
  const jy = toJalali(orderDate)?.jy ?? toJalali(new Date().toISOString())!.jy;
  const prefix = `${jy}-`;
  // Scoped to this organisation: order_no is unique per (organization_id, order_no) now,
  // not globally, so the next number has to be the max within this organisation too --
  // otherwise a second tenant's numbering would start wherever the first tenant's had
  // reached, which both wastes numbers and tells one company how many orders another has
  // taken this year.
  const row = db
    .prepare("SELECT MAX(order_no) AS latest FROM orders WHERE order_no LIKE ? AND organization_id = ?")
    .get(`${prefix}%`, organizationId) as { latest: string | null };

  const previous = row.latest ? Number(row.latest.slice(prefix.length)) : 0;
  return formatOrderNo(jy, previous + 1);
}

/** Resolves everything a line needs to be frozen, or refuses.
 *
 *  Refusing an unpriced product rather than defaulting to zero is deliberate: a free
 *  order is a real thing, so a silent zero is indistinguishable from one, and the
 *  person recording it is the only one who can tell the difference. */
function snapshotLine(db: DatabaseSync, orderDate: string, input: LineInput) {
  const packaging = db
    .prepare(
      `SELECT pk.id, pk.qty_per_pack, pk.product_id, p.kg_per_base_unit, p.avg_cost_toman, p.name AS product_name
         FROM packagings pk JOIN products p ON p.id = pk.product_id
        WHERE pk.id = ? AND pk.product_id = ?`
    )
    .get(input.packaging_id, input.product_id) as
    | {
        qty_per_pack: number;
        kg_per_base_unit: number;
        avg_cost_toman: number;
        product_name: string;
      }
    | undefined;

  if (!packaging) throw new OrderError("بسته‌بندی برای این کالا پیدا نشد");

  const price = resolvePrice(db, input.product_id, input.packaging_id, orderDate);
  if (!price) {
    throw new OrderError(`«${packaging.product_name}» در این تاریخ قیمت ندارد`);
  }

  return {
    unit_price_toman: price.price_toman,
    unit_cost_toman: packaging.avg_cost_toman,
    qty_per_pack: packaging.qty_per_pack,
    kg_per_base_unit: packaging.kg_per_base_unit,
    price_id: price.id,
  };
}

export function createOrder(
  db: DatabaseSync,
  input: CreateOrderInput
): { id: number; order_no: string } {
  if (input.lines.length === 0) throw new OrderError("سفارش بدون قلم ثبت نمی‌شود");

  const customer = db
    .prepare(
      "SELECT id, group_id, hard_credit_block, credit_limit_toman FROM customers WHERE id = ?"
    )
    .get(input.customer_id) as
    | {
        group_id: number | null;
        hard_credit_block: number;
        credit_limit_toman: number | null;
      }
    | undefined;
  if (!customer) throw new OrderError("مشتری پیدا نشد");

  // A representative settles in cash or bank cheque and is outside credit control.
  const isRepresentative = !!db
    .prepare(
      "SELECT 1 FROM representative_profiles WHERE customer_id = ? AND organization_id = ?"
    )
    .get(input.customer_id, input.organization_id);

  if (!isRepresentative && customer.hard_credit_block) {
    throw new OrderError("این مشتری مسدود اعتباری است و سفارش جدید ثبت نمی‌شود");
  }

  // IMMEDIATE rather than a deferred BEGIN: the transaction reads the highest order
  // number and then writes it back, and a deferred transaction would let two writers
  // both read the same maximum before either takes the lock.
  db.exec("BEGIN IMMEDIATE");
  try {
    const orderNo = nextOrderNo(db, input.order_date, input.organization_id);
    const now = new Date().toISOString();

    const orderId = Number(
      db
        .prepare(
          `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, status,
                               order_date, notes, credit_override_by, client_uuid, created_by,
                               created_at, updated_at, organization_id)
           VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          orderNo,
          input.customer_id,
          customer.group_id,
          input.salesperson_user_id ?? null,
          input.order_date.slice(0, 10),
          input.notes ?? null,
          input.credit_override_by ?? null,
          input.client_uuid ?? null,
          input.created_by,
          now,
          now,
          input.organization_id
        ).lastInsertRowid
    );

    for (const line of input.lines) {
      insertLine(db, orderId, input.order_date, line, now);
    }

    // Phase 3: an order is born a DRAFT. Credit control moved to submitOrder -- it is a
    // property of *submitting* for review, not of typing the slip. Record the birth so
    // the order_events timeline is never blank.
    appendOrderEvent(db, {
      organization_id: input.organization_id,
      order_id: orderId,
      from_status: null,
      to_status: "DRAFT",
      action: "create",
      actor_user_id: input.created_by,
    });

    db.exec("COMMIT");
    return { id: orderId, order_no: orderNo };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function insertLine(
  db: DatabaseSync,
  orderId: number,
  orderDate: string,
  line: LineInput,
  now: string
) {
  const snap = snapshotLine(db, orderDate, line);
  db.prepare(
    `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered,
                              unit_price_toman, unit_cost_toman, qty_per_pack,
                              kg_per_base_unit, price_id, is_reversal, reverses_line_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    orderId,
    line.product_id,
    line.packaging_id,
    line.packs,
    snap.unit_price_toman,
    snap.unit_cost_toman,
    snap.qty_per_pack,
    snap.kg_per_base_unit,
    snap.price_id,
    line.is_reversal ? 1 : 0,
    line.reverses_line_id ?? null,
    now
  );
}

/** Adds a line to a draft. Refuses once the order is confirmed -- at that point the
 *  correction is a reversal line, which is a different and deliberate act. */
export function addLine(db: DatabaseSync, orderId: number, line: LineInput): void {
  const order = db.prepare("SELECT status, order_date FROM orders WHERE id = ?").get(orderId) as
    | { status: string; order_date: string }
    | undefined;
  if (!order) throw new OrderError("سفارش پیدا نشد");
  if (order.status !== "DRAFT") {
    throw new OrderError("سفارش تأییدشده ویرایش نمی‌شود؛ برای اصلاح، قلم برگشتی ثبت کنید");
  }
  insertLine(db, orderId, order.order_date, line, new Date().toISOString());
  touch(db, orderId);
}

/** Whether a DRAFT is complete enough to submit: at least one non-reversal line and a
 *  positive total. */
function orderComplete(db: DatabaseSync, orderId: number): boolean {
  const lines = linesOf(db, orderId);
  const real = lines.filter((l) => !l.is_reversal);
  return real.length > 0 && orderTotalToman(lines) > 0;
}

/** Submit a DRAFT for review, then apply credit control.
 *
 *  - A representative or a `SAMPLE` order carries no receivable, so it is auto-passed to
 *    CONFIRMED on submit (reserving stock).
 *  - A direct customer with a credit limit whose balance + this order would breach it is
 *    flagged: `credit_hold = 1`, an approval request is filed, and the order moves to
 *    PENDING_CREDIT. `createCreditApprovalTask` (registered by lib/repo/creditApprovals)
 *    raises the manager's reminder.
 *  - Otherwise it waits at PENDING_REVIEW for a human `passReview`.
 */
export function submitOrder(
  organizationId: number,
  orderId: number,
  actor: { id: number | null; role: OrderRole; roles?: readonly OrderRole[]; actorId?: number }
): OrderStatus {
  const db = getDb();
  const order = db
    .prepare(
      "SELECT id, customer_id, order_type, status FROM orders WHERE id = ? AND organization_id = ?"
    )
    .get(orderId, organizationId) as
    | { id: number; customer_id: number; order_type: string; status: OrderStatus }
    | undefined;
  if (!order) throw new OrderError("سفارش پیدا نشد");
  if (!orderComplete(db, orderId)) throw new OrderError("سفارش بدون قلم یا با جمع صفر ثبت نمی‌شود");

  advanceOrder(organizationId, orderId, "submit", actor);

  const isRepresentative = !!db
    .prepare("SELECT 1 FROM representative_profiles WHERE customer_id = ? AND organization_id = ?")
    .get(order.customer_id, organizationId);

  if (isRepresentative || order.order_type === "SAMPLE") {
    return advanceOrder(organizationId, orderId, "passReview", { id: actor.id, role: "system" });
  }

  const customer = db
    .prepare("SELECT credit_limit_toman FROM customers WHERE id = ?")
    .get(order.customer_id) as { credit_limit_toman: number | null } | undefined;

  if (customer?.credit_limit_toman != null) {
    const total = orderTotalToman(linesOf(db, orderId));
    const balance = customerDebt(organizationId, order.customer_id).total;
    if (balance + total > customer.credit_limit_toman) {
      db.prepare("UPDATE orders SET credit_hold = 1 WHERE id = ? AND organization_id = ?").run(
        orderId,
        organizationId
      );
      requestApproval(organizationId, {
        order_id: orderId,
        requested_by: actor.id ?? order.customer_id,
        customer_id: order.customer_id,
        customer_balance_toman: balance,
        credit_limit_toman: customer.credit_limit_toman,
      });
      return advanceOrder(organizationId, orderId, "flagCredit", { id: actor.id, role: "system" });
    }
  }

  return "PENDING_REVIEW";
}

/** The manager's one-click "confirm this draft": submit for review and, if it did not
 *  divert to PENDING_CREDIT, pass review straight away. Kept for the board / PATCH route
 *  and the many tests that just want a confirmed order. */
export function confirmOrder(db: DatabaseSync, orderId: number): void {
  const order = db.prepare("SELECT organization_id, status FROM orders WHERE id = ?").get(orderId) as
    | { organization_id: number; status: string }
    | undefined;
  if (!order) throw new OrderError("سفارش پیدا نشد");
  if (order.status !== "DRAFT") throw new OrderError("این سفارش قبلاً تأیید شده است");

  const lines = db
    .prepare("SELECT COUNT(*) AS n FROM order_lines WHERE order_id = ?")
    .get(orderId) as { n: number };
  if (lines.n === 0) throw new OrderError("سفارش بدون قلم تأیید نمی‌شود");

  const orgId = order.organization_id ?? 1;
  const after = submitOrder(orgId, orderId, { id: null, role: "owner" });
  if (after === "PENDING_REVIEW") {
    advanceOrder(orgId, orderId, "passReview", { id: null, role: "owner" });
  }

  stampLastPurchase(db, orderId);
}

/** Brings customers.last_purchase_date up to this order's date.
 *
 *  That column is what daysSinceLastPurchase reads, which drives inactivityColor on the
 *  map, the dormant-customer count on analytics and the whole purchase-history panel.
 *  Nothing has written it since the original workbook import, which is why all of those
 *  features currently render nothing for every customer.
 *
 *  MAX rather than assignment: catching up on a week of paper slips means recording an
 *  older order after a newer one, and that must not make an active customer look
 *  dormant. COALESCE covers the first order a customer has ever had.
 */
function stampLastPurchase(db: DatabaseSync, orderId: number): void {
  db.prepare(
    `UPDATE customers
        SET last_purchase_date = MAX(
              COALESCE(last_purchase_date, ''),
              (SELECT order_date FROM orders WHERE id = ?)
            )
      WHERE id = (SELECT customer_id FROM orders WHERE id = ?)`
  ).run(orderId, orderId);
}

function touch(db: DatabaseSync, orderId: number) {
  db.prepare("UPDATE orders SET updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    orderId
  );
}

function linesOf(db: DatabaseSync, orderId: number): OrderLine[] {
  const rows = db
    .prepare(
      `SELECT ol.*, p.name AS product_name, pk.name AS packaging_name
         FROM order_lines ol
         JOIN products p ON p.id = ol.product_id
         JOIN packagings pk ON pk.id = ol.packaging_id
        WHERE ol.order_id = ?
        ORDER BY ol.id`
    )
    .all(orderId) as unknown as (OrderLine & LineSnapshot)[];

  return rows.map((row) => ({
    ...row,
    total_toman: lineTotalToman(row),
    kg: lineKg(row),
  }));
}

export function readOrder(db: DatabaseSync, orderId: number): OrderDetail | null {
  const order = db
    .prepare(
      `SELECT o.*, c.business_name AS customer_name, u.display_name AS salesperson_name
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         LEFT JOIN users u ON u.id = o.salesperson_user_id
        WHERE o.id = ?`
    )
    .get(orderId) as unknown as OrderDetail | undefined;
  if (!order) return null;

  const lines = linesOf(db, orderId);
  return {
    ...order,
    lines,
    total_toman: orderTotalToman(lines),
    kg: orderKg(lines),
    margin_toman: orderMarginToman(lines),
  };
}

export interface OrderSummary {
  id: number;
  order_no: string;
  /** Carried so a card can open the customer sheet without a second lookup per row. */
  customer_id: number;
  customer_name: string;
  salesperson_name: string | null;
  status: string;
  order_date: string;
  payment_status: string;
  paid_toman: number;
  total_toman: number;
  kg: number;
  line_count: number;
}

/** The order list, already scoped.
 *
 *  Takes the filter fragment rather than the session so that the scoping decision is
 *  made once, at the route, by orderFilter -- and so this module cannot accidentally be
 *  called without one. */
export function readOrders(
  db: DatabaseSync,
  scope: { sql: string; params: number[] },
  opts: { limit?: number; customerId?: number; status?: string } = {}
): OrderSummary[] {
  const extra: string[] = [];
  const params: (number | string)[] = [...scope.params];
  if (opts.customerId !== undefined) {
    extra.push(" AND o.customer_id = ?");
    params.push(opts.customerId);
  }
  if (opts.status !== undefined) {
    extra.push(" AND o.status = ?");
    params.push(opts.status);
  }

  const orders = db
    .prepare(
      `SELECT o.id, o.order_no, o.status, o.order_date, o.payment_status, o.paid_toman,
              o.customer_id, c.business_name AS customer_name, u.display_name AS salesperson_name
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         LEFT JOIN users u ON u.id = o.salesperson_user_id
        WHERE 1 = 1${scope.sql}${extra.join("")}
        ORDER BY o.id DESC
        LIMIT ?`
    )
    .all(...params, opts.limit ?? 200) as unknown as Omit<
    OrderSummary,
    "total_toman" | "kg" | "line_count"
  >[];

  // Totals are derived from the frozen line columns rather than stored on the order, so
  // there is no second copy of the figure to fall out of step with the lines.
  return orders.map((order) => {
    const lines = linesOf(db, order.id);
    return {
      ...order,
      total_toman: orderTotalToman(lines),
      kg: orderKg(lines),
      line_count: lines.length,
    };
  });
}

export interface ProductMixRow {
  product_id: number;
  product_name: string;
  packs: number;
  total_toman: number;
}

/** What one customer actually buys, biggest spend first.
 *
 *  The question a manager asks standing outside a shop, and the reason the customer
 *  panel on the map is worth joining to the sales data at all: «they take کره گیاهی and
 *  دوغ» is more useful there than any total.
 *
 *  Drafts are excluded -- a draft is a list somebody is still editing, and treating it
 *  as a buying habit would let an abandoned order shape what gets offered. Takes the
 *  same scope fragment as readOrders so it cannot see further than the list beside it.
 */
export function productMixFor(
  db: DatabaseSync,
  scope: { sql: string; params: number[] },
  customerId: number
): ProductMixRow[] {
  const rows = db
    .prepare(
      `SELECT ol.product_id, p.name AS product_name,
              ol.packs_ordered, ol.packs_delivered, ol.unit_price_toman, ol.unit_cost_toman,
              ol.qty_per_pack, ol.kg_per_base_unit
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
         JOIN products p ON p.id = ol.product_id
        WHERE o.customer_id = ?
          AND o.status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})${scope.sql}`
    )
    .all(customerId, ...scope.params) as unknown as (LineSnapshot & {
    product_id: number;
    product_name: string;
  })[];

  const byProduct = new Map<number, ProductMixRow>();
  for (const line of rows) {
    const existing = byProduct.get(line.product_id) ?? {
      product_id: line.product_id,
      product_name: line.product_name,
      packs: 0,
      total_toman: 0,
    };
    existing.packs += effectivePacks(line);
    existing.total_toman += lineTotalToman(line);
    byProduct.set(line.product_id, existing);
  }

  return [...byProduct.values()].sort((a, b) => b.total_toman - a.total_toman);
}
