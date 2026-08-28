import type { DatabaseSync } from "node:sqlite";
import { plain } from "./db";
import { lineTotalToman, lineKg, type LineSnapshot } from "./orderMath";

/** Everything the customer sheet (پنجرهٔ مشتری) puts on screen, in one read.
 *
 *  Takes the caller's scope fragment rather than the session, the same way readOrders
 *  does: the who-sees-what decision is made once, at the route, and this cannot be called
 *  without one. That is what keeps this from becoming a second authorisation surface.
 *
 *  Every figure is derived from DELIVERED lines. Ordered-but-not-delivered is a promise,
 *  and a customer summary that counted promises would flatter every account that has an
 *  open order sitting on a van.
 */
export interface CustomerSummary {
  customer_id: number;
  business_name: string;
  /** «منطقه ۵ · پونک» — whatever of city/province/address is actually known. */
  where: string | null;
  status: string | null;
  salesperson: string | null;
  /** Delivered spend in the window, in toman. */
  spend: number;
  order_count: number;
  average: number;
  kg: number;
  last_purchase_date: string | null;
  /** Outstanding across all three ageing buckets. */
  balance: number;
  balance_over_30: number;
  /** Newest first, at most five. */
  recent: { id: number; order_no: string; total_toman: number; order_date: string }[];
  /** This customer's delivered spend as a fraction of everything the caller can see in
   *  the same window, 0–1. Share of the whole book, NOT of a district: customers carry a
   *  city and an address but no district id, so a "share of منطقه" figure would have to
   *  be inferred from an address string and would be wrong in a way nobody could see. */
  share_of_book: number;
  /** How many days the window covers, so the label can say so. */
  window_days: number;
}

interface Row extends LineSnapshot {
  order_id: number;
  order_no: string;
  order_date: string;
  customer_id: number;
}

export function readCustomerSummary(
  db: DatabaseSync,
  scope: { sql: string; params: number[] },
  customerId: number,
  windowDays = 90
): CustomerSummary | null {
  const customer = plain(
    db
      .prepare(
        `SELECT id, business_name, city, province, address, status, salesperson,
                debt_0_7, debt_8_30, debt_30_plus, last_purchase_date
           FROM customers WHERE id = ?`
      )
      .all(customerId)
  )[0] as
    | {
        id: number;
        business_name: string;
        city: string | null;
        province: string | null;
        address: string | null;
        status: string | null;
        salesperson: string | null;
        debt_0_7: number;
        debt_8_30: number;
        debt_30_plus: number;
        last_purchase_date: string | null;
      }
    | undefined;
  if (!customer) return null;

  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);

  /* One query for every delivered line the caller may see in the window, then split in
     JS. Two queries -- one for this customer, one for the book -- would be two different
     moments in time, and the share could come out above 100%. */
  const lines = plain(
    db
      .prepare(
        `SELECT ol.packs_ordered, ol.packs_delivered, ol.unit_price_toman, ol.unit_cost_toman,
                ol.qty_per_pack, ol.kg_per_base_unit,
                o.id AS order_id, o.order_no, o.order_date, o.customer_id
           FROM order_lines ol
           JOIN orders o ON o.id = ol.order_id
          WHERE o.status = 'delivered' AND o.order_date >= ?${scope.sql}`
      )
      .all(since, ...scope.params)
  ) as unknown as Row[];

  let spend = 0;
  let kg = 0;
  let book = 0;
  const orders = new Map<number, { order_no: string; order_date: string; total: number }>();

  for (const l of lines) {
    const total = lineTotalToman(l);
    book += total;
    if (l.customer_id !== customerId) continue;
    spend += total;
    kg += lineKg(l);
    const seen = orders.get(l.order_id);
    if (seen) seen.total += total;
    else orders.set(l.order_id, { order_no: l.order_no, order_date: l.order_date, total });
  }

  const recent = [...orders.entries()]
    .map(([id, o]) => ({ id, order_no: o.order_no, total_toman: o.total, order_date: o.order_date }))
    .sort((a, b) => b.order_date.localeCompare(a.order_date) || b.id - a.id)
    .slice(0, 5);

  const where =
    [customer.city, customer.province].filter(Boolean).join(" · ") ||
    customer.address?.slice(0, 60) ||
    null;

  return {
    customer_id: customer.id,
    business_name: customer.business_name,
    where,
    status: customer.status,
    salesperson: customer.salesperson,
    spend,
    order_count: orders.size,
    // Guarded: a customer with no delivered order in the window is the normal state, and
    // a NaN here reaches the screen as "NaN تومان".
    average: orders.size === 0 ? 0 : Math.round(spend / orders.size),
    kg,
    /* The column if the workbook import has filled it, otherwise the newest delivered
       order actually on file. The column is maintained by the import and is null for
       anything created inside the app, so trusting it alone shows "—" beside a customer
       whose orders are listed two tiles across. */
    last_purchase_date: customer.last_purchase_date ?? recent[0]?.order_date ?? null,
    balance: customer.debt_0_7 + customer.debt_8_30 + customer.debt_30_plus,
    balance_over_30: customer.debt_30_plus,
    recent,
    share_of_book: book > 0 ? spend / book : 0,
    window_days: windowDays,
  };
}
