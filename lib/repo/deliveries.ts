import type { DatabaseSync } from "node:sqlite";
import { makeRepo } from "./base";
import { advanceOrder, registerOrderEffectHandlers } from "./orders";
import type { OrderRole } from "@/lib/orderStateMachine";

export class DeliveryEntityError extends Error {}

export type DeliveryStatus =
  | "PLANNED"
  | "ASSIGNED"
  | "LOADED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "PARTIAL"
  | "FAILED"
  | "RETURNED"
  | "CANCELLED";

export interface DeliveryRow {
  id: number;
  organization_id: number;
  order_id: number;
  seq: number;
  status: DeliveryStatus;
  route_stop_id: number | null;
  planned_date: string | null;
  planned_arrival: string | null;
  actual_arrival: string | null;
  completed_at: string | null;
  fail_reason_id: number | null;
  delay_reason_id: number | null;
  receiver_name: string | null;
  signature_path: string | null;
  photo_path: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  collected_toman: number;
  payment_id: number | null;
  device_time: string | null;
  notes: string | null;
  created_at: string;
}

export const deliveriesRepo = makeRepo<DeliveryRow>("deliveries", { tenant: true });

function connOf(db?: DatabaseSync): DatabaseSync {
  return db ?? deliveriesRepo.db();
}

/** Snapshot delivery_lines from the order's lines (qty_planned = ordered base units). */
function snapshotLines(conn: DatabaseSync, deliveryId: number, orderId: number): void {
  const lines = conn
    .prepare(
      "SELECT id, (packs_ordered * qty_per_pack) AS base FROM order_lines WHERE order_id = ? AND packs_ordered > 0"
    )
    .all(orderId) as unknown as { id: number; base: number }[];
  const ins = conn.prepare(
    "INSERT INTO delivery_lines (delivery_id, order_line_id, qty_planned) VALUES (?, ?, ?)"
  );
  for (const l of lines) ins.run(deliveryId, l.id, l.base);
}

/** Give a confirmed order a delivery row and move it to PLANNED. Idempotent per stop: a
 *  second call for the same route_stop_id returns the existing row. */
