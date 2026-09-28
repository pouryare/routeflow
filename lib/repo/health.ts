/** Health scores, assembled from the ledger.
 *
 *  The pure composites live in lib/analysis/health.ts; this module reads the rows that
 *  feed them and writes the roll-ups into `kpi_snapshots` (metric `health_score`) so
 *  the Action Center and the page read a table.
 */

import { getDb } from "@/lib/db";
import { groupFilter, type Session } from "@/lib/session";
import { FULFILLED_ORDER_STATUSES, PRICED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { customerDebt } from "@/lib/repo/payments";
import { targetProgress } from "@/lib/repo/targets";
import { periodRange } from "@/lib/analysis/period";
import {
  customerHealth,
  salespersonScore,
  driverScore,
  type Band,
} from "@/lib/analysis/health";
import { upsertSnapshots, type SnapshotWrite } from "./kpiSnapshots";

const DAY_MS = 86_400_000;

export interface HealthResult {
  score: number;
  band: Band;
  reasons: string[];
}

export interface CustomerHealthRow extends HealthResult {
  customer_id: number;
  business_name: string;
}

function daysBetween(a: string, b: string): number {
  return Math.floor((Date.parse(a) - Date.parse(b)) / DAY_MS);
}

// ---- Customer ----------------------------------------------------------------

export function customerHealthFor(
  organizationId: number,
  customerId: number,
  asOfIso: string = new Date().toISOString()
): HealthResult {
  const db = getDb();

  const orderDates = (
    db
      .prepare(
        `SELECT order_date FROM orders
          WHERE organization_id = ? AND customer_id = ?
            AND status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})
          ORDER BY order_date`
      )
      .all(organizationId, customerId) as { order_date: string }[]
  ).map((r) => r.order_date);

  const last = orderDates.at(-1) ?? null;
  const daysSince = last ? Math.max(0, daysBetween(asOfIso, last)) : null;
  const meanInterval =
    orderDates.length >= 2
      ? daysBetween(orderDates.at(-1)!, orderDates[0]) / (orderDates.length - 1)
      : null;

  const qCut = new Date(Date.parse(asOfIso) - 90 * DAY_MS).toISOString();
  const prevCut = new Date(Date.parse(asOfIso) - 180 * DAY_MS).toISOString();
  const ordersThisQ = orderDates.filter((d) => d >= qCut).length;
  const ordersPrevQ = orderDates.filter((d) => d >= prevCut && d < qCut).length;

  const debt = customerDebt(organizationId, customerId, asOfIso);
  const creditLimit = Number(
    (
      db
        .prepare("SELECT COALESCE(credit_limit_toman, 0) AS l FROM customers WHERE id = ? AND organization_id = ?")
        .get(customerId, organizationId) as { l: number } | undefined
    )?.l ?? 0
  );

  const complaints90 = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM quality_complaints
            WHERE organization_id = ? AND customer_id = ?
              AND (status = 'open' OR reported_at >= ?)`
        )
        .get(organizationId, customerId, qCut) as { n: number }
    ).n
  );

  const marginRow = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(ol.packs_delivered, ol.packs_ordered) * ol.unit_price_toman), 0) AS rev,
              COALESCE(SUM(COALESCE(ol.packs_delivered, ol.packs_ordered) * ol.unit_cost_toman), 0) AS cost
         FROM order_lines ol JOIN orders o ON o.id = ol.order_id
        WHERE o.organization_id = ? AND o.customer_id = ?
          AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
          AND o.order_date >= ?`
    )
    .get(organizationId, customerId, prevCut) as { rev: number; cost: number };
  const marginPctVal = marginRow.rev > 0 ? (marginRow.rev - marginRow.cost) / marginRow.rev : 0;

  return customerHealth({
    days_since_last_order: daysSince,
    mean_interval_days: meanInterval,
    orders_this_q: ordersThisQ,
    orders_prev_q: ordersPrevQ,
    overdue_toman: debt.bucket_30_plus,
    credit_limit_toman: creditLimit,
    complaints_90d: complaints90,
    margin_pct: marginPctVal,
  });
}

