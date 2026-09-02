/** The "Why?" ladder, fed from the ledger.
 *
 *  `whyChain` walks a fixed decomposition — territory → salesperson → funnel stage —
 *  running `explainDelta` (lib/analysis/why) at each rung against the two periods and
 *  descending into the bucket that moved the number most. The last rung's `headline`
 *  is the sentence the page shows: "the drop is in delivery, not in confirmation."
 *
 *  This is an on-demand scan, not a snapshot read: a delta decomposition needs the
 *  line-level rows for two months. Bounded by the two Jalali windows and `orderFilter`.
 */

import { getDb } from "@/lib/db";
import { orderFilter, type Session } from "@/lib/session";
import { FULFILLED_ORDER_STATUSES, PRICED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { lineTotalToman, lineCostToman, type LineSnapshot } from "@/lib/orderMath";
import { periodRange } from "@/lib/analysis/period";
import { explainDelta, type DeltaExplanation } from "@/lib/analysis/why";

export type WhyMetric = "net_sales" | "gross_profit" | "orders";

export class WhyError extends Error {}

export interface WhyRung extends DeltaExplanation {
  /** what this rung split the number by */
  dimension_fa: string;
  /** the bucket we descended into to get here (null for the first rung) */
  scope_fa: string | null;
}

interface ScopeRow extends LineSnapshot {
  order_id: number;
  group_id: number | null;
  group_label: string | null;
  salesperson_id: number | null;
  salesperson_label: string | null;
}

function scopeRows(
  session: Session,
  period: string,
  extra: { group_id?: number; salesperson_id?: number }
): ScopeRow[] {
  const { from, toExcl } = periodRange(period);
  const f = orderFilter(session, "o");
  const where = [
    "o.organization_id = ?",
    `o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})`,
    "o.order_date >= ?",
    "o.order_date < ?",
  ];
  const params: unknown[] = [session.organizationId, from, toExcl];
  if (extra.group_id != null) {
    where.push("o.group_id = ?");
    params.push(extra.group_id);
  }
  if (extra.salesperson_id != null) {
    where.push("o.salesperson_user_id = ?");
    params.push(extra.salesperson_id);
  }
  return getDb()
    .prepare(
      `SELECT ol.packs_ordered, ol.packs_delivered, ol.unit_price_toman, ol.unit_cost_toman,
              ol.qty_per_pack, ol.kg_per_base_unit,
              o.id AS order_id,
              o.group_id, g.name AS group_label,
              o.salesperson_user_id AS salesperson_id, u.display_name AS salesperson_label
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
         LEFT JOIN groups g ON g.id = o.group_id
         LEFT JOIN users u ON u.id = o.salesperson_user_id
        WHERE ${where.join(" AND ")}${f.sql}`
    )
    .all(...(params as never[]), ...f.params) as unknown as ScopeRow[];
}

type Bucketed = { values: Record<string, number>; labels: Record<string, string> };

function bucketise(
  rows: ScopeRow[],
  metric: WhyMetric,
  dim: "group" | "salesperson"
): Bucketed {
  const values: Record<string, number> = {};
  const labels: Record<string, string> = {};
  const orderSeen: Record<string, Set<number>> = {};
  for (const r of rows) {
    const id = dim === "group" ? r.group_id ?? 0 : r.salesperson_id ?? 0;
    const key = String(id);
    labels[key] =
      dim === "group"
        ? r.group_label ?? "بدون منطقه"
        : r.salesperson_label ?? "بدون فروشنده";
    if (metric === "orders") {
      (orderSeen[key] ??= new Set()).add(r.order_id);
      values[key] = orderSeen[key].size;
    } else {
      const add = metric === "net_sales" ? lineTotalToman(r) : lineTotalToman(r) - lineCostToman(r);
      values[key] = (values[key] ?? 0) + add;
    }
  }
  return { values, labels };
}

/** Which single bucket moved the number most (by |delta|), or null. */
function topMover(e: DeltaExplanation): { key: string; label: string } | null {
  const c = e.contributions[0];
  return c && c.delta !== 0 ? { key: c.key, label: c.label } : null;
}

const STAGE_LABEL: Record<string, string> = {
  entered: "ثبت‌شده",
  confirmed: "تأییدشده",
  delivered: "تحویل‌شده",
};

/** Funnel counts for the orders whose order_date falls in the period + scope. */
function funnelCounts(
  session: Session,
  period: string,
  extra: { group_id?: number; salesperson_id?: number }
): Record<string, number> {
  const { from, toExcl } = periodRange(period);
  const f = orderFilter(session, "o");
  const where = [
    "o.organization_id = ?",
    `o.status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})`,
    "o.order_date >= ?",
    "o.order_date < ?",
  ];
  const params: unknown[] = [session.organizationId, from, toExcl];
  if (extra.group_id != null) {
    where.push("o.group_id = ?");
    params.push(extra.group_id);
  }
  if (extra.salesperson_id != null) {
    where.push("o.salesperson_user_id = ?");
    params.push(extra.salesperson_id);
  }
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS entered,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.to_status = 'CONFIRMED') THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.to_status = 'DELIVERED') THEN 1 ELSE 0 END) AS delivered
       FROM orders o
      WHERE ${where.join(" AND ")}${f.sql}`
    )
    .get(...(params as never[]), ...f.params) as {
    entered: number;
    confirmed: number | null;
    delivered: number | null;
  };
  return { entered: row.entered, confirmed: row.confirmed ?? 0, delivered: row.delivered ?? 0 };
}

export function whyChain(
  session: Session,
  metric: WhyMetric,
  periodA: string,
  periodB: string
): WhyRung[] {
  if (session.role === "salesperson") {
    throw new WhyError("این تحلیل برای نقش فروشنده در دسترس نیست");
  }

  const rungs: WhyRung[] = [];

  // rung 1 — by territory
  const gA = bucketise(scopeRows(session, periodA, {}), metric, "group");
  const gB = bucketise(scopeRows(session, periodB, {}), metric, "group");
  const r1 = explainDelta(gA.values, gB.values, { ...gA.labels, ...gB.labels });
  rungs.push({ ...r1, dimension_fa: "منطقه", scope_fa: null });

  const g = topMover(r1);
  if (!g || g.key === "0") return rungs;
  const groupId = Number(g.key);

  // rung 2 — by salesperson within that territory
  const sA = bucketise(scopeRows(session, periodA, { group_id: groupId }), metric, "salesperson");
  const sB = bucketise(scopeRows(session, periodB, { group_id: groupId }), metric, "salesperson");
  const r2 = explainDelta(sA.values, sB.values, { ...sA.labels, ...sB.labels });
  rungs.push({ ...r2, dimension_fa: "فروشنده", scope_fa: g.label });

  const s = topMover(r2);
  if (!s || s.key === "0") return rungs;
  const salespersonId = Number(s.key);

  // rung 3 — by funnel stage for that salesperson
  const extra = { group_id: groupId, salesperson_id: salespersonId };
  const fA = funnelCounts(session, periodA, extra);
  const fB = funnelCounts(session, periodB, extra);
  const r3 = explainDelta(fA, fB, STAGE_LABEL);
  rungs.push({ ...r3, dimension_fa: "مرحلهٔ قیف", scope_fa: s.label });

  return rungs;
}
