import type { DatabaseSync } from "node:sqlite";
import { lineKg, type LineSnapshot } from "../orderMath";

/** An order's weight in kilograms: its lines' kilograms added in line order, starting from zero.
 *
 *  This is the exact expression the commission ledgers have always evaluated per order, kept as
 *  the single definition so a stored value is bit-for-bit what they would have computed. It
 *  matters: kilograms are floats, floats do not add associatively, and the result is multiplied
 *  by a rate and rounded to whole Toman on payroll. */
export function orderKgOf(lines: LineSnapshot[]): number {
  return lines.reduce((total, line) => total + lineKg(line), 0);
}

const LINE_COLUMNS = `packs_ordered, packs_delivered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit`;

/** Recompute and store one order's weight. Called after the three places that write an order's
 *  lines (creating one, recording a delivery, and splitting off a back-order). A trigger on
 *  order_lines voids the stored value on ANY change to a line, so a writer that forgets this
 *  leaves the value empty -- and an empty value makes the ledgers add the lines up themselves --
 *  rather than leaving a stale one. */
export function refreshOrderKg(db: DatabaseSync, orderId: number): void {
  const lines = db
    .prepare(`SELECT ${LINE_COLUMNS} FROM order_lines WHERE order_id = ? ORDER BY id`)
    .all(orderId) as unknown as LineSnapshot[];
  db.prepare("UPDATE orders SET kg_total = ? WHERE id = ?").run(orderKgOf(lines), orderId);
}

/** Fill in every order whose weight is missing: orders that predate the column, and any whose lines
 *  were changed by something other than the writers above. An order with no lines weighs zero.
 *  Safe to run on every boot (a pass over orders that finds nothing to do) and returns how many it
 *  filled. */
export function backfillOrderKg(db: DatabaseSync): number {
  const rows = db
    .prepare(
      `SELECT ol.order_id AS order_id, ${LINE_COLUMNS.split(", ").map((c) => `ol.${c}`).join(", ")}
         FROM order_lines ol JOIN orders o ON o.id = ol.order_id
        WHERE o.kg_total IS NULL
        ORDER BY ol.order_id, ol.id`
    )
    .all() as unknown as (LineSnapshot & { order_id: number })[];

  // Same accumulation as orderKgOf, one order at a time, in line order.
  const totals = new Map<number, number>();
  for (const { order_id, ...line } of rows) {
    totals.set(order_id, (totals.get(order_id) ?? 0) + lineKg(line));
  }

  const set = db.prepare("UPDATE orders SET kg_total = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const [orderId, kg] of totals) set.run(kg, orderId);
    // What is still empty has no lines.
    db.exec("UPDATE orders SET kg_total = 0 WHERE kg_total IS NULL");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return totals.size;
}
