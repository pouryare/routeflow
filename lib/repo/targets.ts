import { getDb } from "@/lib/db";
import { jalaliToIsoDate, jalaliMonthLength } from "@/lib/jalali";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";

export type TargetMetric = "revenue_toman" | "kg" | "orders";

export interface TargetRow {
  id: number;
  organization_id: number;
  user_id: number | null;
  group_id: number | null;
  period: string; // 'YYYY-MM' Jalali
  metric: TargetMetric;
  target_value: number;
  created_by: number | null;
  created_at: string;
}

/** The Gregorian [start, endExclusive) ISO dates of a Jalali 'YYYY-MM' period. */
function periodRange(period: string): { from: string; toExcl: string } {
  const [jyS, jmS] = period.split("-");
  const jy = Number(jyS);
  const jm = Number(jmS);
  const from = jalaliToIsoDate(jy, jm, 1).slice(0, 10);
  const last = jalaliMonthLength(jy, jm);
  const endInc = jalaliToIsoDate(jy, jm, last);
  const toExcl = new Date(Date.parse(endInc) + 86_400_000).toISOString().slice(0, 10);
  return { from, toExcl };
}

/** Upsert a target. The table's UNIQUE does not bite when user_id or group_id is NULL,
 *  so find-or-update by the exact scope here. */
export async function setTarget(
  organizationId: number,
  input: {
    user_id?: number | null;
    group_id?: number | null;
    period: string;
    metric: TargetMetric;
    target_value: number;
    created_by?: number | null;
  }
): Promise<number> {
  const db = getDb();
  const existing = await db
    .prepare(
      `SELECT id FROM targets
        WHERE organization_id = ? AND user_id IS NOT DISTINCT FROM ? AND group_id IS NOT DISTINCT FROM ? AND period = ? AND metric = ?`
    )
    .get(
      organizationId,
      input.user_id ?? null,
      input.group_id ?? null,
      input.period,
      input.metric
    ) as { id: number } | undefined;
  if (existing) {
    await db.prepare("UPDATE targets SET target_value = ? WHERE id = ?").run(input.target_value, existing.id);
    return existing.id;
  }
  return Number(
    (await db
      .prepare(
        `INSERT INTO targets (organization_id, user_id, group_id, period, metric, target_value, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        organizationId,
        input.user_id ?? null,
        input.group_id ?? null,
        input.period,
        input.metric,
        input.target_value,
        input.created_by ?? null,
        new Date().toISOString()
      )).lastInsertRowid
  );
}

export async function listTargets(organizationId: number, period?: string): Promise<TargetRow[]> {
  return period
    ? (await getDb()
        .prepare("SELECT * FROM targets WHERE organization_id = ? AND period = ?")
        .all(organizationId, period) as unknown as TargetRow[])
    : (await getDb()
        .prepare("SELECT * FROM targets WHERE organization_id = ? ORDER BY period DESC")
        .all(organizationId) as unknown as TargetRow[]);
}

export interface TargetProgress {
  target: number;
  actual: number;
  fraction: number;
}

/** Actual delivered performance for a scope over the period, against its target. */
export async function targetProgress(
  organizationId: number,
  scope: { user_id?: number | null; group_id?: number | null; period: string; metric: TargetMetric }
): Promise<TargetProgress> {
  const db = getDb();
  const t = await db
    .prepare(
      `SELECT target_value FROM targets
        WHERE organization_id = ? AND user_id IS NOT DISTINCT FROM ? AND group_id IS NOT DISTINCT FROM ? AND period = ? AND metric = ?`
    )
    .get(
      organizationId,
      scope.user_id ?? null,
      scope.group_id ?? null,
      scope.period,
      scope.metric
    ) as { target_value: number } | undefined;
  const target = t?.target_value ?? 0;

  const { from, toExcl } = periodRange(scope.period);
  const where: string[] = [
    "o.organization_id = ?",
    `o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})`,
    "o.order_date >= ?",
    "o.order_date < ?",
  ];
  const params: unknown[] = [organizationId, from, toExcl];
  if (scope.user_id != null) {
    where.push("o.salesperson_user_id = ?");
    params.push(scope.user_id);
  }
  if (scope.group_id != null) {
    where.push("o.group_id = ?");
    params.push(scope.group_id);
  }

  let actual = 0;
  if (scope.metric === "orders") {
    actual = (
      await db
        .prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${where.join(" AND ")}`)
        .get(...(params as never[])) as { n: number }
    ).n;
  } else {
    const rows = await db
      .prepare(
        `SELECT ol.packs_ordered, ol.packs_delivered, ol.qty_per_pack, ol.kg_per_base_unit, ol.unit_price_toman
           FROM order_lines ol JOIN orders o ON o.id = ol.order_id
          WHERE ${where.join(" AND ")}`
      )
      .all(...(params as never[])) as {
      packs_ordered: number;
      packs_delivered: number | null;
      qty_per_pack: number;
      kg_per_base_unit: number;
      unit_price_toman: number;
    }[];
    for (const r of rows) {
      const packs = r.packs_delivered ?? r.packs_ordered;
      const base = packs * r.qty_per_pack;
      actual += scope.metric === "kg" ? base * r.kg_per_base_unit : base * r.unit_price_toman;
    }
    actual = Math.round(actual);
  }

  return { target, actual, fraction: target > 0 ? Math.round((actual / target) * 100) / 100 : 0 };
}
