import type { DatabaseSync } from "node:sqlite";
import type { LineSnapshot } from "@/lib/orderMath";

/** The money-and-weight columns of every line of the given orders, grouped by order.
 *
 *  Replaces "one query per order" loops: a commission statement walks every order a person
 *  ever sold, which on a real ledger is hundreds of thousands of tiny queries. Within an
 *  order the lines come back in id order, the same order `WHERE order_id = ?` gave, so
 *  floating-point sums over them (kilograms) are unchanged to the last digit. An order with
 *  no lines is absent from the map. */
export function linesByOrder(db: DatabaseSync, orderIds: number[]): Map<number, LineSnapshot[]> {
  const out = new Map<number, LineSnapshot[]>();
  const unique = [...new Set(orderIds)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const rows = db
      .prepare(
        `SELECT order_id, packs_ordered, packs_delivered, unit_price_toman, unit_cost_toman,
                qty_per_pack, kg_per_base_unit
           FROM order_lines
          WHERE order_id IN (${chunk.map(() => "?").join(",")})
          ORDER BY order_id, id`
      )
      .all(...chunk) as unknown as (LineSnapshot & { order_id: number })[];
    for (const { order_id, ...line } of rows) {
      const list = out.get(order_id);
      if (list) list.push(line);
      else out.set(order_id, [line]);
    }
  }
  return out;
}
