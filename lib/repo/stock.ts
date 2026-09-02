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
}

/** One row per batch of a product, FEFO-ordered (earliest expiry first, undated last),
 *  each carrying its computed on-hand. */
export function batchStock(
  organizationId: number,
  productId: number,
  facilityId?: number
): BatchStockRow[] {
  const facClause = facilityId !== undefined ? "AND m.facility_id = ?" : "";
  return stockMovementsRepo
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
    ) as unknown as BatchStockRow[];
}

/** First-Expired-First-Out: take from the earliest-expiry `active` batch with stock,
 *  then the next, until satisfied. Any shortfall is one unbatched entry so an oversell
 *  still drives on-hand negative rather than being silently absorbed. Reads only. */
export function allocateFEFO(
  organizationId: number,
  productId: number,
  baseQty: number,
  facilityId: number
): Array<{ batch_id: number | null; base_qty: number }> {
  if (!(baseQty > 0)) return [];
  const out: Array<{ batch_id: number | null; base_qty: number }> = [];
  let left = baseQty;
  for (const b of batchStock(organizationId, productId, facilityId)) {
    if (left <= 0) break;
    if (b.status !== "active" || b.on_hand <= 0) continue;
    const take = Math.min(left, b.on_hand);
    out.push({ batch_id: b.batch_id, base_qty: take });
    left -= take;
  }
  if (left > 1e-9) out.push({ batch_id: null, base_qty: left });
  return out;
}

/** The facility stock lands at and leaves from: a warehouse if there is one, else the
 *  home base, else the lowest-id facility. Throws if the org has none. */
export function defaultFacilityId(organizationId: number): number {
  const rows = stockMovementsRepo
    .db()
    .prepare(
      "SELECT id, kind FROM facilities WHERE organization_id = ? OR organization_id IS NULL ORDER BY id"
    )
    .all(organizationId) as unknown as { id: number; kind: string }[];
  if (rows.length === 0) throw new StockError("هیچ انباری تعریف نشده است");
  return (
    rows.find((r) => r.kind === "warehouse")?.id ??
    rows.find((r) => r.kind === "home_base")?.id ??
    rows[0].id
  );
}

export interface StockLevel {
  product_id: number;
  on_hand: number;
  earliest_expiry: string | null;
}

/** Movement-derived on-hand per product, plus the soonest expiry among its batches that
 *  still hold stock. The replacement core for lib/purchases.stockPosition. */
export function stockLevels(organizationId: number): StockLevel[] {
  return stockMovementsRepo
    .db()
    .prepare(
      `SELECT p.id AS product_id,
              COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m
                         WHERE m.product_id = p.id AND m.organization_id = ?), 0) AS on_hand,
              (SELECT MIN(b.expiry_date) FROM batches b
                WHERE b.product_id = p.id AND b.organization_id = ? AND b.expiry_date IS NOT NULL
                  AND COALESCE((SELECT SUM(m2.base_qty) FROM stock_movements m2 WHERE m2.batch_id = b.id), 0) > 0
              ) AS earliest_expiry
         FROM products p
        WHERE p.organization_id = ? OR p.organization_id IS NULL`
    )
    .all(organizationId, organizationId, organizationId) as unknown as StockLevel[];
}
