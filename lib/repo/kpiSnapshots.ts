/** The `kpi_snapshots` read / write path.
 *
 *  Part 2 of the plan makes this a *requirement*, not an optimisation: `DatabaseSync`
 *  is synchronous, so one unbounded scan freezes every concurrent request. Analytics
 *  therefore reads precomputed rows written by a sweep (`refreshAll`, added in a later
 *  task) and never scans `orders` to render a page.
 *
 *  This module owns the primitive upsert + point read. The per-metric calculators and
 *  the board query build on top of it.
 */

import { getDb } from "@/lib/db";
import { type Session } from "@/lib/session";
import { FULFILLED_ORDER_STATUSES, PRICED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { customerDebt } from "@/lib/repo/payments";
import {
  METRICS,
  METRIC_DIRECTION,
  ACTIVE_WINDOW_DAYS,
  SAMPLE_CONVERT_DAYS,
  type Metric,
} from "@/lib/analysis/metrics";
import { periodRange } from "@/lib/analysis/period";

/** The scope a snapshot is filed under.
 *
 *  NOT the same vocabulary as Role. This is a reporting dimension stored in
 *  kpi_snapshots.scope_type, whose CHECK still names 'salesperson' and 'driver' -- a
 *  separate list that a role rename must not touch. Renaming one without the other writes
 *  a value the constraint rejects. */
export type ScopeType =
  | "org"
  | "group"
  | "salesperson"
  | "driver"
  | "customer"
  | "product"
  | "representative";

export interface SnapshotScope {
  scope_type: ScopeType;
  /** 0 for `scope_type: 'org'`; the entity id otherwise. */
  scope_id?: number;
}

export interface SnapshotValue {
  value: number;
  numerator?: number | null;
  denominator?: number | null;
  sample_size?: number | null;
}

export interface SnapshotWrite extends SnapshotScope, SnapshotValue {
  metric: string;
  period: string;
}

/** Idempotent: the UNIQUE `(organization_id, metric, scope_type, scope_id, period)`
 *  turns a re-run of the same period into an overwrite, not a duplicate. */
export function upsertSnapshot(organizationId: number, w: SnapshotWrite): void {
  getDb()
    .prepare(
      `INSERT INTO kpi_snapshots
         (organization_id, metric, scope_type, scope_id, period, value,
          numerator, denominator, sample_size, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, metric, scope_type, scope_id, period)
       DO UPDATE SET value = excluded.value,
                     numerator = excluded.numerator,
                     denominator = excluded.denominator,
                     sample_size = excluded.sample_size,
                     computed_at = excluded.computed_at`
    )
    .run(
      organizationId,
      w.metric,
      w.scope_type,
      w.scope_id ?? 0,
      w.period,
      w.value,
      w.numerator ?? null,
      w.denominator ?? null,
      w.sample_size ?? null,
      new Date().toISOString()
    );
}

/** Write several snapshots in one transaction — the sweep's unit of work. */
export function upsertSnapshots(organizationId: number, writes: SnapshotWrite[]): number {
  const db = getDb();
  db.exec("BEGIN");
  try {
    for (const w of writes) upsertSnapshot(organizationId, w);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return writes.length;
}

/** One indexed row, or null when the sweep has not written it yet. */
export function snapshot(
  organizationId: number,
  metric: string,
  scope: SnapshotScope & { period: string }
): number | null {
  const row = getDb()
    .prepare(
      `SELECT value FROM kpi_snapshots
        WHERE organization_id = ? AND metric = ? AND scope_type = ? AND scope_id = ? AND period = ?`
    )
    .get(
      organizationId,
      metric,
      scope.scope_type,
      scope.scope_id ?? 0,
      scope.period
    ) as { value: number } | undefined;
  return row ? row.value : null;
}

/** The full row (value + parts + freshness), for a drill-down that re-aggregates. */
export interface SnapshotRow extends SnapshotValue {
  metric: string;
  scope_type: ScopeType;
  scope_id: number;
  period: string;
  computed_at: string;
}

export function snapshotRows(
  organizationId: number,
  filter: { period?: string; metric?: string; scope_type?: ScopeType }
): SnapshotRow[] {
  const where = ["organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (filter.period) {
    where.push("period = ?");
    params.push(filter.period);
  }
  if (filter.metric) {
    where.push("metric = ?");
    params.push(filter.metric);
  }
  if (filter.scope_type) {
    where.push("scope_type = ?");
    params.push(filter.scope_type);
  }
  return getDb()
    .prepare(
      `SELECT metric, scope_type, scope_id, period, value, numerator, denominator, sample_size, computed_at
         FROM kpi_snapshots WHERE ${where.join(" AND ")}`
    )
    .all(...(params as never[])) as unknown as SnapshotRow[];
}

/** The newest `computed_at` across a period's snapshots — the page's "as of …" line. */
export function newestComputedAt(organizationId: number, period: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT MAX(computed_at) AS t FROM kpi_snapshots WHERE organization_id = ? AND period = ?`
    )
    .get(organizationId, period) as { t: string | null };
  return row.t;
}

// ---- The calculators --------------------------------------------------------------

export interface MetricScope {
  scope_type: "org" | "group" | "salesperson";
  scope_id: number;
}

/** The extra `WHERE` a group/salesperson scope adds to an `orders` query aliased `alias`. */
function scopeClause(s: MetricScope, alias = "o"): { sql: string; params: number[] } {
  if (s.scope_type === "group") return { sql: ` AND ${alias}.group_id = ?`, params: [s.scope_id] };
  if (s.scope_type === "salesperson")
    return { sql: ` AND ${alias}.salesperson_user_id = ?`, params: [s.scope_id] };
  return { sql: "", params: [] };
}

/** The customer ids a scope covers, for the debt-loop metrics. */
function customersInScope(organizationId: number, s: MetricScope): number[] {
  const db = getDb();
  if (s.scope_type === "org") {
    return (db.prepare("SELECT id FROM customers WHERE organization_id = ?").all(organizationId) as {
      id: number;
    }[]).map((r) => r.id);
  }
  if (s.scope_type === "group") {
    return (
      db.prepare("SELECT id FROM customers WHERE organization_id = ? AND group_id = ?").all(
        organizationId,
        s.scope_id
      ) as { id: number }[]
    ).map((r) => r.id);
  }
  return (
    db
      .prepare(
        "SELECT DISTINCT customer_id AS id FROM orders WHERE organization_id = ? AND salesperson_user_id = ?"
      )
      .all(organizationId, s.scope_id) as { id: number }[]
  ).map((r) => r.id);
}

interface LineAgg {
  packs_ordered: number;
  packs_delivered: number | null;
  unit_price_toman: number;
  unit_cost_toman: number;
}

/** delivered-quantity revenue + cost + order count over FULFILLED orders in the window. */
function fulfilledLineTotals(
  organizationId: number,
  s: MetricScope,
  from: string,
  toExcl: string
): { revenue: number; cost: number; orders: number; packsOrdered: number; packsDelivered: number } {
  const sc = scopeClause(s);
  const rows = getDb()
    .prepare(
      `SELECT ol.packs_ordered, ol.packs_delivered, ol.unit_price_toman, ol.unit_cost_toman, o.id AS oid
         FROM order_lines ol JOIN orders o ON o.id = ol.order_id
        WHERE o.organization_id = ?
          AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
          AND o.order_date >= ? AND o.order_date < ?${sc.sql}`
    )
    .all(organizationId, from, toExcl, ...sc.params) as unknown as (LineAgg & { oid: number })[];

  let revenue = 0;
  let cost = 0;
  let packsOrdered = 0;
  let packsDelivered = 0;
  const orders = new Set<number>();
  for (const r of rows) {
    const eff = r.packs_delivered ?? r.packs_ordered;
    revenue += eff * r.unit_price_toman;
    cost += eff * r.unit_cost_toman;
    packsOrdered += r.packs_ordered;
    packsDelivered += r.packs_delivered ?? 0;
    orders.add(r.oid);
  }
  return {
    revenue: Math.round(revenue),
    cost: Math.round(cost),
    orders: orders.size,
    packsOrdered,
    packsDelivered,
  };
}

export interface MetricResult {
  value: number;
  numerator?: number;
  denominator?: number;
  sample_size: number;
}

/** One metric, one scope, one Jalali month. `switch (metric)`, each arm one bounded
 *  query — the Data Dictionary constants from lib/analysis/metrics are the definitions. */
export function computeMetric(
  organizationId: number,
  metric: Metric,
  scope: MetricScope,
  period: string
): MetricResult {
  const db = getDb();
  const { from, toExcl } = periodRange(period);
  const sc = scopeClause(scope);
  const totals = () => fulfilledLineTotals(organizationId, scope, from, toExcl);

  switch (metric) {
    case "net_sales": {
      const t = totals();
      return { value: t.revenue, sample_size: t.orders };
    }
    case "gross_profit": {
      const t = totals();
      return { value: t.revenue - t.cost, sample_size: t.orders };
    }
    case "gross_margin": {
      const t = totals();
      return {
        value: t.revenue > 0 ? (t.revenue - t.cost) / t.revenue : 0,
        numerator: t.revenue - t.cost,
        denominator: t.revenue,
        sample_size: t.orders,
      };
    }
    case "orders": {
      const t = totals();
      return { value: t.orders, sample_size: t.orders };
    }
    case "aov": {
      const t = totals();
      return {
        value: t.orders > 0 ? Math.round(t.revenue / t.orders) : 0,
        numerator: t.revenue,
        denominator: t.orders,
        sample_size: t.orders,
      };
    }
    case "fulfillment_rate": {
      const t = totals();
      return {
        value: t.packsOrdered > 0 ? t.packsDelivered / t.packsOrdered : 0,
        numerator: t.packsDelivered,
        denominator: t.packsOrdered,
        sample_size: t.orders,
      };
    }
    case "active_customers": {
      const since = new Date(Date.parse(toExcl) - ACTIVE_WINDOW_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const n = Number(
        (
          db
            .prepare(
              `SELECT COUNT(DISTINCT o.customer_id) AS n FROM orders o
                WHERE o.organization_id = ?
                  AND o.status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})
                  AND o.order_date >= ? AND o.order_date < ?${sc.sql}`
            )
            .get(organizationId, since, toExcl, ...sc.params) as { n: number }
        ).n
      );
      return { value: n, sample_size: n };
    }
    case "new_customers": {
      const n = Number(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM (
                 SELECT o.customer_id, MIN(o.order_date) AS first_date
                   FROM orders o
                  WHERE o.organization_id = ?${sc.sql}
                  GROUP BY o.customer_id
               ) t WHERE t.first_date >= ? AND t.first_date < ?`
            )
            .get(organizationId, ...sc.params, from, toExcl) as { n: number }
        ).n
      );
      return { value: n, sample_size: n };
    }
    case "lost_customers": {
      const activeFrom = new Date(Date.parse(from) - ACTIVE_WINDOW_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const silentFrom = new Date(Date.parse(toExcl) - ACTIVE_WINDOW_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const sc2 = scopeClause(scope, "o2");
      const n = Number(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM (
                 SELECT DISTINCT o.customer_id FROM orders o
                   WHERE o.organization_id = ? AND o.order_date >= ? AND o.order_date < ?${sc.sql}
               ) was_active
               WHERE was_active.customer_id NOT IN (
                 SELECT o2.customer_id FROM orders o2
                   WHERE o2.organization_id = ? AND o2.order_date >= ? AND o2.order_date < ?${sc2.sql}
               )`
            )
            .get(
              organizationId,
              activeFrom,
              from,
              ...sc.params,
              organizationId,
              silentFrom,
              toExcl,
              ...sc2.params
            ) as { n: number }
        ).n
      );
      return { value: n, sample_size: n };
    }
    case "repeat_rate": {
      const rows = db
        .prepare(
          `SELECT o.customer_id AS cid, COUNT(*) AS c FROM orders o
            WHERE o.organization_id = ?
              AND o.status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})
              AND o.order_date >= ? AND o.order_date < ?${sc.sql}
            GROUP BY o.customer_id`
        )
        .all(organizationId, from, toExcl, ...sc.params) as { cid: number; c: number }[];
      const withAny = rows.length;
      const withTwo = rows.filter((r) => r.c >= 2).length;
      return {
        value: withAny > 0 ? withTwo / withAny : 0,
        numerator: withTwo,
        denominator: withAny,
        sample_size: withAny,
      };
    }
    case "collection_rate": {
      const t = totals();
      const paid = Number(
        (
          db
            .prepare(
              scope.scope_type === "org"
                ? `SELECT COALESCE(SUM(amount_toman), 0) AS s FROM payments
                     WHERE organization_id = ? AND voided_at IS NULL AND received_at >= ? AND received_at < ?`
                : `SELECT COALESCE(SUM(p.amount_toman), 0) AS s FROM payments p
                     JOIN customers c ON c.id = p.customer_id
                     WHERE p.organization_id = ? AND p.voided_at IS NULL
                       AND p.received_at >= ? AND p.received_at < ?
                       ${scope.scope_type === "group" ? "AND c.group_id = ?" : "AND p.customer_id IN (SELECT DISTINCT customer_id FROM orders WHERE organization_id = p.organization_id AND salesperson_user_id = ?)"}`
            )
            .get(
              organizationId,
              from,
              toExcl,
              ...(scope.scope_type === "org" ? [] : [scope.scope_id])
            ) as { s: number }
        ).s
      );
      return {
        value: t.revenue > 0 ? paid / t.revenue : 0,
        numerator: paid,
        denominator: t.revenue,
        sample_size: t.orders,
      };
    }
    case "overdue_receivables": {
      let sum = 0;
      const ids = customersInScope(organizationId, scope);
      for (const id of ids) sum += customerDebt(organizationId, id, toExcl).bucket_30_plus;
      return { value: Math.round(sum), sample_size: ids.length };
    }
    case "on_time_delivery": {
      const rows = db
        .prepare(
          `SELECT d.planned_date, d.completed_at FROM deliveries d
             JOIN orders o ON o.id = d.order_id
            WHERE d.organization_id = ? AND d.status = 'DELIVERED'
              AND d.completed_at >= ? AND d.completed_at < ?${sc.sql}`
        )
        .all(organizationId, from, toExcl, ...sc.params) as {
        planned_date: string | null;
        completed_at: string;
      }[];
      const done = rows.length;
      const onTime = rows.filter(
        (r) => r.planned_date !== null && r.completed_at.slice(0, 10) <= r.planned_date.slice(0, 10)
      ).length;
      return {
        value: done > 0 ? onTime / done : 0,
        numerator: onTime,
        denominator: done,
        sample_size: done,
      };
    }
    case "sample_conversion": {
      const samples = db
        .prepare(
          `SELECT o.customer_id AS cid, o.order_date AS d FROM orders o
            WHERE o.organization_id = ? AND o.order_type = 'SAMPLE'
              AND o.order_date >= ? AND o.order_date < ?${sc.sql}`
        )
        .all(organizationId, from, toExcl, ...sc.params) as { cid: number; d: string }[];
      let converted = 0;
      for (const s of samples) {
        const until = new Date(Date.parse(s.d) + SAMPLE_CONVERT_DAYS * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const hit = db
          .prepare(
            `SELECT 1 FROM orders o
              WHERE o.organization_id = ? AND o.customer_id = ?
                AND COALESCE(o.order_type, 'STANDARD') != 'SAMPLE'
                AND o.order_date > ? AND o.order_date <= ?`
          )
          .get(organizationId, s.cid, s.d, until);
        if (hit) converted += 1;
      }
      return {
        value: samples.length > 0 ? converted / samples.length : 0,
        numerator: converted,
        denominator: samples.length,
        sample_size: samples.length,
      };
    }
    default: {
      const _exhaustive: never = metric;
      throw new Error(`unhandled metric ${String(_exhaustive)}`);
    }
  }
}

/** The 7 metrics that decompose per salesperson (source-attributable). */
const SALESPERSON_METRICS: readonly Metric[] = [
  "net_sales",
  "gross_profit",
  "orders",
  "aov",
  "active_customers",
  "new_customers",
  "sample_conversion",
];

/** Compute every metric at every applicable scope for one period and upsert the lot. */
export function refreshSnapshots(organizationId: number, period: string): { written: number } {
  const db = getDb();
  const groups = (
    db.prepare("SELECT id FROM groups WHERE organization_id = ?").all(organizationId) as { id: number }[]
  ).map((r) => r.id);
  // People who HOLD phone_sales, whoever their primary — otherwise a driver who also sells
  // contributes no seller KPIs at all, and the snapshot silently omits them.
  const sellers = (
    db
      .prepare(
        `SELECT u.id FROM users u JOIN user_roles _r ON _r.user_id = u.id AND _r.role = 'phone_sales'
          WHERE u.organization_id = ? AND u.active = 1`
      )
      .all(organizationId) as { id: number }[]
  ).map((r) => r.id);

  const writes: SnapshotWrite[] = [];
  const add = (metric: Metric, scope: MetricScope): void => {
    const r = computeMetric(organizationId, metric, scope, period);
    writes.push({
      metric,
      scope_type: scope.scope_type,
      scope_id: scope.scope_id,
      period,
      value: r.value,
      numerator: r.numerator ?? null,
      denominator: r.denominator ?? null,
      sample_size: r.sample_size,
    });
  };

  for (const metric of METRICS) {
    add(metric, { scope_type: "org", scope_id: 0 });
    for (const g of groups) add(metric, { scope_type: "group", scope_id: g });
    if (SALESPERSON_METRICS.includes(metric)) {
      for (const s of sellers) add(metric, { scope_type: "salesperson", scope_id: s });
    }
  }

  return { written: upsertSnapshots(organizationId, writes) };
}

// ---- The board (read path — no orders scan) -------------------------------------

export interface KpiCard {
  metric: Metric;
  title_fa: string;
  value: number | null;
  prev_value: number | null;
  target: number | null;
  direction: "up" | "down";
  definition_fa: string;
  action_fa: string;
  /** (value − prev) / prev, 0 when prev is missing or 0 */
  delta_pct: number;
  on_track: boolean;
  sample_size: number | null;
}

function boardScope(session: Session): MetricScope {
  if (session.role === "group_manager" && session.groupId != null) {
    return { scope_type: "group", scope_id: session.groupId };
  }
  if (session.role === "phone_sales") {
    return { scope_type: "salesperson", scope_id: session.user.id };
  }
  return { scope_type: "org", scope_id: 0 };
}

/** The last few periods of every metric, for the KPI bar's sparklines (item 10). One read,
 *  same scope as kpiBoard. Periods oldest first; a period with no snapshot is `null`, a
 *  gap in the line rather than a fall to zero, because "not computed" is not "none". */
export function kpiHistory(
  organizationId: number,
  periods: string[],
  session: Session
): Record<string, (number | null)[]> {
  if (periods.length === 0) return {};
  const scope = boardScope(session);
  const rows = getDb()
    .prepare(
      `SELECT metric, period, value FROM kpi_snapshots
        WHERE organization_id = ? AND scope_type = ? AND scope_id = ?
          AND period IN (${periods.map(() => "?").join(", ")})`
    )
    .all(organizationId, scope.scope_type, scope.scope_id, ...periods) as {
    metric: string;
    period: string;
    value: number;
  }[];
  const out: Record<string, (number | null)[]> = {};
  for (const r of rows) {
    const series = (out[r.metric] ??= periods.map(() => null));
    series[periods.indexOf(r.period)] = r.value;
  }
  return out;
}

/** One `kpi_snapshots` read for two periods + one `targets` read + the definitions
 *  join. Never touches `orders`. */
export function kpiBoard(
  organizationId: number,
  period: string,
  prevPeriod: string,
  session: Session
): KpiCard[] {
  const db = getDb();
  const scope = boardScope(session);

  const snapRows = db
    .prepare(
      `SELECT metric, period, value, sample_size FROM kpi_snapshots
        WHERE organization_id = ? AND scope_type = ? AND scope_id = ? AND period IN (?, ?)`
    )
    .all(organizationId, scope.scope_type, scope.scope_id, period, prevPeriod) as {
    metric: string;
    period: string;
    value: number;
    sample_size: number | null;
  }[];
  const cur = new Map<string, { value: number; sample_size: number | null }>();
  const prev = new Map<string, number>();
  for (const r of snapRows) {
    if (r.period === period) cur.set(r.metric, { value: r.value, sample_size: r.sample_size });
    else prev.set(r.metric, r.value);
  }

  const defs = new Map<string, { title_fa: string; definition_fa: string; action_fa: string; direction: "up" | "down" }>();
  for (const d of db
    .prepare(
      `SELECT metric, title_fa, definition_fa, action_fa, direction, organization_id
         FROM kpi_definitions WHERE organization_id = ? OR organization_id IS NULL`
    )
    .all(organizationId) as {
    metric: string;
    title_fa: string;
    definition_fa: string;
    action_fa: string;
    direction: "up" | "down";
    organization_id: number | null;
  }[]) {
    // tenant row wins over the NULL-org default
    if (!defs.has(d.metric) || d.organization_id !== null) {
      defs.set(d.metric, {
        title_fa: d.title_fa,
        definition_fa: d.definition_fa,
        action_fa: d.action_fa,
        direction: d.direction,
      });
    }
  }

  const targetMetric: Partial<Record<Metric, "revenue_toman" | "orders">> = {
    net_sales: "revenue_toman",
    orders: "orders",
  };
  const targetRows = db
    .prepare(
      `SELECT metric, target_value FROM targets
        WHERE organization_id = ? AND period = ? AND user_id IS ? AND group_id IS ?`
    )
    .all(
      organizationId,
      period,
      scope.scope_type === "salesperson" ? scope.scope_id : null,
      scope.scope_type === "group" ? scope.scope_id : null
    ) as { metric: string; target_value: number }[];
  const targets = new Map(targetRows.map((t) => [t.metric, t.target_value]));

  return METRICS.map((metric): KpiCard => {
    const c = cur.get(metric);
    const p = prev.get(metric) ?? null;
    const value = c ? c.value : null;
    const def = defs.get(metric);
    const direction = def?.direction ?? METRIC_DIRECTION[metric];
    const tKey = targetMetric[metric];
    const target = tKey ? targets.get(tKey) ?? null : null;
    const delta_pct = value !== null && p !== null && p !== 0 ? (value - p) / p : 0;
    let on_track: boolean;
    if (value === null) on_track = false;
    else if (target !== null) on_track = direction === "up" ? value >= target : value <= target;
    else on_track = direction === "up" ? delta_pct >= 0 : delta_pct <= 0;
    return {
      metric,
      title_fa: def?.title_fa ?? metric,
      value,
      prev_value: p,
      target,
      direction,
      definition_fa: def?.definition_fa ?? "",
      action_fa: def?.action_fa ?? "",
      delta_pct,
      on_track,
      sample_size: c?.sample_size ?? null,
    };
  });
}
