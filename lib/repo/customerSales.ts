/** The legacy `sales` import table: purchase rows keyed by customer name. They now carry the company they
 *  belong to (organization_id, stamped to the original company when the column was added), so a same-named
 *  customer in another company no longer shares history. */

import { getDb } from "@/lib/db";
import { orgClause } from "@/lib/orgScope";

export function customerPurchaseHistory(customerName: string, organizationId: number | null) {
  const db = getDb();
  const org = orgClause("organization_id", organizationId);
  const orders = db
    .prepare(
      `SELECT order_no, sale_date, product_name, qty, amount, payment_status, shipping_status
       FROM sales WHERE customer_name = ?${org.sql} ORDER BY sale_date DESC, id DESC LIMIT 50`
    )
    .all(customerName, ...org.params);
  const topProducts = db
    .prepare(
      `SELECT product_name, SUM(amount) as total_amount, COUNT(*) as line_count
       FROM sales WHERE customer_name = ? AND product_name IS NOT NULL${org.sql}
       GROUP BY product_name ORDER BY total_amount DESC LIMIT 5`
    )
    .all(customerName, ...org.params);
  return { orders, topProducts };
}

/** Whether the caller can see a customer of this name at all (their group scope, company included). */
export function customerNameVisible(name: string, filter: { sql: string; params: (string | number)[] }): boolean {
  return !!getDb().prepare(`SELECT 1 FROM customers WHERE business_name = ?${filter.sql} LIMIT 1`).get(name, ...filter.params);
}