/** One health row per customer the session may see. */
export function customersHealthOverview(session: Session): CustomerHealthRow[] {
  const db = getDb();
  const f = groupFilter(session);
  const customers = db
    .prepare(`SELECT id, business_name FROM customers WHERE 1 = 1${f.sql}`)
    .all(...f.params) as { id: number; business_name: string }[];

  return customers
    .map((c) => {
      const h = customerHealthFor(session.organizationId, c.id);
      return { customer_id: c.id, business_name: c.business_name, ...h };
    })
    .sort((a, b) => a.score - b.score);
}

// ---- Salesperson ------------------------------------------------------------------

export function salespersonScoreFor(
  organizationId: number,
  userId: number,
  period: string
): HealthResult {
  const db = getDb();
  const { from, toExcl } = periodRange(period);
  const now = new Date().toISOString();
  const activeCut = new Date(Date.parse(now) - 60 * DAY_MS).toISOString();

  const targetFraction = targetProgress(organizationId, {
    user_id: userId,
    period,
    metric: "revenue_toman",
  }).fraction;

  const assigned = Number(
    (
      db
        .prepare(
          `SELECT COUNT(DISTINCT customer_id) AS n FROM orders
            WHERE organization_id = ? AND salesperson_user_id = ?`
        )
        .get(organizationId, userId) as { n: number }
    ).n
  );
  const active = Number(
    (
      db
        .prepare(
          `SELECT COUNT(DISTINCT customer_id) AS n FROM orders
            WHERE organization_id = ? AND salesperson_user_id = ?
              AND status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})
              AND order_date >= ?`
        )
        .get(organizationId, userId, activeCut) as { n: number }
    ).n
  );

  const samples = db
    .prepare(
      `SELECT id, customer_id, order_date FROM orders
        WHERE organization_id = ? AND salesperson_user_id = ?
          AND order_type = 'SAMPLE' AND order_date >= ?`
    )
    .all(organizationId, userId, new Date(Date.parse(now) - 180 * DAY_MS).toISOString()) as {
    id: number;
    customer_id: number;
    order_date: string;
  }[];
  let converted = 0;
  for (const s of samples) {
    const followUp = db
      .prepare(
        `SELECT 1 FROM orders
          WHERE organization_id = ? AND customer_id = ?
            AND COALESCE(order_type, 'STANDARD') != 'SAMPLE'
            AND order_date > ? AND order_date <= ?`
      )
      .get(
        organizationId,
        s.customer_id,
        s.order_date,
        new Date(Date.parse(s.order_date) + 30 * DAY_MS).toISOString()
      );
    if (followUp) converted += 1;
  }
  const sampleConversion = samples.length > 0 ? converted / samples.length : 0;

  const book = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(ol.packs_delivered, ol.packs_ordered) * ol.unit_price_toman), 0) AS rev
         FROM order_lines ol JOIN orders o ON o.id = ol.order_id
        WHERE o.organization_id = ? AND o.salesperson_user_id = ?
          AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})`
    )
    .get(organizationId, userId) as { rev: number };
  // Overdue on the book = the 30+ day bucket summed over the salesperson's customers.
  // total_toman is not a stored column, so this goes through customerDebt (which is the
  // same rule the customer's own health uses) rather than a bad JOIN.
  const bookCustomers = db
    .prepare(
      `SELECT DISTINCT customer_id FROM orders WHERE organization_id = ? AND salesperson_user_id = ?`
    )
    .all(organizationId, userId) as { customer_id: number }[];
  let bookOverdue = 0;
  for (const { customer_id } of bookCustomers) {
    bookOverdue += customerDebt(organizationId, customer_id, now).bucket_30_plus;
  }
  const overdueRatio = book.rev > 0 ? Math.max(0, bookOverdue) / book.rev : 0;

  const taskRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'done' AND done_at IS NOT NULL AND done_at <= due_at THEN 1 ELSE 0 END) AS on_time,
         COUNT(*) AS n
       FROM tasks
      WHERE organization_id = ? AND assignee_user_id = ? AND due_at IS NOT NULL
        AND created_at >= ? AND created_at < ?`
    )
    .get(organizationId, userId, from, toExcl) as { on_time: number | null; n: number };
  const onTimeTaskRatio = taskRow.n > 0 ? (taskRow.on_time ?? 0) / taskRow.n : 1;

  return salespersonScore({
    target_fraction: targetFraction,
    active_customers: active,
    assigned_customers: assigned,
    sample_conversion: sampleConversion,
    overdue_ratio: overdueRatio,
    on_time_task_ratio: onTimeTaskRatio,
  });
}

