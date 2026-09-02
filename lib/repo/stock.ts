import type { DatabaseSync } from "node:sqlite";
import { makeRepo } from "./base";

/** A refusal the caller shows the user, not a bug. */
export class StockError extends Error {}

export type MovementKind =
  | "PURCHASE_IN"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "DELIVERY_OUT"
  | "SAMPLE_OUT"
  | "RETURN_IN"
  | "ADJUSTMENT"
  | "COUNT"
  | "WRITE_OFF";

export interface MovementRow {
  id: number;
  organization_id: number;
  facility_id: number;
  product_id: number;
  batch_id: number | null;
  base_qty: number;
  kind: MovementKind;
  ref_type: string | null;
  ref_id: number | null;
  occurred_at: string;
  created_by: number | null;
  notes: string | null;
  created_at: string;
}

export interface MovementInput {
  facility_id: number;
  product_id: number;
  batch_id: number | null;
  base_qty: number;
  kind: MovementKind;
  ref_type?: string | null;
  ref_id?: number | null;
  occurred_at: string;
  created_by?: number | null;
  notes?: string | null;
}

export const stockMovementsRepo = makeRepo<MovementRow>("stock_movements", { tenant: true });

function assertScoped(db: DatabaseSync, organizationId: number, input: MovementInput): void {
  const fac = db
    .prepare("SELECT organization_id FROM facilities WHERE id = ?")
    .get(input.facility_id) as { organization_id: number | null } | undefined;
  if (!fac || (fac.organization_id !== null && fac.organization_id !== organizationId)) {
    throw new StockError("انبار پیدا نشد");
  }
  const prod = db
    .prepare("SELECT organization_id FROM products WHERE id = ?")
    .get(input.product_id) as { organization_id: number | null } | undefined;
  if (!prod || (prod.organization_id !== null && prod.organization_id !== organizationId)) {
    throw new StockError("کالا پیدا نشد");
  }
  if (input.batch_id !== null) {
    const batch = db
      .prepare("SELECT organization_id FROM batches WHERE id = ?")
      .get(input.batch_id) as { organization_id: number | null } | undefined;
    if (!batch || (batch.organization_id !== null && batch.organization_id !== organizationId)) {
      throw new StockError("بچ پیدا نشد");
    }
  }
  if (!Number.isFinite(input.base_qty) || input.base_qty === 0) {
    throw new StockError("مقدار حرکت انبار باید عددی غیر صفر باشد");
  }
}

