/** The legacy `sales` import table: purchase rows keyed by customer name, with no organisation of
 *  their own (they predate multi-tenancy). Two companies can have a customer of the same name, so
 *  a name match alone would hand one company the other's history. The rows are therefore served only
 *  to the company that existed when they were imported: the earliest organisation. */

import { getDb } from "@/lib/db";

function ownsLegacySales(organizationId: number | null): boolean {
  if (organizationId === null) return true; // platform owner viewing every company
  const first = getDb().prepare("SELECT MIN(id) AS id FROM organizations").get() as { id: number | null };
  return first.id === organizationId;
}

export function customerPurchaseHistory(customerName: string, organizationId: number | null) {
  if (!ownsLegacySales(organizationId)) return { orders: [], topProducts: [] };
  const db = getDb();
  const orders = db
    .prepare(
      `SELECT order_no, sale_date, product_name, qty, amount, payment_status, shipping_status
       FROM sales WHERE customer_name = ? ORDER BY sale_date DESC, id DESC LIMIT 50`
    )
    .all(customerName);
  const topProducts = db
    .prepare(
      `SELECT product_name, SUM(amount) as total_amount, COUNT(*) as line_count
       FROM sales WHERE customer_name = ? AND product_name IS NOT NULL
       GROUP BY product_name ORDER BY total_amount DESC LIMIT 5`
    )
    .all(customerName);
  return { orders, topProducts };
}

/** Whether the caller can see a customer of this name at all (their group scope, company included). */
export function customerNameVisible(name: string, filter: { sql: string; params: (string | number)[] }): boolean {
  return !!getDb().prepare(`SELECT 1 FROM customers WHERE business_name = ?${filter.sql} LIMIT 1`).get(name, ...filter.params);
}