// ---- Driver --------------------------------------------------------------------

export function driverScoreFor(
  organizationId: number,
  userId: number,
  period: string
): HealthResult {
  const db = getDb();
  const { from, toExcl } = periodRange(period);

  const stops = db
    .prepare(
      `SELECT ds.status, ds.delivered_at, dr.run_date
         FROM delivery_stops ds
         JOIN delivery_runs dr ON dr.id = ds.run_id
        WHERE dr.organization_id = ? AND dr.driver_user_id = ?
          AND dr.run_date >= ? AND dr.run_date < ?`
    )
    .all(organizationId, userId, from.slice(0, 10), toExcl.slice(0, 10)) as {
    status: string;
    delivered_at: string | null;
    run_date: string;
  }[];

  const total = stops.length;
  const failed = stops.filter((s) => s.status === "refused" || s.status === "skipped").length;
  const delivered = stops.filter((s) => s.status === "delivered");
  const onTime = delivered.filter(
    (s) => s.delivered_at !== null && s.delivered_at.slice(0, 10) <= s.run_date.slice(0, 10)
  ).length;

  const packRow = db
    .prepare(
      `SELECT COALESCE(SUM(ol.packs_ordered), 0) AS ordered,
              COALESCE(SUM(COALESCE(ol.packs_delivered, 0)), 0) AS delivered
         FROM delivery_stops ds
         JOIN delivery_runs dr ON dr.id = ds.run_id
         JOIN order_lines ol ON ol.order_id = ds.order_id
        WHERE dr.organization_id = ? AND dr.driver_user_id = ?
          AND dr.run_date >= ? AND dr.run_date < ?`
    )
    .get(organizationId, userId, from.slice(0, 10), toExcl.slice(0, 10)) as {
    ordered: number;
    delivered: number;
  };

  return driverScore({
    on_time_delivery: delivered.length > 0 ? onTime / delivered.length : total === 0 ? 1 : 0,
    fill_rate: packRow.ordered > 0 ? packRow.delivered / packRow.ordered : 1,
    failed_ratio: total > 0 ? failed / total : 0,
    stops_per_hour: null,
  });
}

// ---- Materialise ------------------------------------------------------------------

/** Write `health_score` snapshots at customer / salesperson / driver scope. */
export function materialiseHealth(organizationId: number, period: string): number {
  const db = getDb();
  const writes: SnapshotWrite[] = [];

  for (const c of db
    .prepare("SELECT id FROM customers WHERE organization_id = ?")
    .all(organizationId) as { id: number }[]) {
    const h = customerHealthFor(organizationId, c.id);
    writes.push({ metric: "health_score", scope_type: "customer", scope_id: c.id, period, value: h.score });
  }

  const sellers = db
    .prepare("SELECT id FROM users WHERE organization_id = ? AND role IN ('phone_sales', 'salesperson')")
    .all(organizationId) as { id: number }[];
  for (const s of sellers) {
    writes.push({
      metric: "health_score",
      scope_type: "salesperson",
      scope_id: s.id,
      period,
      value: salespersonScoreFor(organizationId, s.id, period).score,
    });
  }

  const drivers = db
    .prepare("SELECT id FROM users WHERE organization_id = ? AND role IN ('delivery_driver', 'field_rep', 'driver')")
    .all(organizationId) as { id: number }[];
  for (const d of drivers) {
    writes.push({
      metric: "health_score",
      scope_type: "driver",
      scope_id: d.id,
      period,
      value: driverScoreFor(organizationId, d.id, period).score,
    });
  }

  return upsertSnapshots(organizationId, writes);
}
