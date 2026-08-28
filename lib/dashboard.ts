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

import type { DatabaseSync } from "node:sqlite";
import { orderFilter, groupFilter, type Session } from "./session";
import { lineTotalToman, lineCostToman, lineKg, type LineSnapshot } from "./orderMath";
import { toJalali, JALALI_MONTHS } from "./jalali";

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
}

/** «1405-06» -- the Persian year and month an ISO date falls in.
 *
 *  Cannot be done in SQL: strftime knows only the Gregorian calendar, and a Persian
 *  month straddles two of them. 2026-08-20 and 2026-08-25 are the same Gregorian month
 *  and different Persian ones, which is exactly the case a report has to get right.
 */
export function jalaliMonthKey(iso: string): string {
  const j = toJalali(iso);
  if (!j) return iso.slice(0, 7);
  return `${j.jy}-${String(j.jm).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [, month] = key.split("-");
  return JALALI_MONTHS[Number(month) - 1] ?? key;
}

interface DeliveredLine extends LineSnapshot {
  order_id: number;
  order_date: string;
  customer_name: string;
  product_name: string;
  salesperson_name: string | null;
}

/** Sums a series, sorts it descending, and keeps the head. */
function rank(map: Map<string, number>, limit = 10): Series[] {
  return [...map.entries()]
    .map(([key, value]) => ({ key, label: key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export function salesDashboard(db: DatabaseSync, session: Session): SalesDashboard {
  const scope = orderFilter(session);

  // Every delivered line the caller may see, with the labels the charts group by. One
  // query rather than one per chart: the row count here is an order of magnitude below
  // anything worth paginating, and it keeps every figure on the page consistent with
  // every other by construction.
  const lines = db
    .prepare(
      `SELECT ol.packs_ordered, ol.packs_delivered, ol.unit_price_toman, ol.unit_cost_toman,
              ol.qty_per_pack, ol.kg_per_base_unit,
              o.id AS order_id, o.order_date,
              c.business_name AS customer_name,
              p.name AS product_name,
              u.display_name AS salesperson_name
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
         JOIN customers c ON c.id = o.customer_id
         JOIN products p ON p.id = ol.product_id
         LEFT JOIN users u ON u.id = o.salesperson_user_id
        WHERE o.status = 'delivered'${scope.sql}`
    )
    .all(...scope.params) as unknown as DeliveredLine[];

  // Ordered/delivered packs across everything confirmed or beyond, for fill rate. A
  // draft has not been agreed yet, so including it would read as under-delivery.
  const packs = db
    .prepare(
      `SELECT COALESCE(SUM(ol.packs_ordered), 0) AS ordered,
              COALESCE(SUM(COALESCE(ol.packs_delivered, 0)), 0) AS delivered
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
        WHERE o.status IN ('confirmed', 'delivered', 'cancelled')${scope.sql}`
    )
    .get(...scope.params) as { ordered: number; delivered: number };

  const statusRows = db
    .prepare(
      `SELECT o.status, COUNT(*) AS n FROM orders o WHERE 1 = 1${scope.sql} GROUP BY o.status`
    )
    .all(...scope.params) as unknown as { status: string; n: number }[];

  const byDay = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byProduct = new Map<string, number>();
  const bySalesperson = new Map<string, number>();
  const byCustomer = new Map<string, number>();
  const orderTotals = new Map<number, number>();

  let revenue = 0;
  let cost = 0;
  let kg = 0;

  for (const line of lines) {
    const total = lineTotalToman(line);
    revenue += total;
    cost += lineCostToman(line);
    kg += lineKg(line);

    const day = line.order_date.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + total);

    const month = jalaliMonthKey(line.order_date);
    byMonth.set(month, (byMonth.get(month) ?? 0) + total);

    byProduct.set(line.product_name, (byProduct.get(line.product_name) ?? 0) + total);
    byCustomer.set(line.customer_name, (byCustomer.get(line.customer_name) ?? 0) + total);
    if (line.salesperson_name) {
      bySalesperson.set(
        line.salesperson_name,
        (bySalesperson.get(line.salesperson_name) ?? 0) + total
      );
    }
    orderTotals.set(line.order_id, (orderTotals.get(line.order_id) ?? 0) + total);
  }

  // Customers and debt come from the customer table, which is group-scoped rather than
  // order-scoped -- a shop with no orders yet is still in the territory.
  const customerScope = groupFilter(session);
  const debt = db
    .prepare(
      `SELECT COALESCE(SUM(debt_0_7), 0) AS d0_7,
              COALESCE(SUM(debt_8_30), 0) AS d8_30,
              COALESCE(SUM(debt_30_plus), 0) AS over_30,
              COUNT(*) AS n
         FROM customers WHERE 1 = 1${customerScope.sql}`
    )
    .get(...customerScope.params) as {
    d0_7: number;
    d8_30: number;
    over_30: number;
    n: number;
  };

  const orderCount = orderTotals.size;

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
  };
}

/** Packs ordered against packs delivered, per driver -- who leaves goods on the van. */
export function fillRateByDriver(db: DatabaseSync, session: Session): Series[] {
  const scope = orderFilter(session);
  const rows = db
    .prepare(
      `SELECT u.display_name AS name,
              COALESCE(SUM(ol.packs_ordered), 0) AS ordered,
              COALESCE(SUM(COALESCE(ol.packs_delivered, 0)), 0) AS delivered
         FROM delivery_stops ds
         JOIN delivery_runs dr ON dr.id = ds.run_id
         JOIN users u ON u.id = dr.driver_user_id
         JOIN orders o ON o.id = ds.order_id
         JOIN order_lines ol ON ol.order_id = o.id
        WHERE o.status IN ('delivered', 'cancelled')${scope.sql}
        GROUP BY u.id`
    )
    .all(...scope.params) as unknown as { name: string; ordered: number; delivered: number }[];

  return rows.map((row) => ({
    key: row.name,
    label: row.name,
    value: row.ordered > 0 ? Math.round((row.delivered / row.ordered) * 100) : 0,
  }));
}
