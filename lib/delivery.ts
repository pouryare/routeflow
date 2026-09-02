/** A driver's day: which orders, what actually left the van, and what came back as cash.
 *
 *  The important idea is that delivery is where an order's quantities become final.
 *  packs_ordered was agreed on the phone; packs_delivered is what the customer took, and
 *  the invoice, the weight and the commission all follow the second number. Recording a
 *  short delivery is therefore not an edit to a confirmed order -- it is the order
 *  reaching its real value for the first time.
 */

import type { DatabaseSync } from "node:sqlite";
import { orderTotalToman, lineTotalToman, lineKg, type LineSnapshot } from "./orderMath";
import { recordPaymentTxn, voidPaymentTxn, recomputeOrderPaymentTxn } from "./repo/payments";

export class DeliveryError extends Error {}

export interface RunStopLine extends LineSnapshot {
  id: number;
  product_name: string;
  packaging_name: string;
  total_toman: number;
  kg: number;
}

export interface RunStop {
  id: number;
  order_id: number;
  order_no: string;
  customer_id: number;
  customer_name: string;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  collected_toman: number;
  sort_order: number;
  notes: string | null;
  lines: RunStopLine[];
  total_toman: number;
}

export interface RunDetail {
  id: number;
  driver_user_id: number;
  driver_name: string;
  run_date: string;
  status: string;
  stops: RunStop[];
  remaining: number;
  to_collect_toman: number;
  collected_toman: number;
}

export function createRun(
  db: DatabaseSync,
  input: {
    driver_user_id: number;
    run_date: string;
    created_by: number;
    /** Required, not optional: delivery_runs is a tenant table, and a run with a NULL
     *  organisation slips past every owner/organisation filter unnoticed. */
    organization_id: number;
    group_id?: number | null;
  }
): number {
  const driver = db
    .prepare("SELECT id, role, group_id FROM users WHERE id = ? AND active = 1")
    .get(input.driver_user_id) as { role: string; group_id: number | null } | undefined;

  if (!driver) throw new DeliveryError("راننده پیدا نشد");
  // A run belongs to a driver by definition. Assigning one to a manager would make a
  // day of stops that nothing in the driver app can reach.
  if (driver.role !== "driver") throw new DeliveryError("این حساب راننده نیست");

  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO delivery_runs (driver_user_id, group_id, run_date, created_by, created_at, updated_at, organization_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.driver_user_id,
        input.group_id ?? driver.group_id,
        input.run_date.slice(0, 10),
        input.created_by,
        now,
        now,
        input.organization_id
      ).lastInsertRowid
  );
}

/** Puts a confirmed order on a run.
 *
 *  Draft orders are refused: a draft is a shopping list somebody is still editing, and
 *  loading a van from one means the quantities can change after it has left. */
