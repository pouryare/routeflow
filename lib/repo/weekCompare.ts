import { getDb } from "@/lib/db";
import { crmFilter, orderFilter, type Session } from "@/lib/session";
import { FULFILLED_ORDER_STATUSES, PRICED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { MANAGE_ROLES } from "@/lib/roles";
import { weekWindows, type DayWindow } from "@/lib/weekCompare";

export interface WeekFigures {
  orders: number;
  sales_toman: number;
  delivered: number;
  collected_toman: number;
}

function figures(session: Session, w: DayWindow): WeekFigures {
  const db = getDb();
  const o = orderFilter(session);
  const sold = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(o.total_toman), 0) AS t FROM orders o
        WHERE o.status IN (${sqlStatusList(PRICED_ORDER_STATUSES)}) AND o.order_date >= ? AND o.order_date < ?${o.sql}`
    )
    .get(w.from, w.toExcl, ...o.params) as { n: number; t: number };
  const delivered = db
    .prepare(
      `SELECT COUNT(*) AS n FROM orders o
        WHERE o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)}) AND o.delivered_at >= ? AND o.delivered_at < ?${o.sql}`
    )
    .get(w.from, w.toExcl, ...o.params) as { n: number };
  const c = crmFilter(session, "c");
  const paid = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount_toman), 0) AS t FROM payments p JOIN customers c ON c.id = p.customer_id
        WHERE p.voided_at IS NULL AND p.received_at >= ? AND p.received_at < ? AND p.organization_id = ?${c.sql}`
    )
    .get(w.from, w.toExcl, session.organizationId, ...c.params) as { t: number };
  return { orders: sold.n, sales_toman: sold.t, delivered: delivered.n, collected_toman: paid.t };
}

/** F67: this week so far and the same days of last week, for an owner or a group manager, each
 *  scoped the way their order and customer lists are. Null for every other role. */
export function weekVsLast(session: Session, todayIso: string): { now: WeekFigures; before: WeekFigures; days: number } | null {
  if (!MANAGE_ROLES.includes(session.role)) return null;
  const { thisWeek, lastWeek, days } = weekWindows(todayIso);
  return { now: figures(session, thisWeek), before: figures(session, lastWeek), days };
}
