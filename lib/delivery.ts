/** A driver's day: which orders, what actually left the van, and what came back as cash.
 *
 *  The important idea is that delivery is where an order's quantities become final.
 *  packs_ordered was agreed on the phone; packs_delivered is what the customer took, and
 *  the invoice, the weight and the commission all follow the second number. Recording a
 *  short delivery is therefore not an edit to a confirmed order -- it is the order
 *  reaching its real value for the first time.
 */

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import { orderTotalToman, lineTotalToman, lineKg, type LineSnapshot } from "./orderMath";
import { recordPaymentTxn, voidPaymentTxn, recomputeOrderPaymentTxn } from "./repo/payments";
import { allocateFEFO, recordMovementsTxn, defaultFacilityId } from "./repo/stock";
import { advanceOrder } from "./repo/orders";
import { planDelivery, deliveryForStop } from "./repo/deliveries";
import type { OrderStatus } from "./orderStateMachine";

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
export function addStop(
  db: DatabaseSync,
  runId: number,
  orderId: number,
  sortOrder = 0,
  opts: { force?: boolean } = {}
): number {
  const order = db
    .prepare("SELECT id, status, credit_hold, organization_id FROM orders WHERE id = ?")
    .get(orderId) as
    | { status: string; credit_hold: number; organization_id: number | null }
    | undefined;
  if (!order) throw new DeliveryError("سفارش پیدا نشد");
  if (order.credit_hold) {
    throw new DeliveryError("سفارش در انتظار تأیید اعتبار است و روی مسیر قرار نمی‌گیرد");
  }
  if (!["CONFIRMED", "PLANNED", "READY"].includes(order.status)) {
    throw new DeliveryError("سفارش تأییدنشده روی مسیر قرار نمی‌گیرد؛ اول تأییدش کنید");
  }

  // Phase 5: after a route is frozen, adding to it is a deliberate act.
  const run = db.prepare("SELECT frozen_at FROM delivery_runs WHERE id = ?").get(runId) as
    | { frozen_at: string | null }
    | undefined;
  if (run?.frozen_at && !opts.force) {
    throw new DeliveryError("مسیر قطعی شده — افزودن سفارش نیاز به تصمیم صریح دارد");
  }

  const stopId = Number(
    db
      .prepare(
        "INSERT INTO delivery_stops (run_id, order_id, sort_order, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(runId, orderId, sortOrder, new Date().toISOString()).lastInsertRowid
  );

  // Phase 3 (M6): the stop gets its own delivery entity, and the order moves to PLANNED.
  planDelivery(order.organization_id ?? 1, orderId, { route_stop_id: stopId });

  // Phase 5: an add to a frozen route is worth a line in the audit trail.
  if (run?.frozen_at && opts.force) {
    db.prepare(
      `INSERT INTO order_events (organization_id, order_id, from_status, to_status, action, note, created_at)
       VALUES (?, ?, NULL, (SELECT status FROM orders WHERE id = ?), 'note', 'افزوده به مسیر قطعی‌شده', ?)`
    ).run(order.organization_id ?? 1, orderId, orderId, new Date().toISOString());
  }

  return stopId;
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
  /** Required-in-spirit when nothing is taken: why the delivery failed (a reason_codes id
   *  in the `delivery_fail` domain). Recorded on the order_events row and the delivery. */
  fail_reason_id?: number | null;
  receiver_name?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  /** The client's own clock, kept beside the server timestamp. */
  device_time?: string | null;
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
    .prepare(
      "SELECT id, packs_ordered, product_id, qty_per_pack FROM order_lines WHERE order_id = ?"
    )
    .all(stop.order_id) as unknown as {
    id: number;
    packs_ordered: number;
    product_id: number;
    qty_per_pack: number;
  }[];
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
    const someShort =
      !nothingTaken && lines.some((l) => (l.packs_delivered ?? 0) < l.packs_ordered);

    const stopStatus = nothingTaken ? "refused" : "delivered";
    db.prepare(
      `UPDATE delivery_stops
          SET status = ?, collected_toman = ?, delivered_at = ?, delivered_by = ?, notes = COALESCE(?, notes)
        WHERE id = ?`
    ).run(stopStatus, input.collected_toman, now, input.by, input.notes ?? null, stopId);

    // Phase 3: the order moves through the machine. A door event is the driver at
    // OUT_FOR_DELIVERY, so walk the intermediate desk steps (plan/freeze/startRoute) as
    // 'system' -- each still lands its own order_events row -- then fire the real
    // outcome as the driver. A retried sync finds the order already past
    // OUT_FOR_DELIVERY and fires nothing.
    const orgId = stop.organization_id || 1;
    const statusNow = (): OrderStatus =>
      (db.prepare("SELECT status FROM orders WHERE id = ?").get(stop.order_id) as { status: OrderStatus }).status;
    const sys = { id: input.by, role: "system" as const };
    let st = statusNow();
    if (st === "CONFIRMED") {
      advanceOrder(orgId, stop.order_id, "plan", sys, { db });
      st = "PLANNED";
    }
    if (st === "PLANNED") {
      advanceOrder(orgId, stop.order_id, "freeze", sys, { db });
      st = "READY";
    }
    if (st === "READY") {
      advanceOrder(orgId, stop.order_id, "startRoute", sys, { db });
      st = "OUT_FOR_DELIVERY";
    }
    if (st === "OUT_FOR_DELIVERY") {
      const action = nothingTaken ? "failDelivery" : someShort ? "deliverPartial" : "deliver";
      advanceOrder(
        orgId,
        stop.order_id,
        action,
        { id: input.by, role: "driver" },
        { db, reason_code_id: nothingTaken ? input.fail_reason_id ?? null : null }
      );
    }

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

    // Phase 2: draw the delivered quantity from stock, FEFO. The DELIVERY_OUT movements
    // and delivery_line_batches rows this writes are machine-generated within this one
    // atomic delivery record and carry no independent history -- so a retried sync just
    // deletes and re-writes them, converging like the payment above.
    const stockOrgId = stop.organization_id || 1;
    const facilityId = defaultFacilityId(stockOrgId);
    db.prepare(
      "DELETE FROM stock_movements WHERE ref_type = 'delivery_stop' AND ref_id = ? AND kind = 'DELIVERY_OUT'"
    ).run(stopId);
    db.prepare("DELETE FROM delivery_line_batches WHERE delivery_stop_id = ?").run(stopId);

    const insDlb = db.prepare(
      `INSERT INTO delivery_line_batches
         (organization_id, delivery_stop_id, order_line_id, batch_id, base_qty, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    if (!nothingTaken) {
      for (const line of input.lines) {
        if (!(line.packs_delivered > 0)) continue;
        const ol = byId.get(line.line_id)!;
        const baseQty = line.packs_delivered * ol.qty_per_pack;
        for (const a of allocateFEFO(stockOrgId, ol.product_id, baseQty, facilityId)) {
          recordMovementsTxn(db, stockOrgId, [
            {
              facility_id: facilityId,
              product_id: ol.product_id,
              batch_id: a.batch_id,
              base_qty: -a.base_qty,
              kind: "DELIVERY_OUT",
              ref_type: "delivery_stop",
              ref_id: stopId,
              occurred_at: now,
              created_by: input.by,
            },
          ]);
          insDlb.run(stockOrgId, stopId, line.line_id, a.batch_id, a.base_qty, now);
        }
      }
    }

    // Phase 3 (M6): keep the deliveries entity in step. Server owns actual_arrival /
    // completed_at -- input.device_time is stored beside them, never trusted as the time.
    let delivery = deliveryForStop(stockOrgId, stopId, db);
    if (!delivery) {
      planDelivery(stockOrgId, stop.order_id, { route_stop_id: stopId, db });
      delivery = deliveryForStop(stockOrgId, stopId, db);
    }
    if (delivery) {
      const dStatus = nothingTaken ? "FAILED" : someShort ? "PARTIAL" : "DELIVERED";
      db.prepare(
        `UPDATE deliveries
            SET status = ?, actual_arrival = COALESCE(actual_arrival, ?), completed_at = ?,
                collected_toman = ?, fail_reason_id = ?, receiver_name = COALESCE(?, receiver_name),
                gps_lat = COALESCE(?, gps_lat), gps_lng = COALESCE(?, gps_lng),
                device_time = COALESCE(?, device_time), notes = COALESCE(?, notes)
          WHERE id = ?`
      ).run(
        dStatus,
        now,
        now,
        input.collected_toman,
        nothingTaken ? input.fail_reason_id ?? null : null,
        input.receiver_name ?? null,
        input.gps_lat ?? null,
        input.gps_lng ?? null,
        input.device_time ?? null,
        input.notes ?? null,
        delivery.id
      );
      const dlSet = db.prepare(
        "UPDATE delivery_lines SET qty_delivered = ? WHERE delivery_id = ? AND order_line_id = ?"
      );
      for (const line of input.lines) {
        const ol = byId.get(line.line_id)!;
        dlSet.run(line.packs_delivered * ol.qty_per_pack, delivery.id, line.line_id);
      }
    }

    // A fully-settled delivered order closes itself.
    const afterStatus = statusNow();
    if (
      (afterStatus === "DELIVERED" || afterStatus === "PARTIALLY_DELIVERED") &&
      total > 0
    ) {
      const paid = (
        db.prepare("SELECT paid_toman FROM orders WHERE id = ?").get(stop.order_id) as {
          paid_toman: number;
        }
      ).paid_toman;
      if (total - paid <= 0) {
        advanceOrder(orgId, stop.order_id, "settle", { id: input.by, role: "system" }, { db });
      }
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export interface CompleteDeliveryInput {
  outcome: "delivered" | "partial" | "failed";
  lines?: { order_line_id: number; qty_delivered: number }[];
  fail_reason_id?: number | null;
  receiver_name?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  collected_toman?: number;
  device_time?: string | null;
  notes?: string | null;
}

/** The API-facing door event: resolve the delivery to its route stop and hand off to
 *  recordDelivery. `qty_delivered` here is BASE units (عدد); it is converted back to
 *  packs against each line's frozen qty_per_pack. A `failed` outcome sets every line to
 *  zero and requires a fail_reason_id. Server timestamps only -- any client time in the
 *  body is carried as device_time, never used as the time. */
export function completeDelivery(
  organizationId: number,
  deliveryId: number,
  actor: { id: number },
  input: CompleteDeliveryInput
): void {
  const db = getDb();
  const delivery = db
    .prepare("SELECT id, order_id, route_stop_id FROM deliveries WHERE id = ? AND organization_id = ?")
    .get(deliveryId, organizationId) as
    | { id: number; order_id: number; route_stop_id: number | null }
    | undefined;
  if (!delivery) throw new DeliveryError("تحویل پیدا نشد");
  if (delivery.route_stop_id == null) throw new DeliveryError("این تحویل روی هیچ توقفی نیست");
  if (input.outcome === "failed" && input.fail_reason_id == null) {
    throw new DeliveryError("برای ثبت تحویل ناموفق، دلیل لازم است");
  }

  const orderLines = db
    .prepare("SELECT id, packs_ordered, qty_per_pack FROM order_lines WHERE order_id = ?")
    .all(delivery.order_id) as unknown as {
    id: number;
    packs_ordered: number;
    qty_per_pack: number;
  }[];
  const wanted = new Map<number, number>((input.lines ?? []).map((l) => [l.order_line_id, l.qty_delivered]));

  const lines = orderLines.map((ol) => {
    if (input.outcome === "failed") return { line_id: ol.id, packs_delivered: 0 };
    const base = wanted.has(ol.id) ? wanted.get(ol.id)! : ol.packs_ordered * ol.qty_per_pack;
    return { line_id: ol.id, packs_delivered: base / ol.qty_per_pack };
  });

  recordDelivery(db, delivery.route_stop_id, {
    lines,
    collected_toman: input.collected_toman ?? 0,
    by: actor.id,
    notes: input.notes ?? null,
    fail_reason_id: input.fail_reason_id ?? null,
    receiver_name: input.receiver_name ?? null,
    gps_lat: input.gps_lat ?? null,
    gps_lng: input.gps_lng ?? null,
    device_time: input.device_time ?? null,
  });
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