export function addStop(db: DatabaseSync, runId: number, orderId: number, sortOrder = 0): number {
  const order = db
    .prepare("SELECT id, status, credit_hold FROM orders WHERE id = ?")
    .get(orderId) as { status: string; credit_hold: number } | undefined;
  if (!order) throw new DeliveryError("سفارش پیدا نشد");
  if (order.status === "draft") {
    throw new DeliveryError("سفارش پیش‌نویس روی مسیر قرار نمی‌گیرد؛ اول تأییدش کنید");
  }
  if (order.credit_hold) {
    throw new DeliveryError("سفارش در انتظار تأیید اعتبار است و روی مسیر قرار نمی‌گیرد");
  }

  return Number(
    db
      .prepare(
        "INSERT INTO delivery_stops (run_id, order_id, sort_order, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(runId, orderId, sortOrder, new Date().toISOString()).lastInsertRowid
  );
}

function stopLines(db: DatabaseSync, orderId: number): RunStopLine[] {
  const rows = db
    .prepare(
      `SELECT ol.*, p.name AS product_name, pk.name AS packaging_name
         FROM order_lines ol
         JOIN products p ON p.id = ol.product_id
         JOIN packagings pk ON pk.id = ol.packaging_id
        WHERE ol.order_id = ?
        ORDER BY ol.id`
    )
    .all(orderId) as unknown as (RunStopLine & LineSnapshot)[];

  return rows.map((row) => ({ ...row, total_toman: lineTotalToman(row), kg: lineKg(row) }));
}

export function readRun(db: DatabaseSync, runId: number): RunDetail | null {
  const run = db
    .prepare(
      `SELECT dr.*, u.display_name AS driver_name
         FROM delivery_runs dr JOIN users u ON u.id = dr.driver_user_id
        WHERE dr.id = ?`
    )
    .get(runId) as unknown as RunDetail | undefined;
  if (!run) return null;

  const stopRows = db
    .prepare(
      `SELECT ds.id, ds.order_id, ds.status, ds.collected_toman, ds.sort_order, ds.notes,
              o.order_no, o.customer_id,
              c.business_name AS customer_name, c.address, c.phone, c.lat, c.lng
         FROM delivery_stops ds
         JOIN orders o ON o.id = ds.order_id
         JOIN customers c ON c.id = o.customer_id
        WHERE ds.run_id = ?
        ORDER BY ds.sort_order, ds.id`
    )
    .all(runId) as unknown as Omit<RunStop, "lines" | "total_toman">[];

  const stops: RunStop[] = stopRows.map((stop) => {
    const lines = stopLines(db, stop.order_id);
    return { ...stop, lines, total_toman: orderTotalToman(lines) };
  });

  return {
    ...run,
    stops,
    remaining: stops.filter((s) => s.status === "pending").length,
    to_collect_toman: stops
      .filter((s) => s.status === "pending")
      .reduce((sum, s) => sum + s.total_toman, 0),
    collected_toman: stops.reduce((sum, s) => sum + s.collected_toman, 0),
  };
}

export interface DeliveryInput {
  lines: { line_id: number; packs_delivered: number }[];
  collected_toman: number;
  by: number;
  notes?: string | null;
}

/** Records what happened at one door.
 *
 *  Everything moves together in a transaction: the delivered quantities, the stop's
 *  status, the order's status and the payment. A driver at a doorstep on a weak
 *  connection is exactly the situation where half of this landing would be worst --
 *  an order marked delivered with no quantities is an invoice for nothing.
 */
export function recordDelivery(db: DatabaseSync, stopId: number, input: DeliveryInput): void {
  const stop = db
    .prepare(
      `SELECT s.id, s.order_id, s.status, o.customer_id, o.organization_id
         FROM delivery_stops s JOIN orders o ON o.id = s.order_id
        WHERE s.id = ?`
    )
    .get(stopId) as
    | { order_id: number; status: string; customer_id: number; organization_id: number }
    | undefined;
  if (!stop) throw new DeliveryError("توقف پیدا نشد");

  const ordered = db
    .prepare("SELECT id, packs_ordered FROM order_lines WHERE order_id = ?")
    .all(stop.order_id) as unknown as { id: number; packs_ordered: number }[];
  const byId = new Map(ordered.map((l) => [l.id, l]));

  for (const line of input.lines) {
    const target = byId.get(line.line_id);
    // A line id from another order would otherwise write a delivered quantity onto
    // somebody else's invoice, which is both wrong and hard to trace back.
    if (!target) throw new DeliveryError("این قلم به این سفارش تعلق ندارد");
    if (!Number.isFinite(line.packs_delivered) || line.packs_delivered < 0) {
      throw new DeliveryError("تعداد تحویل‌شده معتبر نیست");
    }
    // Almost always a typo at the door, and the number goes straight onto an invoice.
    if (line.packs_delivered > target.packs_ordered) {
      throw new DeliveryError("تعداد تحویل‌شده از تعداد سفارش بیشتر است");
    }
  }

  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const setLine = db.prepare("UPDATE order_lines SET packs_delivered = ? WHERE id = ?");
    for (const line of input.lines) setLine.run(line.packs_delivered, line.line_id);

    // Re-read after writing, so the total is the delivered one rather than the ordered.
    const lines = stopLines(db, stop.order_id);
    const total = orderTotalToman(lines);
    const nothingTaken = lines.every((l) => (l.packs_delivered ?? l.packs_ordered) === 0);

    const stopStatus = nothingTaken ? "refused" : "delivered";
    db.prepare(
      `UPDATE delivery_stops
          SET status = ?, collected_toman = ?, delivered_at = ?, delivered_by = ?, notes = COALESCE(?, notes)
        WHERE id = ?`
    ).run(stopStatus, input.collected_toman, now, input.by, input.notes ?? null, stopId);

    db.prepare(
      `UPDATE orders
          SET status = ?, delivered_at = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      // Nothing taken is not a delivery. Leaving it 'delivered' would put a zero-value
      // invoice in the ledger and count the stop as served.
      nothingTaken ? "cancelled" : "delivered",
      nothingTaken ? null : now,
      now,
      stop.order_id
    );

    // Cash handed over at the door is a real payment now, not a number stamped onto the
    // order. recordPaymentTxn writes the ledger row, allocates it to this order (the
    // overpay slice, if any, lands on the customer's account), and recomputes
    // orders.paid_toman + payment_status from the allocation -- same figures as before,
    // now with a row behind them.
    //
    // Keyed to the stop so a retried sync converges rather than stacking: an existing,
    // non-voided door payment for this stop with the same amount is left alone; a
    // different amount voids the old row and writes a fresh one.
    const priorDoorPayment = db
      .prepare(
        "SELECT id, amount_toman FROM payments WHERE delivery_stop_id = ? AND voided_at IS NULL"
      )
      .get(stopId) as { id: number; amount_toman: number } | undefined;

    const wantPayment = !nothingTaken && input.collected_toman > 0;
    const alreadyRight =
      priorDoorPayment && wantPayment && priorDoorPayment.amount_toman === input.collected_toman;

    if (priorDoorPayment && !alreadyRight) {
      voidPaymentTxn(db, stop.organization_id, priorDoorPayment.id, input.by, "بازثبت تحویل");
    }

    if (wantPayment && !alreadyRight) {
      const onOrder = Math.min(input.collected_toman, total);
      const allocations: { order_id: number | null; amount_toman: number }[] = [
        { order_id: stop.order_id, amount_toman: onOrder },
      ];
      if (input.collected_toman > total) {
        allocations.push({ order_id: null, amount_toman: input.collected_toman - total });
      }
      recordPaymentTxn(db, stop.organization_id, {
        customer_id: stop.customer_id,
        amount_toman: input.collected_toman,
        method: "CASH",
        received_at: now,
        received_by: input.by,
        delivery_stop_id: stopId,
        note: "دریافت درِ محل",
        allocations,
        // The cash in the driver's hand is the authoritative figure; never let a
        // cap check roll back a delivery that actually happened.
        allow_overpay: true,
      });
    } else if (!wantPayment) {
      // A retry that now collects nothing (or refuses the stop) must also clear the
      // cache the earlier attempt set.
      recomputeOrderPaymentTxn(db, stop.organization_id, stop.order_id);
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export interface RunSummary {
  id: number;
  run_date: string;
  status: string;
  stop_count: number;
  remaining: number;
}

export function readDriverRuns(db: DatabaseSync, driverUserId: number): RunSummary[] {
  return db
    .prepare(
      `SELECT dr.id, dr.run_date, dr.status,
              COUNT(ds.id) AS stop_count,
              SUM(CASE WHEN ds.status = 'pending' THEN 1 ELSE 0 END) AS remaining
         FROM delivery_runs dr
         LEFT JOIN delivery_stops ds ON ds.run_id = dr.id
        WHERE dr.driver_user_id = ?
        GROUP BY dr.id
        ORDER BY dr.run_date DESC, dr.id DESC`
    )
    .all(driverUserId) as unknown as RunSummary[];
}
