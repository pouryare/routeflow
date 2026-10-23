/** The figures behind the dashboards.
 *
 *  All of it derives from the frozen order lines rather than from any stored total, so
 *  a dashboard cannot disagree with the order it is summarising. Revenue is measured on
 *  **delivered** quantities throughout -- the same rule the invoice and the commission
 *  follow -- so a chart cannot show money that never arrived.
 *
 *  Every aggregate goes through orderFilter, which is what makes the owner's, the
 *  manager's and the فروشنده's version of this page three views of one query rather
 *  than three queries that have to be kept in step.
 */

import type { Db } from "@/lib/database/client";
import { orderFilter, groupFilter, type Session } from "./session";
import { customerDebtsForOrgOnce } from "./repo/payments";
import {
  FULFILLED_ORDER_STATUSES,
  PRICED_ORDER_STATUSES,
  sqlStatusList,
} from "./orderStateMachine";
import { jalaliMonthKey, JALALI_MONTHS, JALALI_WEEKDAYS } from "./jalali";

export interface Series {
  key: string;
  label: string;
  value: number;
}

export interface SalesDashboard {
  revenue_toman: number;
  /** Charged less cost, both on delivered quantities. Not meaningful for a فروشنده, who
   *  never sees a product's cost anywhere else in the app -- callers gate its display on
   *  role, the same way PurchaseEntry gates entering a cost in the first place. */
  margin_toman: number;
  order_count: number;
  average_order_toman: number;
  kg: number;
  /** Delivered packs over ordered packs. Zero when nothing has been ordered. */
  fill_rate: number;
  debt: { total: number; d0_7: number; d8_30: number; over_30: number };
  customer_count: number;
  revenue_by_day: Series[];
  revenue_by_month: Series[];
  revenue_by_product: Series[];
  revenue_by_salesperson: Series[];
  top_customers: Series[];
  status_mix: Series[];
  /** Saturday first, matching the week every other date on this app already reads in. */
  revenue_by_weekday: Series[];
  /** Same products as revenue_by_product, ranked by kilogram instead of toman -- a
   *  cheap, heavy product and an expensive, light one can trade places between the two,
   *  and which one that is is itself worth seeing. */
  top_products_by_kg: Series[];
  /** New customers per month -- their first order ever, not their first in the window,
   *  so a customer who has bought for years does not look "new" just because the chart
   *  only looked back 12 months. */
  new_customers_by_month: Series[];
  /** Days from order_date to delivered_at, averaged over delivered orders that have
   *  both. Null rather than 0 when nothing qualifies -- 0 days would read as same-day
   *  delivery being the norm, which "no data yet" is not the same claim as. */
  avg_lead_days: number | null;
}

/** «1405-06» -- the Persian year and month an ISO date falls in.
 *
 *  Cannot be done in SQL: strftime knows only the Gregorian calendar, and a Persian
 *  month straddles two of them. 2026-08-20 and 2026-08-25 are the same Gregorian month
 *  and different Persian ones, which is exactly the case a report has to get right.
 */
export { jalaliMonthKey };

function monthLabel(key: string): string {
  const [, month] = key.split("-");
  return JALALI_MONTHS[Number(month) - 1] ?? key;
}

