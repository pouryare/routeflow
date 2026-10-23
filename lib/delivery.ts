/** A driver's day: which orders, what actually left the van, and what came back as cash.
 *
 *  The important idea is that delivery is where an order's quantities become final.
 *  packs_ordered was agreed on the phone; packs_delivered is what the customer took, and
 *  the invoice, the weight and the commission all follow the second number. Recording a
 *  short delivery is therefore not an edit to a confirmed order -- it is the order
 *  reaching its real value for the first time.
 */

import { refreshOrderFigures } from "./repo/orderFigures";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import {
  orderTotalToman,
  lineTotalToman,
  lineCostToman,
  lineKg,
  type LineSnapshot,
} from "./orderMath";
import { postDeliveryRecognition } from "./repo/ledgerPostings";
import { deliverFromVan, vanFacilityFor } from "./repo/vanStock";
import { sumToman } from "./money";
import { recordPaymentTxn, voidPaymentTxn, recomputeOrderPaymentTxn } from "./repo/payments";
import { allocateFEFO, recordMovementsTxn, defaultFacilityId } from "./repo/stock";
import { advanceOrder } from "./repo/orders";
import { tryEmitEvent } from "./repo/events";
import { planDelivery, deliveryForStop } from "./repo/deliveries";
import { tombstone } from "./repo/tombstones";
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
  /** F132: the driver sees an urgent stop tagged. */
  priority: string;
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
  /** The load and the unload, addresses included. Never numbered: the unload has no
   *  position at all, and giving it one would let a drag renumber the whole day. */
  facilities: RunFacilityStop[];
  remaining: number;
  to_collect_toman: number;
  collected_toman: number;
}

/** A building the run visits — to load from, or to come back to.
 *
 *  `address`/`lat`/`lng` come from `facilities` and may be null, because a place can exist
 *  before anyone has put it on the map. A card is still shown when they are; the driver just
 *  sees «هنوز مکان مشخص نیست» instead of an address, which is the truth. */
