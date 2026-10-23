import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { orgScopeId } from "@/lib/session";
import { salesDashboard, fillRateByDriver, type SalesDashboard } from "@/lib/dashboard";
import { stockPosition, type StockRow } from "@/lib/purchases";
import type { Statement } from "@/lib/commissionLedger";
import type { DriverStatement } from "@/lib/driverCommissionLedger";
import type { ManagerStatement } from "@/lib/managerCommissionLedger";
import { commissionStatementsFor } from "@/lib/repo/commissionView";
import { toJalali, jalaliToIsoDate } from "@/lib/jalali";
import { orderFilter } from "@/lib/session";
import { orderKg, orderTotalToman } from "@/lib/orderMath";
import { linesByOrder } from "@/lib/repo/orderLines";

/* What the dashboard page and its streamed sections read, as functions of the SESSION. The page
 * and the section components used to open the database themselves (`getDb()`, then pass the
 * handle and a hand-built scope to each reader); now they call these and never see a connection,
 * so the tenant and group scope is decided in one place per figure. */

/** The stat tiles and charts at the top of /sales/dashboard. */
export async function dashboardFor(session: Session): Promise<SalesDashboard> {
  return await salesDashboard(getDb(), session);
}

export interface MoneyFigures {
  commission: Statement[];
  driverCommission: DriverStatement[];
  managerCommission: ManagerStatement[];
}

/** This Jalali month's commission statements for «بدهی و پورسانت», as far as the caller may see
 *  them (see commissionStatementsFor). */
export async function moneyFor(session: Session): Promise<MoneyFigures> {
  const today = toJalali(new Date().toISOString())!;
  const { statements, driverStatements, managerStatements } = await commissionStatementsFor(session, {
    from: jalaliToIsoDate(today.jy, today.jm, 1),
    to: jalaliToIsoDate(today.jy, today.jm, today.jd),
  });
  return { commission: statements, driverCommission: driverStatements, managerCommission: managerStatements };
}

export interface StockFigures {
  stock: StockRow[];
  drivers: { label: string; value: number }[];
}

/** Warehouse position and each driver's fill rate for «انبار و تحویل». */
export async function stockFor(session: Session): Promise<StockFigures> {
  const db = getDb();
  return { stock: await stockPosition(db, orgScopeId(session)), drivers: await fillRateByDriver(db, session) };
}

export interface TeamToday {
  /** Who took today's orders: orders, kilograms and revenue per salesperson, busiest first, top five. */
  team: { name: string; n: number; kg: number; revenue: number }[];
  /** How many orders were placed today in the caller's scope. */
  orderCount: number;
  /** How many different people took them (before the top-five cut). */
  peopleCount: number;
}

/** Today's orders by the person who took them, for the sales home page. A count says three people
 *  were busy, not which one is carrying the day, so each entry also carries what the orders add up
 *  to. Scoped by orderFilter (organisation and group). Lines are read in one batched query, in
 *  line-id order within an order, so the kilogram sums are the same to the last digit as the
 *  one-query-per-order loop this replaced. */
export async function teamTodayFor(session: Session, todayIso: string): Promise<TeamToday> {
  const db = getDb();
  const scope = orderFilter(session);
  const orders = (
    await db
      .prepare(
        `SELECT o.id, COALESCE(u.display_name, 'بدون فروشنده') AS name
           FROM orders o
           LEFT JOIN users u ON u.id = o.salesperson_user_id
          WHERE o.order_date = ?${scope.sql}`
      )
      .all(todayIso, ...scope.params) as unknown as { id: number; name: string }[]
  ).map((o) => ({ id: o.id, name: o.name }));

  const lines = await linesByOrder(db, orders.map((o) => o.id));
  const byPerson = new Map<string, { name: string; n: number; kg: number; revenue: number }>();
  for (const o of orders) {
    const ls = lines.get(o.id) ?? [];
    const entry = byPerson.get(o.name) ?? { name: o.name, n: 0, kg: 0, revenue: 0 };
    entry.n += 1;
    entry.kg += orderKg(ls);
    entry.revenue += orderTotalToman(ls);
    byPerson.set(o.name, entry);
  }
  return {
    team: [...byPerson.values()].sort((a, b) => b.n - a.n).slice(0, 5),
    orderCount: orders.length,
    peopleCount: byPerson.size,
  };
}
