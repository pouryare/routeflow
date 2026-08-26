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

import type { DatabaseSync } from "node:sqlite";
import { movingAverageCost, stockAfter } from "./stockMath";
import { isToman } from "./money";

export class PurchaseError extends Error {}

export interface PurchaseLineInput {
  product_id: number;
  /** In the product's base unit (عدد), not in packs -- see the schema comment. */
  base_qty: number;
  unit_cost_toman: number;
}

export interface PurchaseInput {
  supplier?: string | null;
  purchase_date: string;
  invoice_no?: string | null;
  notes?: string | null;
  created_by: number;
  lines: PurchaseLineInput[];
}

/** Records a receipt and rolls the average cost of everything on it.
 *
 *  Everything happens in one transaction: a receipt whose lines landed but whose cost
 *  roll did not would leave every later sale priced against a stale average, and
 *  nothing on screen would look wrong.
 */
export function recordPurchase(db: DatabaseSync, input: PurchaseInput): number {
  if (input.lines.length === 0) throw new PurchaseError("خرید بدون قلم ثبت نمی‌شود");

  for (const line of input.lines) {
    if (!isToman(line.unit_cost_toman) || line.unit_cost_toman < 0) {
      throw new TypeError(`قیمت خرید باید عدد صحیح تومان باشد: ${line.unit_cost_toman}`);
    }
    if (!Number.isFinite(line.base_qty) || line.base_qty <= 0) {
      throw new PurchaseError("تعداد خرید باید بزرگ‌تر از صفر باشد");
    }
  }

  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const purchaseId = Number(
      db
        .prepare(
          `INSERT INTO purchases (supplier, purchase_date, invoice_no, notes, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.supplier?.trim() || null,
          input.purchase_date.slice(0, 10),
          input.invoice_no?.trim() || null,
          input.notes?.trim() || null,
          input.created_by,
          now
        ).lastInsertRowid
    );

    const insertLine = db.prepare(
      `INSERT INTO purchase_lines (purchase_id, product_id, base_qty, unit_cost_toman, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const setCost = db.prepare(
      "UPDATE products SET avg_cost_toman = ?, updated_at = ? WHERE id = ?"
    );

    for (const line of input.lines) {
      const product = db
        .prepare("SELECT id, avg_cost_toman FROM products WHERE id = ?")
        .get(line.product_id) as { avg_cost_toman: number } | undefined;
      if (!product) throw new PurchaseError("کالا پیدا نشد");

      insertLine.run(purchaseId, line.product_id, line.base_qty, line.unit_cost_toman, now);

      // Read the position *before* this line as the weight for the blend. Reading it
      // afterwards would count the arriving units twice.
      const onHand = onHandFor(db, line.product_id) - line.base_qty;
      setCost.run(
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

    db.exec("COMMIT");
    return purchaseId;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Units of one product currently on hand. */
function onHandFor(db: DatabaseSync, productId: number): number {
  const bought = db
    .prepare("SELECT COALESCE(SUM(base_qty), 0) AS n FROM purchase_lines WHERE product_id = ?")
    .get(productId) as { n: number };

  // COALESCE(packs_delivered, 0) rather than falling back to packs_ordered: goods only
  // leave the warehouse when a driver says they did.
  const gone = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(ol.packs_delivered, 0) * ol.qty_per_pack), 0) AS n
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
        WHERE ol.product_id = ? AND o.status = 'delivered'`
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

export function stockPosition(db: DatabaseSync): StockRow[] {
  const rows = db
    .prepare(
      `SELECT p.id AS product_id, p.name, p.base_unit, p.avg_cost_toman,
              COALESCE((SELECT SUM(pl.base_qty) FROM purchase_lines pl
                         WHERE pl.product_id = p.id), 0) AS purchased_qty,
              COALESCE((SELECT SUM(COALESCE(ol.packs_delivered, 0) * ol.qty_per_pack)
                          FROM order_lines ol
                          JOIN orders o ON o.id = ol.order_id
                         WHERE ol.product_id = p.id AND o.status = 'delivered'), 0) AS delivered_qty
         FROM products p
        WHERE p.active = 1
        ORDER BY p.name`
    )
    .all() as unknown as Omit<StockRow, "on_hand" | "value_toman" | "negative">[];

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

export interface PurchaseSummary {
  id: number;
  supplier: string | null;
  purchase_date: string;
  invoice_no: string | null;
  line_count: number;
  total_toman: number;
  entered_by: string | null;
}

export function readPurchases(db: DatabaseSync, limit = 100): PurchaseSummary[] {
  return db
    .prepare(
      `SELECT pu.id, pu.supplier, pu.purchase_date, pu.invoice_no,
              COUNT(pl.id) AS line_count,
              COALESCE(SUM(pl.base_qty * pl.unit_cost_toman), 0) AS total_toman,
              u.display_name AS entered_by
         FROM purchases pu
         LEFT JOIN purchase_lines pl ON pl.purchase_id = pu.id
         LEFT JOIN users u ON u.id = pu.created_by
        GROUP BY pu.id
        ORDER BY pu.purchase_date DESC, pu.id DESC
        LIMIT ?`
    )
    .all(limit) as unknown as PurchaseSummary[];
}