export interface RunFacilityStop {
  id: number;
  facility_id: number;
  role: "load" | "unload";
  status: "pending" | "done";
  done_at: string | null;
  notes: string | null;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  kind: string;
  icon_key: string | null;
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
  // A run belongs to a DRIVER by definition, and driving is a HELD role, not a primary one.
  // Assigning one to a manager would make a day of stops that nothing in the driver app can
  // reach; refusing a driver who also sells would do the same, silently.
  const canDrive = db
    .prepare("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'delivery_driver'")
    .get(input.driver_user_id);
  if (!canDrive) throw new DeliveryError("این حساب راننده تحویل نیست");

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

/** Deletes a run, and with it everything that was only ever PLANNED for it.
 *
 *  The guards are the whole function. A run is deletable while it is still a PLAN — not
 *  finished, no stop handed over, no delivery past PLANNED. Past that it stops being a plan
 *  and becomes a record, and the ledger, the commission accrual and the customer's statement
 *  all point at it.
 *
 *  The order of operations is not a style choice. `addStop` creates a `deliveries` row per
 *  stop, and `deliveries.route_stop_id` has NO ON DELETE CASCADE — so deleting the run first
 *  dies on the foreign key with an opaque 500. Stops are therefore released explicitly: the
 *  planned delivery goes (its `delivery_lines` cascade with it), the order falls back to
 *  CONFIRMED, and only then does the run go and take its stops with it — that FK *is* a
 *  cascade, so the stops need no statement of their own.
 */
export function deleteRun(db: DatabaseSync, runId: number): { releasedOrderIds: number[] } {
  const run = db.prepare("SELECT id, status, organization_id FROM delivery_runs WHERE id = ?").get(runId) as
    | { id: number; status: string; organization_id: number | null }
    | undefined;
  if (!run) throw new DeliveryError("مسیر پیدا نشد");

  if (run.status === "done") {
    throw new DeliveryError("مسیر بسته‌شده حذف نمی‌شود");
  }

  const stops = db
    .prepare("SELECT id, order_id, status FROM delivery_stops WHERE run_id = ?")
    .all(runId) as { id: number; order_id: number; status: string }[];

  const worked = stops.filter((s) => s.status !== "pending");
  if (worked.length > 0) {
    throw new DeliveryError(`${worked.length} توقف این مسیر تحویل شده و حذف نمی‌شود`);
  }

  /* A delivery past PLANNED is a fact about the world rather than a plan about it, and it is
     checked separately from the stop status: a delivery can be recorded against a stop that
     still says 'pending' if the writer updated one and not the other. */
  const recorded = db
    .prepare(
      `SELECT COUNT(*) AS n FROM deliveries d
         JOIN delivery_stops ds ON ds.id = d.route_stop_id
        WHERE ds.run_id = ? AND d.status <> 'PLANNED'`
    )
    .get(runId) as { n: number };
  if (recorded.n > 0) {
    throw new DeliveryError("این مسیر سابقهٔ تحویل ثبت‌شده دارد و حذف نمی‌شود");
  }

  // Read before the loop below deletes them, for the tombstones after the run goes.
  const plannedDeliveries = db
    .prepare(
      `SELECT d.id FROM deliveries d JOIN delivery_stops ds ON ds.id = d.route_stop_id WHERE ds.run_id = ?`
    )
    .all(runId) as { id: number }[];
  const dropDelivery = db.prepare("DELETE FROM deliveries WHERE route_stop_id = ?");
  /* Back to CONFIRMED, and only from the states PLANNING can put an order into. A
     write-through guard rather than an unconditional reset: this loop also runs over stops
     whose order has since moved on, and undoing a run must not silently rewind that order
     to a state its owner has already moved it past. */
  const releaseOrder = db.prepare(
    "UPDATE orders SET status = 'CONFIRMED', updated_at = ? WHERE id = ? AND status IN ('PLANNED', 'READY')"
  );
  const now = new Date().toISOString();
  for (const s of stops) {
    dropDelivery.run(s.id);
    releaseOrder.run(now, s.order_id);
  }

  /* Captured BEFORE the delete, and from the rows already in hand — reading them back
     afterwards would query a table whose rows this function has just removed, and return an
     empty list that makes the undo button a lie. */
  const releasedOrderIds = stops
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((s) => s.order_id);

  /* Phones that pulled this run keep it in their offline copy until told otherwise. The
     stops, facility stops and unload lines go by cascade, so their ids are read first. */
  const gone: [string, number][] = [["delivery_runs", runId]];
  for (const s of stops) gone.push(["delivery_stops", s.id]);
  for (const t of ["lead_run_stops", "run_facility_stops", "run_unload_lines"] as const) {
    for (const r of db.prepare(`SELECT id FROM ${t} WHERE run_id = ?`).all(runId) as { id: number }[]) {
      gone.push([t, r.id]);
    }
  }
  for (const d of plannedDeliveries) gone.push(["deliveries", d.id]);

  db.prepare("DELETE FROM delivery_runs WHERE id = ?").run(runId);
  if (run.organization_id !== null) {
    for (const [table, id] of gone) tombstone(run.organization_id, table, id, db);
  }

  /* The released orders, so the caller can put them back on a run of the same shape. A
     delete that returned nothing would offer "برگرداندن" for a route whose stops have
     silently scattered back to the pool. */
  return { releasedOrderIds };
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

  /* The load and the unload, WITH the facility's address and its coordinates.
   *
   * These join `facilities` rather than carrying only its id, for one specific reason: this
   * screen renders in a van with no signal, and the driver's ability to answer «where am I
   * going?» must not depend on a lookup that has not arrived. A card that says
   * «بارگیری · انبار بکه» with nothing under it is not a degraded view, it is a dead end. */
  const facilities = db
    .prepare(
      `SELECT rfs.id, rfs.facility_id, rfs.role, rfs.status, rfs.done_at, rfs.notes,
              f.name, f.address, f.lat, f.lng, f.kind, f.icon_key
         FROM run_facility_stops rfs
         JOIN facilities f ON f.id = rfs.facility_id
        WHERE rfs.run_id = ?
        ORDER BY CASE rfs.role WHEN 'load' THEN 0 ELSE 1 END`
    )
    .all(runId) as unknown as RunFacilityStop[];

  const stopRows = db
    .prepare(
      `SELECT ds.id, ds.order_id, ds.status, ds.collected_toman, ds.sort_order, ds.notes,
              o.order_no, o.priority, o.customer_id,
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
    facilities,
    // The load and the unload are work too, so "remaining" counts them. A driver told "0
    // remaining" who still has to unload a van has been told a lie by arithmetic.
    remaining:
      stops.filter((s) => s.status === "pending").length +
      facilities.filter((f) => f.status === "pending").length,
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

/** Everything the steps of one door event share. Built once by recordDelivery and handed to each step. */
interface DoorContext {
  db: DatabaseSync;
  stopId: number;
  stop: {
    id: number;
    run_id: number;
    order_id: number;
    status: string;
    customer_id: number;
    order_no: string;
    organization_id: number;
    customer_name: string;
    driver_user_id: number;
  };
  input: DeliveryInput;
  byId: Map<number, { id: number; packs_ordered: number; product_id: number; qty_per_pack: number }>;
  now: string;
  orgId: number;
  stockOrgId: number;
  nothingTaken: boolean;
  someShort: boolean;
  total: number;
  statusNow: () => OrderStatus;
}

function debitVan(c: DoorContext): void {
  const { stop, input, byId } = c;
  /* The van's balance leaves the van HERE, and only here.
   *
   * deliverFromVan was written for this and had no caller, so goods loaded in the morning
   * and delivered at noon were never tracked as having left -- which is why the end-of-day
   * reconciliation had nothing true to compare against.
   *
   * The condition is PER LINE and PER QUANTITY, not "the delivery succeeded". That is the
   * whole point: a refused stop writes no deliveries row, its goods never left, and the
   * `qty > 0` test is false for every line so nothing fires. A partial delivers 4 of 10 and
   * only 4 leaves. Tying this to the stop's status instead would debit the van for goods
   * that are still sitting on it.
   *
   * Skipped and pending stops never reach here at all.
   *
   * A driver with no van on file gets a null facility and no movement -- NOT a throw. Their
   * delivery is real and must still be recorded; the missing van is a separate problem for
   * somebody else to notice, and failing the door event over it would lose the delivery. */
  const vanFacility = vanFacilityFor(stop.organization_id, stop.driver_user_id);
  if (vanFacility !== null) {
    for (const line of input.lines) {
      const target = byId.get(line.line_id);
      if (!target) continue; // already rejected above; unreachable
      const packs = line.packs_delivered * target.qty_per_pack;
      if (packs > 0) {
        deliverFromVan(stop.organization_id, {
          facilityId: vanFacility,
          productId: target.product_id,
          qty: packs,
          actorId: input.by,
        });
      }
    }
  }
}

function advanceDoorOrder(c: DoorContext): void {
  const { db, stop, input, orgId, nothingTaken, someShort, statusNow } = c;
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
      { id: input.by, role: "delivery_driver" },
      { db, reason_code_id: nothingTaken ? input.fail_reason_id ?? null : null }
    );
    if (nothingTaken) {
      // Phase 7: a failed delivery is a rule trigger.
      tryEmitEvent(
        orgId,
        {
          kind: "delivery.failed",
          entity_type: "order",
          entity_id: stop.order_id,
          actor_user_id: input.by,
          metadata: { customer_id: stop.customer_id, fail_reason_id: input.fail_reason_id ?? null },
        },
        db
      );
    } else {
      // Phase 1 notifications: a partial OR full delivery is its own event, so both
      // order actions (deliver / deliverPartial) feed one notification type without the
      // feed rules special-casing two verbs. Best-effort, joins this transaction.
      tryEmitEvent(
        orgId,
        {
          kind: "delivery.succeeded",
          entity_type: "order",
          entity_id: stop.order_id,
          actor_user_id: input.by,
          metadata: {
            customer_id: stop.customer_id,
            customer_name: stop.customer_name,
            order_no: stop.order_no,
            partial: someShort,
          },
        },
        db
      );
    }
  }
}

function settleDoorPayment(c: DoorContext): void {
  const { db, stopId, stop, input, now, nothingTaken, total } = c;
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
}

function drawDeliveredStock(c: DoorContext): void {
  const { db, stopId, input, byId, now, stockOrgId, nothingTaken } = c;
  // Phase 2: draw the delivered quantity from stock, FEFO. The DELIVERY_OUT movements
  // and delivery_line_batches rows this writes are machine-generated within this one
  // atomic delivery record and carry no independent history -- so a retried sync just
  // deletes and re-writes them, converging like the payment above.
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
}

function recogniseRevenue(c: DoorContext): void {
  const { db, stopId, stop, input, now, stockOrgId, nothingTaken } = c;
  /* Revenue and cost, recognised when the goods MOVE -- not on the order, and not on the
     payment (which posts its own Dr cash / Cr AR journal). The two are separate journals
     because the cash arriving and the goods moving are separate events, and recognising
     revenue on payment is wrong even when the numbers happen to agree.

     Inside this transaction, using the caller's db. postJournal opens NOTHING of its own,
     and a nested BEGIN throws in SQLite -- this is the crash Task 2 spent a mutation
     proving, and this is the call site it would have hit first.

     Revenue uses lineTotalToman / lineCostToman, which both read effectivePacks, so a
     PARTIAL delivery recognises only the partial amount.

     Cost is the FROZEN ol.unit_cost_toman, not a live lookup. lib/orders.ts:140-166 is
     explicit that the cost lookup "happens once, at sale, and the ANSWER is frozen onto
     the line so a deliberate correction later cannot rewrite what the books already hold"
     -- and the plan for this task proposed re-resolving cost live via effectiveCost /
     avgCostFor, which would let a purchase arriving today restate yesterday's cost of
     goods. That is precisely the drift the codebase went out of its way to prevent.

     unit_cost_toman DEFAULTs to 0, which is how "never purchased, so nothing is known" is
     recorded. So one line at zero means the WHOLE cost is unknown, and revenue posts
     alone -- a partial cost that silently excluded one line's real cost would be worse
     than no cost at all. */
  if (!nothingTaken) {
    const orderLines = stopLines(db, stop.order_id);
    let revenueToman = 0;
    let costToman = 0;
    let costKnown = true;
    for (const line of orderLines) {
      revenueToman += line.total_toman;
      if (line.unit_cost_toman > 0) costToman += lineCostToman(line);
      else costKnown = false;
    }
    postDeliveryRecognition(db, {
      organizationId: stockOrgId,
      deliveryStopId: stopId,
      customerId: stop.customer_id,
      deliveredAt: now,
      deliveredBy: input.by,
      revenueToman: sumToman([revenueToman]),
      costToman: costKnown && costToman > 0 ? sumToman([costToman]) : null,
    });
  }
}

function syncDeliveryEntity(c: DoorContext): void {
  const { db, stopId, stop, input, byId, now, stockOrgId, nothingTaken, someShort } = c;
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
      `SELECT s.id, s.run_id, s.order_id, s.status, o.customer_id, o.order_no, o.organization_id,
              c.business_name AS customer_name,
              dr.driver_user_id, dr.organization_id AS run_org
         FROM delivery_stops s
         JOIN orders o ON o.id = s.order_id
         JOIN customers c ON c.id = o.customer_id
         JOIN delivery_runs dr ON dr.id = s.run_id
        WHERE s.id = ?`
    )
    .get(stopId) as
    | {
        id: number;
        run_id: number;
        order_id: number;
        status: string;
        customer_id: number;
        order_no: string;
        organization_id: number;
        customer_name: string;
        driver_user_id: number;
      }
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
    refreshOrderFigures(db, stop.order_id);

    // Re-read after writing, so the total is the delivered one rather than the ordered.
    const lines = stopLines(db, stop.order_id);
    const total = orderTotalToman(lines);
    const nothingTaken = lines.every((l) => (l.packs_delivered ?? l.packs_ordered) === 0);
    const someShort =
      !nothingTaken && lines.some((l) => (l.packs_delivered ?? 0) < l.packs_ordered);

    const orgId = stop.organization_id || 1;
    const stockOrgId = orgId;
    const statusNow = (): OrderStatus =>
      (db.prepare("SELECT status FROM orders WHERE id = ?").get(stop.order_id) as { status: OrderStatus }).status;
    const ctx: DoorContext = { db, stopId, stop, input, byId, now, orgId, stockOrgId, nothingTaken, someShort, total, statusNow };

    debitVan(ctx);

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
    advanceDoorOrder(ctx);

    settleDoorPayment(ctx);

    drawDeliveredStock(ctx);

    recogniseRevenue(ctx);

    syncDeliveryEntity(ctx);

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

    closeRunIfFinished(db, stop.run_id, now);

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** The last stop of the day CLOSES the run — and records how long it took.
 *
 *  Nothing did this until now. `delivery_runs.status = 'done'` was written by nothing at all,
 *  and `started_at` by nothing either, so `capacityLearning`'s WHERE clause —
 *  `status = 'done' AND planned_duration_min IS NOT NULL AND actual_duration_min IS NOT NULL`
 *  — could never be satisfied. It has been returning zero rows on every refresh since it
 *  was written, which means `resolvedCapacityFactorsFor` (read by /sales/forecast and the
 *  weather system) has been reading FACTORY DEFAULTS forever. Its test passes because it
 *  inserts the value by hand.
 *
 *  Actual duration is from `started_at`, not from midnight. A day that begins at 8am is not
 *  a 16-hour day, and measuring it as one would teach the model that vans are twice as slow
 *  as they are.
 *
 *  Idempotent: `AND actual_duration_min IS NULL` means a retried sync converges rather than
 *  overwriting a real measurement with a different one. */
function closeRunIfFinished(db: DatabaseSync, runId: number, now: string): void {
  const run = db
    .prepare(
      `SELECT r.id, r.started_at, r.finished_at, r.actual_duration_min,
              (SELECT COUNT(*) FROM delivery_stops ds
                WHERE ds.run_id = r.id AND ds.status = 'pending') AS pending_stops,
              (SELECT COUNT(*) FROM run_facility_stops f
                WHERE f.run_id = r.id AND f.status = 'pending') AS pending_facilities
         FROM delivery_runs r WHERE r.id = ?`
    )
    .get(runId) as
    | {
        started_at: string | null;
        finished_at: string | null;
        actual_duration_min: number | null;
        pending_stops: number;
        pending_facilities: number;
      }
    | undefined;
  if (!run) return;
  if (run.finished_at !== null) return; // already closed
  if (run.pending_stops > 0 || run.pending_facilities > 0) return; // more to do

  // Started but never begun: no honest duration exists, so none is invented. `started_at` is
  // NULL for a run assembled the night before, and a number derived from midnight would be
  // wrong by twelve hours rather than merely missing.
  const actual =
    run.started_at === null
      ? null
      : Math.max(1, Math.round((Date.parse(now) - Date.parse(run.started_at)) / 60000));

  db.prepare(
    `UPDATE delivery_runs
        SET status = 'done', finished_at = ?,
            actual_duration_min = COALESCE(actual_duration_min, ?), updated_at = ?
      WHERE id = ?`
  ).run(now, actual, now, runId);
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

/** «Later»: a driver sends a stop they cannot do now to the end of their run. Only a stop that is
 *  still pending moves (a delivered or refused one is finished), and only within its own run, so the
 *  order of everyone else's stops is untouched. It is not a new state: the stop stays pending and
 *  simply comes last, which is what skipping a door for now means in practice. Idempotent: a stop
 *  already last stays last. */
export function deferStop(db: DatabaseSync, stopId: number): { moved: boolean } {
  const stop = db
    .prepare("SELECT id, run_id, status FROM delivery_stops WHERE id = ?")
    .get(stopId) as { id: number; run_id: number; status: string } | undefined;
  if (!stop) throw new DeliveryError("توقف پیدا نشد");
  if (stop.status !== "pending") throw new DeliveryError("این توقف تعیین‌تکلیف شده و جابه‌جا نمی‌شود");
  const last = db
    .prepare("SELECT id, sort_order FROM delivery_stops WHERE run_id = ? ORDER BY sort_order DESC, id DESC LIMIT 1")
    .get(stop.run_id) as { id: number; sort_order: number };
  if (last.id === stop.id) return { moved: false };
  db.prepare("UPDATE delivery_stops SET sort_order = ? WHERE id = ?").run(last.sort_order + 1, stop.id);
  return { moved: true };
}