export function planDelivery(
  organizationId: number,
  orderId: number,
  opts: { route_stop_id?: number | null; planned_date?: string | null; db?: DatabaseSync } = {}
): number {
  const conn = connOf(opts.db);
  const run = (): number => {
    if (opts.route_stop_id != null) {
      const existing = conn
        .prepare(
          "SELECT id FROM deliveries WHERE route_stop_id = ? AND organization_id = ? ORDER BY seq DESC LIMIT 1"
        )
        .get(opts.route_stop_id, organizationId) as { id: number } | undefined;
      if (existing) return existing.id;
    }
    const order = conn
      .prepare("SELECT status FROM orders WHERE id = ? AND organization_id = ?")
      .get(orderId, organizationId) as { status: string } | undefined;
    if (!order) throw new DeliveryEntityError("سفارش پیدا نشد");

    const seq =
      ((
        conn
          .prepare("SELECT MAX(seq) AS m FROM deliveries WHERE order_id = ?")
          .get(orderId) as { m: number | null }
      ).m ?? 0) + 1;
    const now = new Date().toISOString();
    const id = Number(
      conn
        .prepare(
          `INSERT INTO deliveries
             (organization_id, order_id, seq, status, route_stop_id, planned_date, created_at)
           VALUES (?, ?, ?, 'PLANNED', ?, ?, ?)`
        )
        .run(organizationId, orderId, seq, opts.route_stop_id ?? null, opts.planned_date ?? null, now)
        .lastInsertRowid
    );
    snapshotLines(conn, id, orderId);
    if (order.status === "CONFIRMED") {
      advanceOrder(organizationId, orderId, "plan", { id: null, role: "system" }, { db: conn });
    }
    return id;
  };

  if (opts.db) return run();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const id = run();
    conn.exec("COMMIT");
    return id;
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

/** The latest delivery row for a route stop, or null. */
export function deliveryForStop(
  organizationId: number,
  routeStopId: number,
  db?: DatabaseSync
): DeliveryRow | undefined {
  return connOf(db)
    .prepare(
      "SELECT * FROM deliveries WHERE route_stop_id = ? AND organization_id = ? ORDER BY seq DESC LIMIT 1"
    )
    .get(routeStopId, organizationId) as DeliveryRow | undefined;
}

/** Freeze an order's plan: PLANNED -> READY. */
export function markReady(
  organizationId: number,
  orderId: number,
  actor: { id: number | null; role: OrderRole },
  db?: DatabaseSync
): void {
  advanceOrder(organizationId, orderId, "freeze", actor, { db });
  connOf(db)
    .prepare(
      "UPDATE deliveries SET status = 'LOADED' WHERE order_id = ? AND organization_id = ? AND status IN ('PLANNED','ASSIGNED')"
    )
    .run(orderId, organizationId);
}

/** A failed attempt gets a retry: the order goes back to PLANNED and a fresh delivery row
 *  (seq + 1) is opened. The failed row stays as the record. */
export function retryDelivery(
  organizationId: number,
  deliveryId: number,
  actor: { id: number | null; role: OrderRole },
  db?: DatabaseSync
): number {
  const conn = connOf(db);
  const run = (): number => {
    const d = deliveriesRepo.get(organizationId, deliveryId);
    if (!d) throw new DeliveryEntityError("تحویل پیدا نشد");
    if (d.status !== "FAILED") throw new DeliveryEntityError("فقط تحویل ناموفق دوباره برنامه‌ریزی می‌شود");
    advanceOrder(organizationId, d.order_id, "retryDelivery", actor, { db: conn });
    // A fresh delivery row for the same stop -- NOT via planDelivery, whose per-stop
    // idempotency would hand back the failed row.
    const seq =
      ((
        conn
          .prepare("SELECT MAX(seq) AS m FROM deliveries WHERE order_id = ?")
          .get(d.order_id) as { m: number | null }
      ).m ?? 0) + 1;
    const now = new Date().toISOString();
    const id = Number(
      conn
        .prepare(
          `INSERT INTO deliveries
             (organization_id, order_id, seq, status, route_stop_id, planned_date, created_at)
           VALUES (?, ?, ?, 'PLANNED', ?, ?, ?)`
        )
        .run(organizationId, d.order_id, seq, d.route_stop_id, d.planned_date, now).lastInsertRowid
    );
    snapshotLines(conn, id, d.order_id);
    return id;
  };
  if (db) return run();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const id = run();
    conn.exec("COMMIT");
    return id;
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

export interface DeliveryDetail extends DeliveryRow {
  order_no: string;
  customer_name: string;
  lines: { order_line_id: number; qty_planned: number; qty_delivered: number; qty_returned: number }[];
}

export function readDelivery(
  organizationId: number,
  deliveryId: number
): DeliveryDetail | undefined {
  const db = deliveriesRepo.db();
  const row = db
    .prepare(
      `SELECT d.*, o.order_no, c.business_name AS customer_name
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         JOIN customers c ON c.id = o.customer_id
        WHERE d.id = ? AND d.organization_id = ?`
    )
    .get(deliveryId, organizationId) as (DeliveryRow & { order_no: string; customer_name: string }) | undefined;
  if (!row) return undefined;
  const lines = db
    .prepare(
      "SELECT order_line_id, qty_planned, qty_delivered, qty_returned FROM delivery_lines WHERE delivery_id = ?"
    )
    .all(deliveryId) as unknown as DeliveryDetail["lines"];
  return { ...row, lines };
}

export function listDeliveries(
  organizationId: number,
  filter: { order_id?: number; run_id?: number } = {}
): (DeliveryRow & { order_no: string })[] {
  const db = deliveriesRepo.db();
  const clauses = ["d.organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (filter.order_id !== undefined) {
    clauses.push("d.order_id = ?");
    params.push(filter.order_id);
  }
  if (filter.run_id !== undefined) {
    clauses.push("ds.run_id = ?");
    params.push(filter.run_id);
  }
  return db
    .prepare(
      `SELECT d.*, o.order_no
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         LEFT JOIN delivery_stops ds ON ds.id = d.route_stop_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY d.order_id, d.seq`
    )
    .all(...(params as never[])) as unknown as (DeliveryRow & { order_no: string })[];
}

/** The `spawnBackorder` effect: a PARTIALLY_DELIVERED order that settles leaves a
 *  shortfall (planned - delivered per line). Copy that remainder into a fresh DRAFT so it
 *  can be re-ordered. Raw insert -- the price snapshot is carried over verbatim, not
 *  re-resolved, so a backorder invoices at the original agreed price. */
registerOrderEffectHandlers({
  spawnBackorder(conn, orgId, orderId) {
    const short = conn
      .prepare(
        `SELECT ol.id AS order_line_id, ol.product_id, ol.packaging_id, ol.unit_price_toman,
                ol.unit_cost_toman, ol.qty_per_pack, ol.kg_per_base_unit, ol.price_id,
                (COALESCE(dl.qty_planned, 0) - COALESCE(dl.qty_delivered, 0)) / ol.qty_per_pack AS packs_short
           FROM order_lines ol
           LEFT JOIN delivery_lines dl ON dl.order_line_id = ol.id
          WHERE ol.order_id = ? AND ol.is_reversal = 0`
      )
      .all(orderId) as unknown as {
      order_line_id: number;
      product_id: number;
      packaging_id: number | null;
      unit_price_toman: number;
      unit_cost_toman: number;
      qty_per_pack: number;
      kg_per_base_unit: number;
      price_id: number | null;
      packs_short: number;
    }[];
    const lines = short.filter((l) => l.packs_short > 1e-9);
    if (lines.length === 0) return;

    const parent = conn
      .prepare("SELECT customer_id, group_id, salesperson_user_id, order_date, created_by FROM orders WHERE id = ?")
      .get(orderId) as {
      customer_id: number;
      group_id: number | null;
      salesperson_user_id: number | null;
      order_date: string;
      created_by: number;
    };
    const now = new Date().toISOString();
    const jy = (parent.order_date || now).slice(0, 4);
    const maxNo = conn
      .prepare(
        "SELECT MAX(CAST(substr(order_no, 6) AS INTEGER)) AS m FROM orders WHERE organization_id = ? AND order_no LIKE ?"
      )
      .get(orgId, `${jy}-%`) as { m: number | null };
    const orderNo = `${jy}-${String((maxNo.m ?? 0) + 1).padStart(5, "0")}`;

    const newOrderId = Number(
      conn
        .prepare(
          `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, status,
                               order_type, order_date, notes, created_by, created_at, updated_at, organization_id)
           VALUES (?, ?, ?, ?, 'DRAFT', 'SALE', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          orderNo,
          parent.customer_id,
          parent.group_id,
          parent.salesperson_user_id,
          now.slice(0, 10),
          `باقی‌ماندهٔ سفارش ${orderId}`,
          parent.created_by,
          now,
          now,
          orgId
        ).lastInsertRowid
    );
    const insLine = conn.prepare(
      `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, unit_price_toman,
                                unit_cost_toman, qty_per_pack, kg_per_base_unit, price_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const l of lines) {
      insLine.run(
        newOrderId,
        l.product_id,
        l.packaging_id,
        l.packs_short,
        l.unit_price_toman,
        l.unit_cost_toman,
        l.qty_per_pack,
        l.kg_per_base_unit,
        l.price_id,
        now
      );
    }
    conn
      .prepare(
        `INSERT INTO order_events (organization_id, order_id, from_status, to_status, action, actor_user_id, note, created_at)
         VALUES (?, ?, NULL, 'DRAFT', 'create', NULL, ?, ?)`
      )
      .run(orgId, newOrderId, `backorder of ${orderId}`, now);
  },
});
