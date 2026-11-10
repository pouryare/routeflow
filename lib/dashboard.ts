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
import { orderFilter, groupFilter, orgScopeId, scopeView, type Session } from "./session";
import { isVanRole } from "./roles";
import { refreshSalesDaily } from "./repo/salesDaily";
import { addDaysIso } from "./flows/dates";
import { customerDebtsForOrgOnce } from "./repo/payments";
import {
  FULFILLED_ORDER_STATUSES,
  PRICED_ORDER_STATUSES,
  sqlStatusList,
} from "./orderStateMachine";
import { jalaliMonthKey, JALALI_MONTHS, JALALI_WEEKDAYS, tehranTodayIso } from "./jalali";

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
  /** Margin on delivered orders split by how much of each order the customer has paid: an
   *  order paid 40% has realized 40% of its margin. `realized + unrealized = margin_toman`. */
  profit: { realized_toman: number; unrealized_toman: number };
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

/** The last `n` calendar days up to `endIso`, newest first, a day with no sales as 0 (T15). Built
 *  from the calendar and not from the days that had orders: with only the order days, one empty
 *  day shifted every bar, and "this week" against "last week" compared different weekdays. Dates
 *  are stepped at UTC midnight so no timezone can skip or repeat a day. */
export function calendarDays(byDay: Map<string, number>, endIso: string, n: number): Series[] {
  const [y, m, d] = endIso.slice(0, 10).split("-").map(Number);
  const end = Date.UTC(y, m - 1, d);
  return Array.from({ length: n }, (_, i) => {
    const key = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    return { key, label: key, value: byDay.get(key) ?? 0 };
  });
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

/** `range` limits the order figures (revenue, margin, orders, kilograms and their breakdowns, fill
 *  rate, status mix, lead time) to orders dated on those days, inclusive; an empty end is open.
 *  Debt and new customers by month stay all-time; revenue_by_day is always the last 30 days. */
export async function salesDashboard(db: Db, session: Session, range: { from: string; to: string } = { from: "", to: "" }): Promise<SalesDashboard> {
  const scope = orderFilter(session);

  /* Sales figures come from the saved daily totals (lib/repo/salesDaily.ts): one row per day,
     group, salesperson and customer, recounted from the orders for any day an edit marked, just
     before this read. They hold the same per-order figures this page always added up -- the
     stored total, cost and weight of each delivered order, or its lines' sum when that is empty --
     so the numbers are the same; only the work of adding them up moved. The scope is the same
     orderFilter, on the totals' own organization_id, group_id and salesperson_user_id. A van role
     is scoped by its runs, which the totals do not carry; its screens never reach this page. */
  if (isVanRole(scopeView(session).role)) throw new Error("salesDashboard: van roles are scoped by run");
  await refreshSalesDaily(orgScopeId(session), db);
  const sd = orderFilter(session, "s");
  const days: string[] = [];
  const params: unknown[] = [];
  if (range.from) {
    days.push(" AND s.day >= ?");
    params.push(range.from);
  }
  if (range.to) {
    days.push(" AND s.day <= ?");
    params.push(range.to);
  }
  const inRange = days.join("");
  // The same days on the orders themselves, for fill rate, status mix and lead time.
  const oRange = inRange.replaceAll("s.day", "left(o.order_date, 10)");
  const today = tehranTodayIso();

  const agg = await db
    .prepare(
      `SELECT 'tot' AS kind, NULL AS label, SUM(s.revenue) AS a, SUM(s.cost) AS b, SUM(s.kg) AS c, SUM(s.orders) AS n, SUM(s.realized) AS r
         FROM sales_daily s WHERE 1 = 1${inRange}${sd.sql}
       UNION ALL
       SELECT 'date', s.day, SUM(s.revenue), NULL, NULL, NULL, NULL FROM sales_daily s WHERE 1 = 1${inRange}${sd.sql} GROUP BY s.day
       UNION ALL
       SELECT 'last30', s.day, SUM(s.revenue), NULL, NULL, NULL, NULL FROM sales_daily s WHERE s.day >= ? AND s.day <= ?${sd.sql} GROUP BY s.day
       UNION ALL
       SELECT 'cust', c.business_name, SUM(s.revenue), NULL, NULL, NULL, NULL
         FROM sales_daily s JOIN customers c ON c.id = s.customer_id WHERE 1 = 1${inRange}${sd.sql} GROUP BY c.business_name
       UNION ALL
       SELECT 'rep', u.display_name, SUM(s.revenue), NULL, NULL, NULL, NULL
         FROM sales_daily s JOIN users u ON u.id = s.salesperson_user_id
        WHERE u.display_name IS NOT NULL AND u.display_name <> ''${inRange}${sd.sql} GROUP BY u.display_name`
    )
    .all(
      ...(params as never[]), ...sd.params,
      ...(params as never[]), ...sd.params,
      addDaysIso(today, -29), today, ...sd.params,
      ...(params as never[]), ...sd.params,
      ...(params as never[]), ...sd.params
    ) as unknown as {
    kind: "tot" | "date" | "last30" | "cust" | "rep";
    label: string | null;
    a: number | null;
    b: number | null;
    c: number | null;
    n: number | null;
    r: number | null;
  }[];

  const productRows = await db
    .prepare(
      `SELECT p.name AS label, SUM(s.revenue) AS total, SUM(s.kg) AS kg
         FROM sales_daily_products s
         JOIN products p ON p.id = s.product_id
        WHERE 1 = 1${inRange}${sd.sql}
        GROUP BY p.name`
    )
    .all(...(params as never[]), ...sd.params) as unknown as { label: string; total: number; kg: number }[];

  // Ordered/delivered packs across everything confirmed or beyond, for fill rate. A
  // draft has not been agreed yet, so including it would read as under-delivery.
  const packs = await db
    .prepare(
      `SELECT COALESCE(SUM(ol.packs_ordered), 0) AS ordered,
              COALESCE(SUM(COALESCE(ol.packs_delivered, 0)), 0) AS delivered
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
        WHERE o.status IN (${sqlStatusList([...PRICED_ORDER_STATUSES, "CANCELLED"])})${oRange}${scope.sql}`
    )
    .get(...(params as never[]), ...scope.params) as { ordered: number; delivered: number };

  const statusRows = await db
    .prepare(
      `SELECT o.status, COUNT(*) AS n FROM orders o WHERE 1 = 1${oRange}${scope.sql} GROUP BY o.status`
    )
    .all(...(params as never[]), ...scope.params) as unknown as { status: string; n: number }[];

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
  let realized = 0;

  for (const row of agg) {
    if (row.kind === "tot") {
      realized = Number(row.r ?? 0);
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
  for (const row of agg) if (row.kind === "last30") byDay.set(row.label!, row.a ?? 0);
  for (const row of agg) {
    if (row.kind !== "date") continue;
    const total = row.a ?? 0;
    const orderDate = row.label!;
    const day = orderDate.slice(0, 10);
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
        WHERE o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)}) AND o.delivered_at IS NOT NULL${oRange}${scope.sql}`
    )
    .all(...(params as never[]), ...scope.params) as unknown as { order_date: string; delivered_at: string }[];
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
    profit: { realized_toman: realized, unrealized_toman: revenue - cost - realized },
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
    revenue_by_day: calendarDays(byDay, tehranTodayIso(), 30),
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
