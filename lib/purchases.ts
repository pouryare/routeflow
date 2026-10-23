/** Buying stock in, and knowing what is left.
 *
 *  Replaces the خرید and موجودی انبار sheets. Two ideas carry the whole module:
 *
 *  - A receipt updates the product's **moving average cost**, and that average is
 *    snapshotted onto an order line the moment a sale is recorded. So the margin on an
 *    order closed in Farvardin cannot move when a lorry arrives in Esfand.
 *  - Stock is **derived**, never stored: everything received, less everything actually
 *    delivered. A stored counter is a number that drifts silently the first time
 *    anything is corrected, and the whole point of this table is to be checkable.
 */

import type { Db } from "@/lib/database/client";
import { movingAverageCost, stockAfter } from "./stockMath";
import { isToman } from "./money";
import { orgClause } from "./orgScope";
import { createBatchTxn } from "./repo/batches";
import { recordMovementsTxn, defaultFacilityId } from "./repo/stock";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "./orderStateMachine";
/* roundToman, never Math.round and never SQL ROUND(): purchase_lines.base_qty is REAL, so
   the multiplication genuinely produces fractions, and Math.round(-0.5) returns -0 --
   which lib/money.ts calls out as making a reversal 1 Toman off the sale it reverses. */
import { roundToman, sumToman } from "./money";
import { postPurchase } from "./repo/ledgerPostings";

export class PurchaseError extends Error {}

export interface PurchaseLineInput {
  product_id: number;
  /** In the product's base unit (عدد), not in packs -- see the schema comment. */
  base_qty: number;
  unit_cost_toman: number;
  /** Phase 2: the physical lot this line received. All optional -- an omitted code is
   *  auto-generated, an omitted expiry is derived from the product's shelf life. */
  batch_code?: string | null;
  supplier_batch_ref?: string | null;
  produced_at?: string | null;
  expiry_date?: string | null;
}

export interface PurchaseInput {
  /** The real supplier row. Optional only so a LEGACY caller still works: without it the
   *  purchase records stock but posts no payable, which is exactly the hole accounts
   *  payable exists to close, so new callers must pass it. */
  supplier_id?: number | null;
  /** Kept: the only record of what was originally typed when two suppliers normalise to
   *  the same name after trimming. */
  supplier?: string | null;
  purchase_date: string;
  invoice_no?: string | null;
  notes?: string | null;
  created_by: number;
  /** Required, not optional: readPurchases is per-tenant now, and a receipt with a NULL
   *  organisation drops out of its own owner's purchase history without an error. */
  organization_id: number;
  lines: PurchaseLineInput[];
}

/** Records a receipt and rolls the average cost of everything on it.
 *
 *  Everything happens in one transaction: a receipt whose lines landed but whose cost
 *  roll did not would leave every later sale priced against a stale average, and
 *  nothing on screen would look wrong.
 */