/** Sums a series, sorts it descending, and keeps the head. */
function rank(map: Map<string, number>, limit = 10): Series[] {
  return [...map.entries()]
    .map(([key, value]) => ({ key, label: key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export async function salesDashboard(db: Db, session: Session): Promise<SalesDashboard> {
  const scope = orderFilter(session);

  /* Everything the charts group by, aggregated in SQL in two passes instead of loading every
     delivered line (148k on a 78k-order ledger) into JS.
     - `ot`: one row per delivered order -- its total, cost and weight, read from the figures
       stored on the order (lib/repo/orderFigures.ts) and summed from the lines only for an
       order whose stored figure is empty. Customer, date and salesperson are properties of the
       ORDER, so all of those breakdowns come from here. An order with no lines is not a sale.
     - the product rows need the line level, so they get their own grouped scan.
     Each line is rounded to whole Toman before it is added (round half away from zero, on the
     delivered packs when there are any), exactly as lineTotalToman/lineCostToman do, so the
     money columns are the same integers the old per-line JS arithmetic produced. Weight is a
     float sum and SQLite adds it with compensated summation, so kilograms can differ from the
     old naive sum in the last digit or two; nothing downstream depends on more than that.
     The inner joins mirror the old row-by-row query so the same orders are counted. */
  const EFF = "COALESCE(ol.packs_delivered, ol.packs_ordered)";
  const LINE_TOTAL = `CAST(ROUND(${EFF} * ol.unit_price_toman) AS INTEGER)`;
  const LINE_COST = `CAST(ROUND(${EFF} * ol.unit_cost_toman) AS INTEGER)`;
  const LINE_KG = `(${EFF} * ol.qty_per_pack * ol.kg_per_base_unit)`;
  const fulfilled = sqlStatusList(FULFILLED_ORDER_STATUSES);

  const agg = await db
    .prepare(
      `WITH ot AS MATERIALIZED (
         SELECT o.id AS oid, o.order_date AS od, o.customer_id AS cid, o.salesperson_user_id AS sid,
                COALESCE(o.total_toman, (SELECT SUM(${LINE_TOTAL}) FROM order_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.order_id = o.id)) AS t,
                COALESCE(o.cost_toman, (SELECT SUM(${LINE_COST}) FROM order_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.order_id = o.id)) AS cst,
                COALESCE(o.kg_total, (SELECT SUM(${LINE_KG}) FROM order_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.order_id = o.id)) AS kg
           FROM orders o
           JOIN customers c ON c.id = o.customer_id
          WHERE o.status IN (${fulfilled})${scope.sql}
            AND EXISTS (SELECT 1 FROM order_lines ol WHERE ol.order_id = o.id)
       )
       SELECT 'tot' AS kind, NULL AS label, SUM(t) AS a, SUM(cst) AS b, SUM(kg) AS c, COUNT(*) AS n FROM ot
       UNION ALL
       SELECT 'date', od, SUM(t), NULL, NULL, NULL FROM ot GROUP BY od
       UNION ALL
       SELECT 'cust', c.business_name, SUM(ot.t), NULL, NULL, NULL
         FROM ot JOIN customers c ON c.id = ot.cid GROUP BY c.business_name
       UNION ALL
       SELECT 'rep', u.display_name, SUM(ot.t), NULL, NULL, NULL
         FROM ot JOIN users u ON u.id = ot.sid
        WHERE u.display_name IS NOT NULL AND u.display_name <> '' GROUP BY u.display_name`
    )
    .all(...scope.params) as unknown as {
    kind: "tot" | "date" | "cust" | "rep";
    label: string | null;
    a: number | null;
    b: number | null;
    c: number | null;
    n: number | null;
  }[];

  const productRows = await db
    .prepare(
      `SELECT p.name AS label, SUM(${LINE_TOTAL}) AS total, SUM(${LINE_KG}) AS kg
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
         JOIN customers c ON c.id = o.customer_id
         JOIN products p ON p.id = ol.product_id
        WHERE o.status IN (${fulfilled})${scope.sql}
        GROUP BY p.name`
    )
    .all(...scope.params) as unknown as { label: string; total: number; kg: number }[];

  // Ordered/delivered packs across everything confirmed or beyond, for fill rate. A
  // draft has not been agreed yet, so including it would read as under-delivery.
  const packs = await db
    .prepare(
      `SELECT COALESCE(SUM(ol.packs_ordered), 0) AS ordered,
              COALESCE(SUM(COALESCE(ol.packs_delivered, 0)), 0) AS delivered
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
        WHERE o.status IN (${sqlStatusList([...PRICED_ORDER_STATUSES, "CANCELLED"])})${scope.sql}`
    )
    .get(...scope.params) as { ordered: number; delivered: number };

  const statusRows = await db
    .prepare(
      `SELECT o.status, COUNT(*) AS n FROM orders o WHERE 1 = 1${scope.sql} GROUP BY o.status`
    )
    .all(...scope.params) as unknown as { status: string; n: number }[];

  const byDay = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byProduct = new Map<string, number>();
  const byProductKg = new Map<string, number>();
  const bySalesperson = new Map<string, number>();
  const byCustomer = new Map<string, number>();
  const byWeekday = new Map<number, number>();

  // Ties in a ranked list are broken by name. The old code broke them by whichever row the
  // database happened to return first, which is to say not at all.
  const byLabel = <T extends { label: string | null }>(rows: T[]) =>
    [...rows].sort((x, y) => (x.label ?? "").localeCompare(y.label ?? ""));

  let revenue = 0;
  let cost = 0;
  let kg = 0;
  let orderCount = 0;

  for (const row of agg) {
    if (row.kind === "tot") {
      revenue = row.a ?? 0;
      cost = row.b ?? 0;
      kg = row.c ?? 0;
      orderCount = row.n ?? 0;
    }
  }
  for (const row of byLabel(agg.filter((r) => r.kind === "cust"))) byCustomer.set(row.label!, row.a ?? 0);
  for (const row of byLabel(agg.filter((r) => r.kind === "rep"))) bySalesperson.set(row.label!, row.a ?? 0);
  for (const row of byLabel(productRows)) {
    byProduct.set(row.label, row.total);
    byProductKg.set(row.label, row.kg);
  }

  /* The date rows are one per distinct order_date, so the Jalali month and the weekday are
     worked out once per date rather than once per line. The weekday is Saturday-first and
     built from the civil date at UTC midnight, never a Date parsed from a full ISO instant:
     a local-timezone parse can land on the wrong side of midnight and shift every bar by one
     day (jalaliMonthGrid does the same for the same reason). */
  for (const row of agg) {
    if (row.kind !== "date") continue;
    const total = row.a ?? 0;
    const orderDate = row.label!;
    const day = orderDate.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + total);
    const month = jalaliMonthKey(orderDate);
    byMonth.set(month, (byMonth.get(month) ?? 0) + total);
    const [gy, gm, gd] = day.split("-").map(Number);
    const weekday = (new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay() + 1) % 7;
    byWeekday.set(weekday, (byWeekday.get(weekday) ?? 0) + total);
  }

  // Customers and debt come from the customer table, which is group-scoped rather than
  // order-scoped -- a shop with no orders yet is still in the territory.
  // Debt is computed from delivered orders and payment allocations now, not stored on
  // the customer row. customerDebtsForOrg does the whole organisation in one pass; this
  // page then keeps only the customers the viewer's territory can reach.
  const customerScope = await groupFilter(session);
  const scopedCustomers = await db
    .prepare(`SELECT id FROM customers WHERE 1 = 1${customerScope.sql}`)
    .all(...customerScope.params) as unknown as { id: number }[];
  const debtByCustomer = await customerDebtsForOrgOnce(session.organizationId);
  const debt = { d0_7: 0, d8_30: 0, over_30: 0, n: scopedCustomers.length };
  for (const { id } of scopedCustomers) {
    const d = debtByCustomer.get(id);
    if (!d) continue;
    debt.d0_7 += d.bucket_0_7;
    debt.d8_30 += d.bucket_8_30;
    debt.over_30 += d.bucket_30_plus;
  }

  // Lead time: one row per ORDER, not per line -- a five-line order counted once per
  // line would weight itself five times into the average for no reason connected to how
  // long it took to arrive.
  const leadRows = await db
    .prepare(
      `SELECT o.order_date, o.delivered_at
         FROM orders o
        WHERE o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)}) AND o.delivered_at IS NOT NULL${scope.sql}`
    )
    .all(...scope.params) as unknown as { order_date: string; delivered_at: string }[];
  const leadDays = leadRows
    .map((r) => (new Date(r.delivered_at).getTime() - new Date(r.order_date).getTime()) / 86_400_000)
    // A delivery logged before its own order date is a data-entry problem, not a
    // negative lead time -- excluded rather than let it pull the average below zero.
    .filter((d) => d >= 0);
  const avgLeadDays = leadDays.length === 0 ? null : leadDays.reduce((a, b) => a + b, 0) / leadDays.length;

  // First order ever per customer, not first in the reporting window -- a customer who
  // has bought for years must not look "new" just because revenue_by_day only looks
  // back 30 days. Scoped the same way orders are everywhere else on this page.
  const firstOrderRows = await db
    .prepare(
      `SELECT c.id, MIN(o.order_date) AS first_date
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE 1 = 1${scope.sql}
        GROUP BY c.id`
    )
    .all(...scope.params) as unknown as { id: number; first_date: string }[];
  const byNewCustomerMonth = new Map<string, number>();
  for (const row of firstOrderRows) {
    const month = jalaliMonthKey(row.first_date);
    byNewCustomerMonth.set(month, (byNewCustomerMonth.get(month) ?? 0) + 1);
  }

  return {
    revenue_toman: revenue,
    margin_toman: revenue - cost,
    order_count: orderCount,
    // Guarded: an empty dashboard is the normal state for months, and a NaN in an SVG
    // path attribute makes the entire chart vanish with no error anywhere.
    average_order_toman: orderCount === 0 ? 0 : Math.round(revenue / orderCount),
    kg,
    fill_rate: packs.ordered > 0 ? packs.delivered / packs.ordered : 0,
    debt: {
      total: debt.d0_7 + debt.d8_30 + debt.over_30,
      d0_7: debt.d0_7,
      d8_30: debt.d8_30,
      over_30: debt.over_30,
    },
    customer_count: debt.n,
    // Chronological, newest first -- LineChart draws index 0 at the right edge.
    revenue_by_day: [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 30)
      .map(([key, value]) => ({ key, label: key, value })),
    revenue_by_month: [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 12)
      .map(([key, value]) => ({ key, label: monthLabel(key), value })),
    revenue_by_product: rank(byProduct),
    revenue_by_salesperson: rank(bySalesperson),
    top_customers: rank(byCustomer),
    status_mix: statusRows.map((row) => ({
      key: row.status,
      label: row.status,
      value: row.n,
    })),
    // Saturday first (index 0), all seven days even when one sold nothing -- a missing
    // Friday would otherwise look like a six-day week rather than a zero-revenue one.
    revenue_by_weekday: JALALI_WEEKDAYS.map((label, i) => ({
      key: String(i),
      label,
      value: byWeekday.get(i) ?? 0,
    })),
    top_products_by_kg: rank(byProductKg),
    new_customers_by_month: [...byNewCustomerMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 12)
      .map(([key, value]) => ({ key, label: monthLabel(key), value })),
    avg_lead_days: avgLeadDays,
  };
}

/** Packs ordered against packs delivered, per driver -- who leaves goods on the van. */
export async function fillRateByDriver(db: Db, session: Session): Promise<Series[]> {
  const scope = orderFilter(session);
  const rows = await db
    .prepare(
      `SELECT u.display_name AS name,
              COALESCE(SUM(ol.packs_ordered), 0) AS ordered,
              COALESCE(SUM(COALESCE(ol.packs_delivered, 0)), 0) AS delivered
         FROM delivery_stops ds
         JOIN delivery_runs dr ON dr.id = ds.run_id
         JOIN users u ON u.id = dr.driver_user_id
         JOIN orders o ON o.id = ds.order_id
         JOIN order_lines ol ON ol.order_id = o.id
        WHERE o.status IN (${sqlStatusList([...FULFILLED_ORDER_STATUSES, "CANCELLED"])})${scope.sql}
        GROUP BY u.id`
    )
    .all(...scope.params) as unknown as { name: string; ordered: number; delivered: number }[];

  return rows.map((row) => ({
    key: row.name,
    label: row.name,
    value: row.ordered > 0 ? Math.round((row.delivered / row.ordered) * 100) : 0,
  }));
}