/** Append one or more ledger rows inside a transaction the caller already owns. */
export function recordMovementsTxn(
  db: DatabaseSync,
  organizationId: number,
  inputs: MovementInput[]
): number[] {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO stock_movements
       (organization_id, facility_id, product_id, batch_id, base_qty, kind,
        ref_type, ref_id, occurred_at, created_by, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const ids: number[] = [];
  for (const input of inputs) {
    assertScoped(db, organizationId, input);
    ids.push(
      Number(
        stmt.run(
          organizationId,
          input.facility_id,
          input.product_id,
          input.batch_id,
          input.base_qty,
          input.kind,
          input.ref_type ?? null,
          input.ref_id ?? null,
          input.occurred_at,
          input.created_by ?? null,
          input.notes ?? null,
          now
        ).lastInsertRowid
      )
    );
  }
  return ids;
}

export function recordMovement(organizationId: number, input: MovementInput): number {
  const db = stockMovementsRepo.db();
  db.exec("BEGIN IMMEDIATE");
  try {
    const [id] = recordMovementsTxn(db, organizationId, [input]);
    db.exec("COMMIT");
    return id;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Net units on hand for any combination of product / batch / facility. May be
 *  negative -- the books lag reality while paper drains; the UI flags it. */
export function onHand(
  organizationId: number,
  filter: { product_id?: number; batch_id?: number | null; facility_id?: number }
): number {
  const clauses: string[] = ["organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (filter.product_id !== undefined) {
    clauses.push("product_id = ?");
    params.push(filter.product_id);
  }
  if (filter.batch_id !== undefined) {
    if (filter.batch_id === null) clauses.push("batch_id IS NULL");
    else {
      clauses.push("batch_id = ?");
      params.push(filter.batch_id);
    }
  }
  if (filter.facility_id !== undefined) {
    clauses.push("facility_id = ?");
    params.push(filter.facility_id);
  }
  const row = stockMovementsRepo
    .db()
    .prepare(`SELECT COALESCE(SUM(base_qty), 0) AS n FROM stock_movements WHERE ${clauses.join(" AND ")}`)
    .get(...(params as never[])) as { n: number };
  return row.n;
}

export interface BatchStockRow {
  batch_id: number;
  batch_code: string;
  expiry_date: string | null;
  status: string;
  on_hand: number;
  /** on_hand minus this batch's un-released reservations. */
  available: number;
}

/** One row per batch of a product, FEFO-ordered (earliest expiry first, undated last),
 *  each carrying its computed on-hand and available-to-promise. */
export function batchStock(
  organizationId: number,
  productId: number,
  facilityId?: number
): BatchStockRow[] {
  const facClause = facilityId !== undefined ? "AND m.facility_id = ?" : "";
  const rows = stockMovementsRepo
    .db()
    .prepare(
      `SELECT b.id AS batch_id, b.batch_code, b.expiry_date, b.status,
              COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m
                         WHERE m.batch_id = b.id AND m.organization_id = ? ${facClause}), 0) AS on_hand
         FROM batches b
        WHERE b.organization_id = ? AND b.product_id = ?
        ORDER BY (b.expiry_date IS NULL), b.expiry_date, b.id`
    )
    .all(
      ...([
        organizationId,
        ...(facilityId !== undefined ? [facilityId] : []),
        organizationId,
        productId,
      ] as never[])
    ) as unknown as Omit<BatchStockRow, "available">[];
  const reserved = openReservationByBatch(organizationId, productId);
  return rows.map((r) => ({ ...r, available: r.on_hand - (reserved.get(r.batch_id) ?? 0) }));
}

/** Open (un-released) reservation quantity per batch for a product, as a Map keyed by
 *  batch_id. The shortfall bucket (batch_id NULL) is dropped -- it never held real
 *  stock, so it cannot reduce another batch's availability. */
function openReservationByBatch(
  organizationId: number,
  productId: number
): Map<number, number> {
  const rows = stockMovementsRepo
    .db()
    .prepare(
      `SELECT batch_id, COALESCE(SUM(base_qty), 0) AS n FROM stock_reservations
        WHERE organization_id = ? AND product_id = ? AND released_at IS NULL AND batch_id IS NOT NULL
        GROUP BY batch_id`
    )
    .all(organizationId, productId) as unknown as { batch_id: number; n: number }[];
  return new Map(rows.map((r) => [r.batch_id, r.n]));
}

/** First-Expired-First-Out: take from the earliest-expiry `active` batch with stock,
 *  then the next, until satisfied. Any shortfall is one unbatched entry so an oversell
 *  still drives on-hand negative rather than being silently absorbed. Reads only.
 *
 *  `excludeReserved` subtracts stock already claimed by an un-released reservation, so
 *  two orders confirmed back-to-back do not both grab the same units. */
export function allocateFEFO(
  organizationId: number,
  productId: number,
  baseQty: number,
  facilityId: number,
  opts: { excludeReserved?: boolean } = {}
): Array<{ batch_id: number | null; base_qty: number }> {
  if (!(baseQty > 0)) return [];
  const reserved = opts.excludeReserved
    ? openReservationByBatch(organizationId, productId)
    : new Map<number, number>();
  const out: Array<{ batch_id: number | null; base_qty: number }> = [];
  let left = baseQty;
  for (const b of batchStock(organizationId, productId, facilityId)) {
    if (left <= 0) break;
    if (b.status !== "active") continue;
    const free = b.on_hand - (reserved.get(b.batch_id) ?? 0);
    if (free <= 0) continue;
    const take = Math.min(left, free);
    out.push({ batch_id: b.batch_id, base_qty: take });
    left -= take;
  }
  if (left > 1e-9) out.push({ batch_id: null, base_qty: left });
  return out;
}

/** Sum of un-released reservations for a product (optionally one batch). */
export function reservedQty(
  organizationId: number,
  filter: { product_id: number; batch_id?: number | null }
): number {
  const clauses = ["organization_id = ?", "released_at IS NULL", "product_id = ?"];
  const params: unknown[] = [organizationId, filter.product_id];
  if (filter.batch_id !== undefined) {
    if (filter.batch_id === null) clauses.push("batch_id IS NULL");
    else {
      clauses.push("batch_id = ?");
      params.push(filter.batch_id);
    }
  }
  const row = stockMovementsRepo
    .db()
    .prepare(`SELECT COALESCE(SUM(base_qty), 0) AS n FROM stock_reservations WHERE ${clauses.join(" AND ")}`)
    .get(...(params as never[])) as { n: number };
  return row.n;
}

/** On-hand minus what confirmed orders have already claimed. */
export function availableToPromise(
  organizationId: number,
  filter: { product_id: number; batch_id?: number | null; facility_id?: number }
): number {
  return (
    onHand(organizationId, filter) -
    reservedQty(organizationId, { product_id: filter.product_id, batch_id: filter.batch_id })
  );
}

/** Claim stock for a confirmed order: one un-released reservation row per FEFO slice
 *  (including the batch_id NULL shortfall slice). Idempotent -- if the order already has
 *  open reservations it is left alone. Runs inside the caller's transaction when `db` is
 *  passed, else opens its own. */
export function reserveForOrder(
  organizationId: number,
  orderId: number,
  db?: DatabaseSync
): number {
  const conn = db ?? stockMovementsRepo.db();
  const run = (): number => {
    const already = conn
      .prepare(
        "SELECT 1 FROM stock_reservations WHERE order_id = ? AND organization_id = ? AND released_at IS NULL LIMIT 1"
      )
      .get(orderId, organizationId);
    if (already) return 0;

    const lines = conn
      .prepare(
        `SELECT ol.id, ol.product_id,
                (ol.packs_ordered * ol.qty_per_pack) AS base_qty
           FROM order_lines ol
          WHERE ol.order_id = ? AND ol.packs_ordered > 0`
      )
      .all(orderId) as unknown as { id: number; product_id: number; base_qty: number }[];
    if (lines.length === 0) return 0;

    const facilityId = defaultFacilityId(organizationId);
    const now = new Date().toISOString();
    const ins = conn.prepare(
      `INSERT INTO stock_reservations
         (organization_id, order_id, order_line_id, product_id, batch_id, base_qty, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    let n = 0;
    for (const line of lines) {
      const slices = allocateFEFO(organizationId, line.product_id, line.base_qty, facilityId, {
        excludeReserved: true,
      });
      for (const s of slices) {
        ins.run(organizationId, orderId, line.id, line.product_id, s.batch_id, s.base_qty, now);
        n += 1;
      }
    }
    return n;
  };

  if (db) return run();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const n = run();
    conn.exec("COMMIT");
    return n;
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

/** Drop an order's claim on stock (cancel, or a failed delivery going back to PLANNED). */
export function releaseForOrder(
  organizationId: number,
  orderId: number,
  db?: DatabaseSync
): void {
  const conn = db ?? stockMovementsRepo.db();
  conn
    .prepare(
      "UPDATE stock_reservations SET released_at = ? WHERE order_id = ? AND organization_id = ? AND released_at IS NULL"
    )
    .run(new Date().toISOString(), orderId, organizationId);
}

/** The goods have actually left: the DELIVERY_OUT movement is now the record, so the
 *  reservation is simply released. Named for the intent it serves in the effect list. */
export function consumeForOrder(
  organizationId: number,
  orderId: number,
  db?: DatabaseSync
): void {
  releaseForOrder(organizationId, orderId, db);
}

/** The facility stock lands at and leaves from: a warehouse if there is one, else the
 *  home base, else the lowest-id facility. A tenant that somehow has none gets a
 *  synthetic warehouse created for it -- stock has to live somewhere, and the source
 *  brief wants the warehouse independent even when there is only one. */
export function defaultFacilityId(organizationId: number): number {
  const db = stockMovementsRepo.db();
  const rows = db
    .prepare(
      "SELECT id, kind FROM facilities WHERE organization_id = ? OR organization_id IS NULL ORDER BY id"
    )
    .all(organizationId) as unknown as { id: number; kind: string }[];
  const chosen =
    rows.find((r) => r.kind === "warehouse")?.id ??
    rows.find((r) => r.kind === "home_base")?.id ??
    rows[0]?.id;
  if (chosen !== undefined) return chosen;

  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO facilities (slug, kind, name, lat, lng, updated_at, organization_id, created_at)
         VALUES (?, 'warehouse', 'انبار', 0, 0, ?, ?, ?)`
      )
      .run(`wh-org${organizationId}-${Date.now()}`, now, organizationId, now).lastInsertRowid
  );
}

/** The recent ledger, newest first, optionally filtered. */
export function listMovements(
  organizationId: number,
  filter?: { product_id?: number; facility_id?: number; limit?: number }
): MovementRow[] {
  const clauses = ["organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (filter?.product_id !== undefined) {
    clauses.push("product_id = ?");
    params.push(filter.product_id);
  }
  if (filter?.facility_id !== undefined) {
    clauses.push("facility_id = ?");
    params.push(filter.facility_id);
  }
  params.push(filter?.limit ?? 200);
  return stockMovementsRepo
    .db()
    .prepare(
      `SELECT * FROM stock_movements WHERE ${clauses.join(" AND ")} ORDER BY occurred_at DESC, id DESC LIMIT ?`
    )
    .all(...(params as never[])) as unknown as MovementRow[];
}

/** Movement kinds a human may record by hand -- PURCHASE_IN and DELIVERY_OUT are
 *  written only by their own flows. */
export const MANUAL_MOVEMENT_KINDS: MovementKind[] = [
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "SAMPLE_OUT",
  "RETURN_IN",
  "ADJUSTMENT",
  "COUNT",
  "WRITE_OFF",
];

export interface StockLevel {
  product_id: number;
  on_hand: number;
  reserved: number;
  available: number;
  earliest_expiry: string | null;
}

/** Movement-derived on-hand per product, the quantity confirmed orders have claimed,
 *  available-to-promise (on_hand - reserved), and the soonest expiry among its batches
 *  that still hold stock. The replacement core for lib/purchases.stockPosition. */
export function stockLevels(organizationId: number): StockLevel[] {
  const rows = stockMovementsRepo
    .db()
    .prepare(
      `SELECT p.id AS product_id,
              COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m
                         WHERE m.product_id = p.id AND m.organization_id = ?), 0) AS on_hand,
              COALESCE((SELECT SUM(r.base_qty) FROM stock_reservations r
                         WHERE r.product_id = p.id AND r.organization_id = ? AND r.released_at IS NULL), 0) AS reserved,
              (SELECT MIN(b.expiry_date) FROM batches b
                WHERE b.product_id = p.id AND b.organization_id = ? AND b.expiry_date IS NOT NULL
                  AND COALESCE((SELECT SUM(m2.base_qty) FROM stock_movements m2 WHERE m2.batch_id = b.id), 0) > 0
              ) AS earliest_expiry
         FROM products p
        WHERE p.organization_id = ? OR p.organization_id IS NULL`
    )
    .all(organizationId, organizationId, organizationId, organizationId) as unknown as Omit<
    StockLevel,
    "available"
  >[];
  return rows.map((r) => ({ ...r, available: r.on_hand - r.reserved }));
}
