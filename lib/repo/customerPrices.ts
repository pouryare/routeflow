import { getDb } from "@/lib/db";

/** F89: what one customer was charged for each product, newest first, read from the order lines,
 *  which freeze the price they were sold at. `list_price_toman` is the dated list price the line
 *  pointed at (`price_id`), so a price given below list reads as such.
 *
 *  Draft and cancelled orders are left out: a draft was never charged and a cancelled order was
 *  never sold. `scope` is the caller's orderFilter fragment on alias `o`, so a salesperson sees
 *  the prices on their own orders only, as with the order list beside it. */

interface PricePoint {
  order_id: number;
  order_date: string;
  unit_price_toman: number;
  list_price_toman: number | null;
}

export interface ProductPrices {
  product_id: number;
  product_name: string;
  packaging_id: number;
  packaging_name: string;
  points: PricePoint[];
}

export function customerPriceHistory(
  scope: { sql: string; params: number[] },
  customerId: number,
  perProduct = 5
): ProductPrices[] {
  const rows = getDb()
    .prepare(
      `SELECT ol.product_id, p.name AS product_name, ol.packaging_id, pk.name AS packaging_name,
              o.id AS order_id, o.order_date, ol.unit_price_toman, pp.price_toman AS list_price_toman
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
         JOIN products p ON p.id = ol.product_id
         JOIN packagings pk ON pk.id = ol.packaging_id
         LEFT JOIN product_prices pp ON pp.id = ol.price_id
        WHERE o.customer_id = ? AND o.status NOT IN ('DRAFT', 'CANCELLED')${scope.sql}
        ORDER BY o.order_date DESC, o.id DESC, ol.id DESC`
    )
    .all(customerId, ...scope.params) as unknown as Array<
    Omit<ProductPrices, "points"> & PricePoint
  >;

  const byKey = new Map<string, ProductPrices>();
  for (const r of rows) {
    const key = `${r.product_id}:${r.packaging_id}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { product_id: r.product_id, product_name: r.product_name, packaging_id: r.packaging_id, packaging_name: r.packaging_name, points: [] };
      byKey.set(key, entry);
    }
    if (entry.points.length < perProduct) {
      entry.points.push({
        order_id: r.order_id,
        order_date: r.order_date,
        unit_price_toman: r.unit_price_toman,
        list_price_toman: r.list_price_toman,
      });
    }
  }
  // Products in the order of their most recent sale, which is the order rows arrived in.
  return [...byKey.values()];
}
