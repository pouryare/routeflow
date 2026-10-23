/** Health scores, assembled from the ledger.
 *
 *  The pure composites live in lib/analysis/health.ts; this module reads the rows that
 *  feed them and writes the roll-ups into `kpi_snapshots` (metric `health_score`) so
 *  the Action Center and the page read a table.
 */

import { getDb } from "@/lib/db";
import { groupFilter, type Session } from "@/lib/session";
import { FULFILLED_ORDER_STATUSES, PRICED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { customerDebt, customerDebtsForOrg, customerDebtsForOrgOnce } from "@/lib/repo/payments";
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

/** The cadence signals a customer's priced order dates (oldest first) yield. Shared by the
 *  one-customer and the whole-org paths so the two cannot drift apart. */
function orderSignals(orderDates: string[], asOfIso: string) {
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
  return { daysSince, meanInterval, ordersThisQ, ordersPrevQ };
}

// ---- Customer ----------------------------------------------------------------

export async function customerHealthFor(
  organizationId: number,
  customerId: number,
  asOfIso: string = new Date().toISOString()
): Promise<HealthResult> {
  const db = getDb();

  const orderDates = (
    await db
      .prepare(
        `SELECT order_date FROM orders
          WHERE organization_id = ? AND customer_id = ?
            AND status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})
          ORDER BY order_date`
      )
      .all(organizationId, customerId) as { order_date: string }[]
  ).map((r) => r.order_date);

  const { daysSince, meanInterval, ordersThisQ, ordersPrevQ } = orderSignals(orderDates, asOfIso);
  const qCut = new Date(Date.parse(asOfIso) - 90 * DAY_MS).toISOString();
  const prevCut = new Date(Date.parse(asOfIso) - 180 * DAY_MS).toISOString();

  const debt = await customerDebt(organizationId, customerId, asOfIso);
  const creditLimit = Number(
    (
      await db
        .prepare("SELECT COALESCE(credit_limit_toman, 0) AS l FROM customers WHERE id = ? AND organization_id = ?")
        .get(customerId, organizationId) as { l: number } | undefined
    )?.l ?? 0
  );

  const complaints90 = Number(
    (
      await db
        .prepare(
          `SELECT COUNT(*) AS n FROM quality_complaints
            WHERE organization_id = ? AND customer_id = ?
              AND (status = 'open' OR reported_at >= ?)`
        )
        .get(organizationId, customerId, qCut) as { n: number }
    ).n
  );

  const marginRow = await db
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

/** Health for every customer of an organisation, in a handful of queries instead of six
 *  per customer. Same inputs, same pure scorer as customerHealthFor -- tests/health-repo
 *  holds the two equal row for row. Keys are customer ids; an id with no rows scores as a
 *  customer with no history, exactly as the one-customer path does. */
export async function customerHealthMany(
  organizationId: number,
  ids: number[],
  asOf?: string
): Promise<Map<number, HealthResult>> {
  const db = getDb();
  const asOfIso = asOf ?? new Date().toISOString();
  const qCut = new Date(Date.parse(asOfIso) - 90 * DAY_MS).toISOString();
  const prevCut = new Date(Date.parse(asOfIso) - 180 * DAY_MS).toISOString();

  const datesBy = new Map<number, string[]>();
  for (const r of await db
    .prepare(
      `SELECT customer_id, order_date FROM orders
        WHERE organization_id = ? AND status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})
        ORDER BY customer_id, order_date`
    )
    .all(organizationId) as { customer_id: number; order_date: string }[]) {
    const list = datesBy.get(r.customer_id);
    if (list) list.push(r.order_date);
    else datesBy.set(r.customer_id, [r.order_date]);
  }

  const limitBy = new Map<number, number>();
  for (const r of await db
    .prepare("SELECT id, COALESCE(credit_limit_toman, 0) AS l FROM customers WHERE organization_id = ?")
    .all(organizationId) as { id: number; l: number }[]) {
    limitBy.set(r.id, Number(r.l));
  }

  const complaintsBy = new Map<number, number>();
  for (const r of await db
    .prepare(
      `SELECT customer_id, COUNT(*) AS n FROM quality_complaints
        WHERE organization_id = ? AND (status = 'open' OR reported_at >= ?)
        GROUP BY customer_id`
    )
    .all(organizationId, qCut) as { customer_id: number; n: number }[]) {
    complaintsBy.set(r.customer_id, Number(r.n));
  }

  const marginBy = new Map<number, { rev: number; cost: number }>();
  for (const r of await db
    .prepare(
      `SELECT o.customer_id AS customer_id,
              COALESCE(SUM(COALESCE(ol.packs_delivered, ol.packs_ordered) * ol.unit_price_toman), 0) AS rev,
              COALESCE(SUM(COALESCE(ol.packs_delivered, ol.packs_ordered) * ol.unit_cost_toman), 0) AS cost
         FROM order_lines ol JOIN orders o ON o.id = ol.order_id
        WHERE o.organization_id = ?
          AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
          AND o.order_date >= ?
        GROUP BY o.customer_id`
    )
    .all(organizationId, prevCut) as { customer_id: number; rev: number; cost: number }[]) {
    marginBy.set(r.customer_id, { rev: r.rev, cost: r.cost });
  }

  // Without an explicit clock the debt pass is shared with the rest of the render.
  const debts = asOf ? await customerDebtsForOrg(organizationId, asOf) : await customerDebtsForOrgOnce(organizationId);

  const out = new Map<number, HealthResult>();
  for (const id of ids) {
    const { daysSince, meanInterval, ordersThisQ, ordersPrevQ } = orderSignals(datesBy.get(id) ?? [], asOfIso);
    const m = marginBy.get(id) ?? { rev: 0, cost: 0 };
    out.set(
      id,
      customerHealth({
        days_since_last_order: daysSince,
        mean_interval_days: meanInterval,
        orders_this_q: ordersThisQ,
        orders_prev_q: ordersPrevQ,
        overdue_toman: debts.get(id)?.bucket_30_plus ?? 0,
        credit_limit_toman: limitBy.get(id) ?? 0,
        complaints_90d: complaintsBy.get(id) ?? 0,
        margin_pct: m.rev > 0 ? (m.rev - m.cost) / m.rev : 0,
      })
    );
  }
  return out;
}

/** One health row per customer the session may see. */
export async function customersHealthOverview(session: Session): Promise<CustomerHealthRow[]> {
  const db = getDb();
  const f = await groupFilter(session);
  const customers = await db
    .prepare(`SELECT id, business_name FROM customers WHERE 1 = 1${f.sql}`)
    .all(...f.params) as { id: number; business_name: string }[];

  const health = await customerHealthMany(
    session.organizationId,
    customers.map((c) => c.id)
  );
  return customers
    .map((c) => ({ customer_id: c.id, business_name: c.business_name, ...health.get(c.id)! }))
    .sort((a, b) => a.score - b.score);
}

// ---- Salesperson ------------------------------------------------------------------

export async function salespersonScoreFor(
  organizationId: number,
  userId: number,
  period: string
): Promise<HealthResult> {
  const db = getDb();
  const { from, toExcl } = periodRange(period);
  const now = new Date().toISOString();
  const activeCut = new Date(Date.parse(now) - 60 * DAY_MS).toISOString();

  const targetFraction = (await targetProgress(organizationId, {
    user_id: userId,
    period,
    metric: "revenue_toman",
  })).fraction;

  const assigned = Number(
    (
      await db
        .prepare(
          `SELECT COUNT(DISTINCT customer_id) AS n FROM orders
            WHERE organization_id = ? AND salesperson_user_id = ?`
        )
        .get(organizationId, userId) as { n: number }
    ).n
  );
  const active = Number(
    (
      await db
        .prepare(
          `SELECT COUNT(DISTINCT customer_id) AS n FROM orders
            WHERE organization_id = ? AND salesperson_user_id = ?
              AND status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})
              AND order_date >= ?`
        )
        .get(organizationId, userId, activeCut) as { n: number }
    ).n
  );

  const samples = await db
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
    const followUp = await db
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

  const book = await db
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
  const bookCustomers = await db
    .prepare(
      `SELECT DISTINCT customer_id FROM orders WHERE organization_id = ? AND salesperson_user_id = ?`
    )
    .all(organizationId, userId) as { customer_id: number }[];
  let bookOverdue = 0;
  for (const { customer_id } of bookCustomers) {
    bookOverdue += (await customerDebt(organizationId, customer_id, now)).bucket_30_plus;
  }
  const overdueRatio = book.rev > 0 ? Math.max(0, bookOverdue) / book.rev : 0;

  const taskRow = await db
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

export async function driverScoreFor(
  organizationId: number,
  userId: number,
  period: string
): Promise<HealthResult> {
  const db = getDb();
  const { from, toExcl } = periodRange(period);

  const stops = await db
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

  const packRow = await db
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
export async function materialiseHealth(organizationId: number, period: string): Promise<number> {
  const db = getDb();
  const writes: SnapshotWrite[] = [];

  for (const c of await db
    .prepare("SELECT id FROM customers WHERE organization_id = ?")
    .all(organizationId) as { id: number }[]) {
    const h = await customerHealthFor(organizationId, c.id);
    writes.push({ metric: "health_score", scope_type: "customer", scope_id: c.id, period, value: h.score });
  }

  // People who HOLD phone_sales, whoever their primary. A widened literal is not enough:
  // a driver who also sells has no seller health metrics at all, and the board goes blank
  // for exactly the person doing both jobs.
  const sellers = await db
    .prepare(
      `SELECT u.id FROM users u JOIN user_roles _r ON _r.user_id = u.id AND _r.role = 'phone_sales'
        WHERE u.organization_id = ? AND u.active = 1`
    )
    .all(organizationId) as { id: number }[];
  for (const s of sellers) {
    writes.push({
      metric: "health_score",
      scope_type: "salesperson",
      scope_id: s.id,
      period,
      value: (await salespersonScoreFor(organizationId, s.id, period)).score,
    });
  }

  const drivers = await db
    .prepare(
      `SELECT u.id FROM users u JOIN user_roles _r ON _r.user_id = u.id AND _r.role IN ('delivery_driver', 'field_rep')
        WHERE u.organization_id = ? AND u.active = 1`
    )
    .all(organizationId) as { id: number }[];
  for (const d of drivers) {
    writes.push({
      metric: "health_score",
      scope_type: "driver",
      scope_id: d.id,
      period,
      value: (await driverScoreFor(organizationId, d.id, period)).score,
    });
  }

  return await upsertSnapshots(organizationId, writes);
}
