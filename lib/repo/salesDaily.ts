/* Saved daily sales totals (db/migrations/1762700100000_sales-daily.sql): the dashboard reads
 * these instead of adding up every delivered order on each visit.
 *
 * An edit to an order, a line or a payment marks the order's day. Before a read, the marked days
 * are recounted from the orders themselves, so a total is never older than the read that shows it.
 * Example: a payment on an order of 3 Mehr changes that order's paid amount; 3 Mehr is marked; the
 * next dashboard visit recounts 3 Mehr (a few orders) and reads every other day as saved.
 *
 * The recount takes a per-company lock, deletes the marks it read FIRST, then rewrites those days.
 * A writer that commits while it runs either was seen by the rewrite or left its own mark, which
 * this recount did not delete (it was not committed yet), so the day is recounted next time. */
import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";
import { round } from "@/lib/database/dialect";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";

/** A line's figures, rounded to whole Toman per line on the delivered packs when there are any,
 *  as lineTotalToman/lineCostToman do. */
const EFF = "COALESCE(ol.packs_delivered, ol.packs_ordered)";
const LINE_TOTAL = `CAST(${round(`${EFF} * ol.unit_price_toman`)} AS INTEGER)`;
const LINE_COST = `CAST(${round(`${EFF} * ol.unit_cost_toman`)} AS INTEGER)`;
const LINE_KG = `(${EFF} * ol.qty_per_pack * ol.kg_per_base_unit)`;

/** Recounts the marked days of every company the caller's scope can see, or of one. Returns how
 *  many days it rewrote. */
export async function refreshSalesDaily(organizationId: number | null, db: Db = getDb()): Promise<number> {
  const orgs = organizationId !== null
    ? [organizationId]
    : ((await db.prepare("SELECT DISTINCT organization_id AS id FROM sales_daily_marks").all()) as { id: number }[]).map((r) => r.id);
  let days = 0;
  for (const org of orgs) days += await refreshOrg(db, org);
  return days;
}

async function refreshOrg(db: Db, org: number): Promise<number> {
  // Cheap check outside the transaction: most reads find nothing marked.
  const any = await db.prepare("SELECT 1 AS x FROM sales_daily_marks WHERE organization_id = ? LIMIT 1").get(org);
  if (!any) return 0;
  return await db.tx(async () => {
    /* The web role stops any statement at 15 s (db/server/install.sh). The first recount after the
       migration marks every day there is, which on a Pi can take longer; this transaction alone
       may run for a few minutes. */
    await db.prepare("SET LOCAL statement_timeout = '5min'").run();
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext('sales_daily'), CAST(? AS int))").get(org);
    const top = (await db.prepare("SELECT MAX(id) AS id FROM sales_daily_marks WHERE organization_id = ?").get(org)) as { id: number | null };
    if (top.id === null) return 0;
    const marked = (await db
      .prepare("DELETE FROM sales_daily_marks WHERE organization_id = ? AND id <= ? RETURNING day")
      .all(org, top.id)) as { day: string }[];
    const days = [...new Set(marked.map((m) => m.day))];
    if (days.length === 0) return 0;
    const fulfilled = sqlStatusList(FULFILLED_ORDER_STATUSES);
    await db.prepare("DELETE FROM sales_daily WHERE organization_id = ? AND day = ANY(CAST(? AS text[]))").run(org, days as never);
    await db.prepare("DELETE FROM sales_daily_products WHERE organization_id = ? AND day = ANY(CAST(? AS text[]))").run(org, days as never);
    /* The same order set and the same per-order figures the dashboard always used (lib/dashboard.ts):
       its stored total, cost and weight, or the lines' sum when the stored figure is empty; an
       order with no lines is not a sale; the customer must exist. */
    await db
      .prepare(
        `INSERT INTO sales_daily (organization_id, day, group_id, salesperson_user_id, customer_id, orders, revenue, cost, kg, realized)
         SELECT ?, d, gid, sid, cid, COUNT(*), SUM(t), SUM(cst), SUM(kg),
                COALESCE(SUM(CASE WHEN t > 0 THEN ${round("(t - cst) * LEAST(GREATEST(pd, 0), t) / t")} ELSE 0 END), 0)
           FROM (
             SELECT left(o.order_date, 10) AS d, o.group_id AS gid, o.salesperson_user_id AS sid, o.customer_id AS cid,
                    COALESCE(o.total_toman, (SELECT SUM(${LINE_TOTAL}) FROM order_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.order_id = o.id)) AS t,
                    COALESCE(o.cost_toman, (SELECT SUM(${LINE_COST}) FROM order_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.order_id = o.id)) AS cst,
                    o.paid_toman AS pd,
                    COALESCE(o.kg_total, (SELECT SUM(${LINE_KG}) FROM order_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.order_id = o.id)) AS kg
               FROM orders o
               JOIN customers c ON c.id = o.customer_id
              WHERE o.organization_id = ? AND left(o.order_date, 10) = ANY(CAST(? AS text[]))
                AND o.status IN (${fulfilled})
                AND EXISTS (SELECT 1 FROM order_lines ol WHERE ol.order_id = o.id)
           ) ot
          GROUP BY d, gid, sid, cid`
      )
      .run(org, org, days as never);
    await db
      .prepare(
        `INSERT INTO sales_daily_products (organization_id, day, group_id, salesperson_user_id, product_id, revenue, kg)
         SELECT ?, left(o.order_date, 10), o.group_id, o.salesperson_user_id, p.id, SUM(${LINE_TOTAL}), SUM(${LINE_KG})
           FROM order_lines ol
           JOIN orders o ON o.id = ol.order_id
           JOIN customers c ON c.id = o.customer_id
           JOIN products p ON p.id = ol.product_id
          WHERE o.organization_id = ? AND left(o.order_date, 10) = ANY(CAST(? AS text[]))
            AND o.status IN (${fulfilled})
          GROUP BY left(o.order_date, 10), o.group_id, o.salesperson_user_id, p.id`
      )
      .run(org, org, days as never);
    return days.length;
  });
}