export async function recordPurchase(db: Db, input: PurchaseInput): Promise<number> {
  if (input.lines.length === 0) throw new PurchaseError("خرید بدون قلم ثبت نمی‌شود");

  for (const line of input.lines) {
    if (!isToman(line.unit_cost_toman) || line.unit_cost_toman < 0) {
      throw new TypeError("قیمت خرید را به تومان و بدون اعشار وارد کنید");
    }
    if (!Number.isFinite(line.base_qty) || line.base_qty <= 0) {
      throw new PurchaseError("تعداد خرید باید بزرگ‌تر از صفر باشد");
    }
  }

  const now = new Date().toISOString();
  await db.exec("BEGIN IMMEDIATE");
  try {
    const purchaseId = Number(
      (await db
        .prepare(
          `INSERT INTO purchases (supplier, supplier_id, purchase_date, invoice_no, notes, created_by, created_at, organization_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.supplier?.trim() || null,
          input.supplier_id ?? null,
          input.purchase_date.slice(0, 10),
          input.invoice_no?.trim() || null,
          input.notes?.trim() || null,
          input.created_by,
          now,
          input.organization_id
        )).lastInsertRowid
    );

    const insertLine = db.prepare(
      `INSERT INTO purchase_lines (purchase_id, product_id, base_qty, unit_cost_toman, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const setCost = db.prepare(
      "UPDATE products SET avg_cost_toman = ?, updated_at = ? WHERE id = ?"
    );

    // Phase 2: every received line becomes a tracked batch plus a PURCHASE_IN movement.
    // The facility is resolved once -- a receipt lands entirely at the default warehouse.
    // A NULL organisation is only ever a hand-seeded test row (the boot backfill sets it
    // in production); the batch/movement tables are NOT NULL on it, so default to 1.
    const orgId = input.organization_id || 1;
    const facilityId = await defaultFacilityId(orgId);

    for (const line of input.lines) {
      const product = await db
        .prepare("SELECT id, avg_cost_toman FROM products WHERE id = ?")
        .get(line.product_id) as { avg_cost_toman: number } | undefined;
      if (!product) throw new PurchaseError("کالا پیدا نشد");

      const purchaseLineId = Number(
        (await insertLine.run(purchaseId, line.product_id, line.base_qty, line.unit_cost_toman, now))
          .lastInsertRowid
      );

      const batchId = await createBatchTxn(db, orgId, {
        product_id: line.product_id,
        batch_code: line.batch_code,
        supplier_batch_ref: line.supplier_batch_ref,
        purchase_line_id: purchaseLineId,
        produced_at: line.produced_at ?? input.purchase_date,
        expiry_date: line.expiry_date,
        qty_received_base: line.base_qty,
        unit_cost_toman: line.unit_cost_toman,
      });

      await recordMovementsTxn(db, orgId, [
        {
          facility_id: facilityId,
          product_id: line.product_id,
          batch_id: batchId,
          base_qty: line.base_qty,
          kind: "PURCHASE_IN",
          ref_type: "purchase_line",
          ref_id: purchaseLineId,
          occurred_at: input.purchase_date,
          created_by: input.created_by,
        },
      ]);

      // Read the position *before* this line as the weight for the blend. Reading it
      // afterwards would count the arriving units twice.
      const onHand = await onHandFor(db, line.product_id) - line.base_qty;
      await setCost.run(
        movingAverageCost({
          onHand,
          avgCost: product.avg_cost_toman,
          qty: line.base_qty,
          unitCost: line.unit_cost_toman,
        }),
        now,
        line.product_id
      );
    }

    /* The money side of the purchase, in the SAME transaction. A purchase whose stock
       landed but whose payable did not is the exact failure accounts payable was added to
       stop, and nothing on the stock screen would look wrong.

       postPurchase opens no transaction of its own -- this one is already open, and a
       nested BEGIN throws in SQLite.

       A purchase with NO supplier posts nothing rather than an unattributable payable. An
       anonymous payable is a number nobody can settle or ask about, which is worse than an
       absent one because it looks complete. */
    if (input.supplier_id) {
      // roundToman per LINE, then sumToman across them: base_qty is REAL, so rounding the
      // total once would hide which line produced the fraction.
      const total = sumToman(
        input.lines.map((l) => roundToman(l.base_qty * l.unit_cost_toman))
      );
      await postPurchase(db, {
        organizationId: orgId,
        purchaseId,
        supplierId: input.supplier_id,
        totalToman: total,
        purchasedAt: input.purchase_date.slice(0, 10),
        purchasedBy: input.created_by,
      });
    }

    await db.exec("COMMIT");
    return purchaseId;
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}

/** Units of one product currently on hand. */
async function onHandFor(db: Db, productId: number): Promise<number> {
  const bought = await db
    .prepare("SELECT COALESCE(SUM(base_qty), 0) AS n FROM purchase_lines WHERE product_id = ?")
    .get(productId) as { n: number };

  // COALESCE(packs_delivered, 0) rather than falling back to packs_ordered: goods only
  // leave the warehouse when a driver says they did.
  const gone = await db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(ol.packs_delivered, 0) * ol.qty_per_pack), 0) AS n
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
        WHERE ol.product_id = ? AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})`
    )
    .get(productId) as { n: number };

  return stockAfter({ purchased: bought.n, delivered: gone.n });
}

export interface StockRow {
  product_id: number;
  name: string;
  base_unit: string;
  avg_cost_toman: number;
  purchased_qty: number;
  delivered_qty: number;
  on_hand: number;
  value_toman: number;
  /** True when the books say we hold less than nothing -- see stockAfter. */
  negative: boolean;
}

export async function stockPosition(db: Db, organizationId: number | null): Promise<StockRow[]> {
  const org = orgClause("p.organization_id", organizationId);
  // Phase 2: on-hand is the sum of the signed movement ledger. purchased_qty /
  // delivered_qty stay in the shape callers expect, split by sign. stockAfter still
  // holds: purchased - delivered = SUM(base_qty).
  const rows = await db
    .prepare(
      `SELECT p.id AS product_id, p.name, p.base_unit, p.avg_cost_toman,
              COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m
                         WHERE m.product_id = p.id AND m.base_qty > 0), 0) AS purchased_qty,
              -COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m
                          WHERE m.product_id = p.id AND m.base_qty < 0), 0) AS delivered_qty
         FROM products p
        WHERE p.active = 1${org.sql}
        ORDER BY p.name`
    )
    .all(...org.params) as unknown as Omit<StockRow, "on_hand" | "value_toman" | "negative">[];

  return rows.map((row) => {
    const onHand = stockAfter({ purchased: row.purchased_qty, delivered: row.delivered_qty });
    return {
      ...row,
      on_hand: onHand,
      value_toman: onHand * row.avg_cost_toman,
      negative: onHand < 0,
    };
  });
}

const VELOCITY_WINDOW_DAYS = 14;

export type StockStatus = "crit" | "low" | "ok" | "over";

/** بحرانی below the reorder point, کم within 35% of it, مازاد above the target, سالم
 *  otherwise -- and سالم, never بحرانی or مازاد, for a threshold nobody has set. A
 *  product the owner has not configured yet has no policy to be measured against, and
 *  reading that as an alarm would train the owner to ignore the alarm. */
export function stockStatus(onHand: number, reorderPoint: number | null, targetStock: number | null): StockStatus {
  if (reorderPoint !== null && onHand < reorderPoint) return "crit";
  if (reorderPoint !== null && onHand < reorderPoint * 1.35) return "low";
  if (targetStock !== null && onHand > targetStock) return "over";
  return "ok";
}

export interface AdvancedStockRow extends StockRow {
  reorder_point: number | null;
  target_stock: number | null;
  status: StockStatus;
  /** Average base_unit delivered per day over the last VELOCITY_WINDOW_DAYS. */
  daily_rate: number;
  /** on_hand / daily_rate, in days. Null rather than Infinity when nothing has moved
   *  recently -- a chart cannot draw Infinity, and "unknown" is the honest answer for a
   *  product with stock but no recent delivery to time it against. */
  days_left: number | null;
  /** VELOCITY_WINDOW_DAYS entries, oldest first -- same convention SalesSpark uses,
   *  because this app's charts put index 0 on the right under RTL. */
  spark: number[];
  last_purchase_date: string | null;
  /** Soonest expiry among this product's batches that still hold stock, or null. */
  earliest_expiry: string | null;
  /** How many of this product's batches are inside the expiry-alert window. */
  expiring_count: number;
}

/** stockPosition plus everything the advanced انبار screen draws on top of it: the
 *  owner's reorder policy, how fast each product has actually been moving, and when it
 *  was last restocked. Kept separate from stockPosition rather than folded into it --
 *  the dashboard's plain stock bar chart has no use for a driver's worth of extra
 *  columns and three more queries it would otherwise pay for on every render.
 */
export async function advancedStockPosition(db: Db, organizationId: number | null): Promise<AdvancedStockRow[]> {
  /* Only `base` needs the scope: every map below is keyed by product id and read back only for
     a product `base` returned, so another tenant's rows are never looked up. */
  const base = await stockPosition(db, organizationId);

  const thresholds = await db
    .prepare("SELECT id, reorder_point, target_stock FROM products WHERE active = 1")
    .all() as unknown as { id: number; reorder_point: number | null; target_stock: number | null }[];
  const thresholdById = new Map(thresholds.map((t) => [t.id, t]));

  const windowStart = new Date(Date.now() - VELOCITY_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const dailyRows = await db
    .prepare(
      `SELECT ol.product_id, substr(o.delivered_at, 1, 10) AS day,
              SUM(COALESCE(ol.packs_delivered, 0) * ol.qty_per_pack) AS qty
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
        WHERE o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)}) AND o.delivered_at IS NOT NULL AND o.delivered_at >= ?
        GROUP BY ol.product_id, day`
    )
    .all(windowStart) as unknown as { product_id: number; day: string; qty: number }[];
  const dailyByProduct = new Map<number, Map<string, number>>();
  for (const row of dailyRows) {
    if (!dailyByProduct.has(row.product_id)) dailyByProduct.set(row.product_id, new Map());
    dailyByProduct.get(row.product_id)!.set(row.day, row.qty);
  }

  const lastPurchaseRows = await db
    .prepare(
      `SELECT pl.product_id, MAX(pu.purchase_date) AS last_date
         FROM purchase_lines pl JOIN purchases pu ON pu.id = pl.purchase_id
        GROUP BY pl.product_id`
    )
    .all() as unknown as { product_id: number; last_date: string }[];
  const lastPurchaseById = new Map(lastPurchaseRows.map((r) => [r.product_id, r.last_date]));

  // Phase 2: soonest expiry per product among batches still holding stock, plus a count
  // of those within 30 days (or already past). The precise, shelf-life-scaled window
  // lives in lib/repo/batches.expiringBatches and the /stock/expiry endpoint; this chip
  // just flags "something here is ageing".
  const expiryRows = await db
    .prepare(
      `SELECT b.product_id,
              MIN(b.expiry_date) AS earliest,
              SUM(CASE WHEN julianday(b.expiry_date) - julianday('now') <= 30 THEN 1 ELSE 0 END) AS expiring
         FROM batches b
        WHERE b.status IN ('active', 'quarantined') AND b.expiry_date IS NOT NULL
          AND COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m WHERE m.batch_id = b.id), 0) > 0
        GROUP BY b.product_id`
    )
    .all() as unknown as { product_id: number; earliest: string | null; expiring: number }[];
  const expiryByProduct = new Map(expiryRows.map((r) => [r.product_id, r]));

  // Every day in the window, oldest first, regardless of whether anything moved on it --
  // a day with no deliveries is a real zero, not a gap the chart should skip over.
  const days: string[] = [];
  for (let i = VELOCITY_WINDOW_DAYS - 1; i >= 0; i--) {
    days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }

  return base.map((row) => {
    const t = thresholdById.get(row.product_id);
    const reorderPoint = t?.reorder_point ?? null;
    const targetStock = t?.target_stock ?? null;

    const byDay = dailyByProduct.get(row.product_id);
    const spark = days.map((d) => byDay?.get(d) ?? 0);
    const dailyRate = spark.reduce((a, b) => a + b, 0) / VELOCITY_WINDOW_DAYS;

    return {
      ...row,
      reorder_point: reorderPoint,
      target_stock: targetStock,
      status: stockStatus(row.on_hand, reorderPoint, targetStock),
      daily_rate: dailyRate,
      days_left: dailyRate > 0 ? row.on_hand / dailyRate : null,
      spark,
      last_purchase_date: lastPurchaseById.get(row.product_id) ?? null,
      earliest_expiry: expiryByProduct.get(row.product_id)?.earliest ?? null,
      expiring_count: expiryByProduct.get(row.product_id)?.expiring ?? 0,
    };
  });
}

/** This month's purchase count and value for one organisation (the انبار page header). */
export async function monthPurchaseTotals(db: Db, organizationId: number | null, monthFrom: string): Promise<{ n: number; total: number }> {
  const org = orgClause("pu.organization_id", organizationId);
  return await db
    .prepare(
      `SELECT COUNT(DISTINCT pu.id) AS n, COALESCE(SUM(pl.base_qty * pl.unit_cost_toman), 0) AS total
         FROM purchases pu LEFT JOIN purchase_lines pl ON pl.purchase_id = pu.id
        WHERE pu.purchase_date >= ?${org.sql}`
    )
    .get(monthFrom, ...org.params) as { n: number; total: number };
}

export interface PurchaseSummary {
  id: number;
  supplier: string | null;
  purchase_date: string;
  invoice_no: string | null;
  line_count: number;
  total_toman: number;
  entered_by: string | null;
}

export async function readPurchases(db: Db, organizationId: number, limit = 100): Promise<PurchaseSummary[]> {
  return await db
    .prepare(
      `SELECT pu.id, pu.supplier, pu.purchase_date, pu.invoice_no,
              COUNT(pl.id) AS line_count,
              COALESCE(SUM(pl.base_qty * pl.unit_cost_toman), 0) AS total_toman,
              u.display_name AS entered_by
         FROM purchases pu
         LEFT JOIN purchase_lines pl ON pl.purchase_id = pu.id
         LEFT JOIN users u ON u.id = pu.created_by
        WHERE pu.organization_id = ?
        GROUP BY pu.id
        ORDER BY pu.purchase_date DESC, pu.id DESC
        LIMIT ?`
    )
    .all(organizationId, limit) as unknown as PurchaseSummary[];
}
