/** Contribution margin, per dimension, from the frozen order lines.
 *
 *  `marginBy` answers "which customers / products / salespeople / territories /
 *  representatives make us money, not just revenue" — the gap the source (§6) calls
 *  dangerous. `materialiseMargin` writes the org / group / salesperson roll-ups into
 *  `kpi_snapshots` so the page reads a table.
 *
 *  Cost is a manager-and-above figure: a فروشنده sees no product cost anywhere in the
 *  app (PurchaseEntry already gates entering one), so `marginBy` refuses that role and
 *  the route refuses it again.
 */

import { getDb } from "@/lib/db";
import { orderFilter, type Session } from "@/lib/session";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { lineTotalToman, lineCostToman, lineKg, type LineSnapshot } from "@/lib/orderMath";
import { rollUp, marginPct, type Keyed, type MarginRow } from "@/lib/analysis/margin";
import { periodRange } from "@/lib/analysis/period";
import { upsertSnapshots, type SnapshotWrite } from "./kpiSnapshots";

/** A reporting dimension, NOT a Role. Feeds kpi_snapshots.scope_type, whose CHECK still
 *  names 'salesperson' -- so this list must keep the old vocabulary. */
export type MarginDimension = "customer" | "product" | "salesperson" | "group" | "representative";

export class MarginError extends Error {}

interface LineRow extends LineSnapshot {
  key: string;
  label: string;
}

const DIMENSION_SQL: Record<
  MarginDimension,
  { join: string; key: string; label: string; require?: string }
> = {
  customer: {
    join: "JOIN customers c ON c.id = o.customer_id",
    key: "CAST(o.customer_id AS TEXT)",
    label: "c.business_name",
  },
  product: {
    join: "JOIN products p ON p.id = ol.product_id",
    key: "CAST(ol.product_id AS TEXT)",
    label: "p.name",
  },
  salesperson: {
    join: "LEFT JOIN users u ON u.id = o.salesperson_user_id",
    key: "CAST(COALESCE(o.salesperson_user_id, 0) AS TEXT)",
    label: "COALESCE(u.display_name, 'بدون فروشنده')",
  },
  group: {
    join: "LEFT JOIN groups g ON g.id = o.group_id",
    key: "CAST(COALESCE(o.group_id, 0) AS TEXT)",
    label: "COALESCE(g.name, 'بدون منطقه')",
  },
  representative: {
    join:
      "JOIN representative_profiles rp ON rp.customer_id = o.customer_id AND rp.organization_id = o.organization_id " +
      "JOIN customers c ON c.id = o.customer_id",
    key: "CAST(rp.id AS TEXT)",
    label: "c.business_name || ' (' || rp.rep_code || ')'",
    require: "rp.id IS NOT NULL",
  },
};

/** Grouped margin rows for one dimension over one Jalali month, scoped to what the
 *  session may see. Throws for a `salesperson` session. */
export function marginBy(
  organizationId: number,
  dimension: MarginDimension,
  period: string,
  session: Session
): MarginRow[] {
  if (session.role === "phone_sales") {
    throw new MarginError("حاشیهٔ سود برای این نقش در دسترس نیست");
  }
  const d = DIMENSION_SQL[dimension];
  const { from, toExcl } = periodRange(period);
  const scope = orderFilter(session, "o");

  const where = [
    "o.organization_id = ?",
    `o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})`,
    "o.order_date >= ?",
    "o.order_date < ?",
  ];
  if (d.require) where.push(d.require);

  const rows = getDb()
    .prepare(
      `SELECT ol.packs_ordered, ol.packs_delivered, ol.unit_price_toman, ol.unit_cost_toman,
              ol.qty_per_pack, ol.kg_per_base_unit,
              ${d.key} AS key, ${d.label} AS label
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
         ${d.join}
        WHERE ${where.join(" AND ")}${scope.sql}`
    )
    .all(organizationId, from, toExcl, ...scope.params) as unknown as LineRow[];

  const lines: Keyed[] = rows.map((r) => ({
    key: r.key,
    label: r.label,
    revenue_toman: lineTotalToman(r),
    cost_toman: lineCostToman(r),
    kg: lineKg(r),
  }));
  return rollUp(lines);
}

/** Org-wide roll-up (no session — the sweep's caller is trusted). Writes `net_sales`,
 *  `gross_profit` and `gross_margin` at `org` scope and per `group` and per
 *  `salesperson`. */
export function materialiseMargin(organizationId: number, period: string): number {
  const { from, toExcl } = periodRange(period);
  const rows = getDb()
    .prepare(
      `SELECT ol.packs_ordered, ol.packs_delivered, ol.unit_price_toman, ol.unit_cost_toman,
              ol.qty_per_pack, ol.kg_per_base_unit,
              o.group_id, o.salesperson_user_id
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
        WHERE o.organization_id = ?
          AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
          AND o.order_date >= ? AND o.order_date < ?`
    )
    .all(organizationId, from, toExcl) as unknown as (LineSnapshot & {
    group_id: number | null;
    salesperson_user_id: number | null;
  })[];

  type Bucket = { revenue: number; cost: number; n: Set<string> };
  const fresh = (): Bucket => ({ revenue: 0, cost: 0, n: new Set() });
  const org = fresh();
  const byGroup = new Map<number, Bucket>();
  const bySalesperson = new Map<number, Bucket>();

  for (const r of rows) {
    const rev = lineTotalToman(r);
    const cost = lineCostToman(r);
    const tag = `${r.group_id}:${r.salesperson_user_id}`;
    for (const b of [
      org,
      byGroup.get(r.group_id ?? 0) ?? byGroup.set(r.group_id ?? 0, fresh()).get(r.group_id ?? 0)!,
      bySalesperson.get(r.salesperson_user_id ?? 0) ??
        bySalesperson
          .set(r.salesperson_user_id ?? 0, fresh())
          .get(r.salesperson_user_id ?? 0)!,
    ]) {
      b.revenue += rev;
      b.cost += cost;
      b.n.add(tag);
    }
  }

  const writes: SnapshotWrite[] = [];
  const push = (scope_type: "org" | "group" | "salesperson", scope_id: number, b: Bucket): void => {
    writes.push({ metric: "net_sales", scope_type, scope_id, period, value: Math.round(b.revenue), sample_size: b.n.size });
    writes.push({
      metric: "gross_profit",
      scope_type,
      scope_id,
      period,
      value: Math.round(b.revenue - b.cost),
      sample_size: b.n.size,
    });
    writes.push({
      metric: "gross_margin",
      scope_type,
      scope_id,
      period,
      value: marginPct(b.revenue, b.cost),
      numerator: Math.round(b.revenue - b.cost),
      denominator: Math.round(b.revenue),
      sample_size: b.n.size,
    });
  };

  push("org", 0, org);
  for (const [gid, b] of byGroup) if (gid) push("group", gid, b);
  for (const [uid, b] of bySalesperson) if (uid) push("salesperson", uid, b);

  return upsertSnapshots(organizationId, writes);
}
