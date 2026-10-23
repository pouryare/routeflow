import type { Db } from "@/lib/database/client";
import { lineKg, lineTotalToman, lineCostToman, type LineSnapshot } from "../orderMath";

/** An order's weight in kilograms: its lines' kilograms added in line order, starting from zero.
 *
 *  This is the exact expression the commission ledgers have always evaluated per order, kept as
 *  the single definition so a stored value is bit-for-bit what they would have computed. It
 *  matters: kilograms are floats, floats do not add associatively, and the result is multiplied
 *  by a rate and rounded to whole Toman on payroll. */
export function orderKgOf(lines: LineSnapshot[]): number {
  return lines.reduce((total, line) => total + lineKg(line), 0);
}

/** The three per-order figures every report derives from an order's lines: weight, what it was
 *  charged for and what it cost, the last two in whole Toman with each line rounded BEFORE it is
 *  added (lineTotalToman / lineCostToman), which is what makes the sums exact integers. */
export interface OrderFigures {
  kg_total: number;
  total_toman: number;
  cost_toman: number;
}

export function orderFiguresOf(lines: LineSnapshot[]): OrderFigures {
  return {
    kg_total: orderKgOf(lines),
    total_toman: lines.reduce((total, line) => total + lineTotalToman(line), 0),
    cost_toman: lines.reduce((total, line) => total + lineCostToman(line), 0),
  };
}

const LINE_COLUMNS = `packs_ordered, packs_delivered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit`;

/** Recompute and store one order's figures (orders.kg_total, total_toman, cost_toman). Called after
 *  the three places that write an order's lines (creating one, recording a delivery, and splitting
 *  off a back-order). A trigger on order_lines voids all three on ANY change to a line, so a writer
 *  that forgets this leaves them empty -- and an empty value makes every reader work the figure out
 *  from the lines itself -- rather than leaving a stale one. They are a cache, never the truth. */
export async function refreshOrderFigures(db: Db, orderId: number): Promise<void> {
  const lines = await db
    .prepare(`SELECT ${LINE_COLUMNS} FROM order_lines WHERE order_id = ? ORDER BY id`)
    .all(orderId) as unknown as LineSnapshot[];
  const f = orderFiguresOf(lines);
  await db.prepare("UPDATE orders SET kg_total = ?, total_toman = ?, cost_toman = ? WHERE id = ?").run(
    f.kg_total,
    f.total_toman,
    f.cost_toman,
    orderId
  );
}

/** Fill in every order that is missing any of the three: orders that predate the columns, and any
 *  whose lines were changed by something other than the writers above. An order with no lines is
 *  stored as zero. Safe to run on every boot (a pass that finds nothing to do) and returns how many
 *  orders it filled. */
export async function backfillOrderFigures(db: Db): Promise<number> {
  // The write lock is taken BEFORE the read: lines read first and written later could
  // overwrite a figure a concurrent writer refilled in between with a stale one.
  return await db.tx(async () => {
    const rows = await db
      .prepare(
        `SELECT ol.order_id AS order_id, ${LINE_COLUMNS.split(", ").map((c) => `ol.${c}`).join(", ")}
           FROM order_lines ol JOIN orders o ON o.id = ol.order_id
          WHERE o.kg_total IS NULL OR o.total_toman IS NULL OR o.cost_toman IS NULL
          ORDER BY ol.order_id, ol.id`
      )
      .all() as unknown as (LineSnapshot & { order_id: number })[];

    const byOrder = new Map<number, LineSnapshot[]>();
    for (const { order_id, ...line } of rows) {
      const list = byOrder.get(order_id);
      if (list) list.push(line);
      else byOrder.set(order_id, [line]);
    }

    const set = db.prepare("UPDATE orders SET kg_total = ?, total_toman = ?, cost_toman = ? WHERE id = ?");
    for (const [orderId, lines] of byOrder) {
      const f = orderFiguresOf(lines);
      await set.run(f.kg_total, f.total_toman, f.cost_toman, orderId);
    }
    // What is still empty has no lines.
    await db.exec(
      "UPDATE orders SET kg_total = COALESCE(kg_total, 0), total_toman = COALESCE(total_toman, 0), cost_toman = COALESCE(cost_toman, 0) WHERE kg_total IS NULL OR total_toman IS NULL OR cost_toman IS NULL"
    );
    return byOrder.size;
  });
}
