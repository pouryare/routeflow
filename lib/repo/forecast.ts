/** Demand forecasting, folded from the order history.
 *
 *  Cold start: `seasonalNaive` off the shipped `seasonal_factors` shape until there are
 *  ~8 closed months. Warm: deseasonalise → Holt (level + trend) → reseasonalise. The
 *  model state lives in `forecast_models`; the predictions are materialised into
 *  `forecasts` for the page and the routing/inventory callers to read.
 */

import { getDb } from "@/lib/db";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { periodOf, periodRange, shiftPeriod, currentPeriod } from "@/lib/analysis/period";
import {
  holtInit,
  holtStep,
  holtForecast,
  seasonalNaive,
  predictionInterval,
  type HoltState,
} from "@/lib/predict/smoothing";
import {
  DEFAULT_MONTH_FACTORS,
  monthIndex,
  deseasonalise,
  reseasonalise,
} from "@/lib/predict/seasonality";

export type ForecastEntityType = "org" | "group" | "product";
export type ForecastMetric = "demand_base_units" | "demand_toman";

export interface ForecastEntity {
  type: ForecastEntityType;
  id: number; // 0 for 'org'
}

interface MonthPoint {
  period: string;
  value: number;
}

const HOLT_MIN_OBS = 8;

/** The tenant's 12 Jalali-month factors, unioned with the shipped defaults. */
export function seasonalMonthFactors(organizationId: number): number[] {
  const rows = getDb()
    .prepare(
      `SELECT idx, factor, (organization_id IS NOT NULL) AS is_tenant
         FROM seasonal_factors
        WHERE kind = 'month' AND (organization_id = ? OR organization_id IS NULL)`
    )
    .all(organizationId) as { idx: number; factor: number; is_tenant: number }[];
  const out = [...DEFAULT_MONTH_FACTORS];
  const seenTenant = new Set<number>();
  for (const r of rows) {
    if (r.is_tenant) {
      out[r.idx - 1] = r.factor;
      seenTenant.add(r.idx);
    } else if (!seenTenant.has(r.idx)) {
      out[r.idx - 1] = r.factor;
    }
  }
  return out;
}

/** Closed Jalali months (the current, still-open one excluded), oldest first. */
export function monthlyHistory(
  organizationId: number,
  entity: ForecastEntity,
  metric: ForecastMetric,
  asOfIso: string = new Date().toISOString()
): MonthPoint[] {
  const where = [
    "o.organization_id = ?",
    `o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})`,
  ];
  const params: unknown[] = [organizationId];
  if (entity.type === "group") {
    where.push("o.group_id = ?");
    params.push(entity.id);
  } else if (entity.type === "product") {
    where.push("ol.product_id = ?");
    params.push(entity.id);
  }

  const rows = getDb()
    .prepare(
      `SELECT o.order_date,
              COALESCE(ol.packs_delivered, ol.packs_ordered) AS packs,
              ol.qty_per_pack, ol.unit_price_toman
         FROM order_lines ol JOIN orders o ON o.id = ol.order_id
        WHERE ${where.join(" AND ")}`
    )
    .all(...(params as never[])) as {
    order_date: string;
    packs: number;
    qty_per_pack: number;
    unit_price_toman: number;
  }[];

  const openPeriod = periodOf(asOfIso);
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const period = periodOf(`${r.order_date.slice(0, 10)}T00:00:00.000Z`);
    if (period >= openPeriod) continue; // the open month is not a closed observation
    const v =
      metric === "demand_toman"
        ? r.packs * r.unit_price_toman
        : r.packs * r.qty_per_pack;
    byMonth.set(period, (byMonth.get(period) ?? 0) + v);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, value]) => ({ period, value }));
}

export interface ForecastModelRow {
  method: "holt" | "seasonal_naive";
  level: number | null;
  trend: number | null;
  alpha: number;
  beta: number;
  n_obs: number;
  mae: number | null;
  last_period: string | null;
}

/** Recompute the model from the full closed history (idempotent — months are few). */
export function updateForecastModel(
  organizationId: number,
  entity: ForecastEntity,
  metric: ForecastMetric,
  asOfIso: string = new Date().toISOString()
): ForecastModelRow {
  const history = monthlyHistory(organizationId, entity, metric, asOfIso);
  const factors = seasonalMonthFactors(organizationId);

  const deseason = history.map((p) =>
    deseasonalise(p.value, monthIndex(factors, periodRange(p.period).from))
  );

  let state: HoltState = holtInit(deseason.slice(0, 3));
  const errors: number[] = [];
  for (let i = 3; i < deseason.length; i++) {
    const predicted = state.level + state.trend;
    errors.push(deseason[i] - predicted);
    state = holtStep(state, deseason[i]);
  }
  if (deseason.length < 3 && deseason.length > 0) state = holtInit(deseason);

  const nObs = history.length;
  const method: "holt" | "seasonal_naive" = nObs >= HOLT_MIN_OBS ? "holt" : "seasonal_naive";
  const mae = errors.length > 0 ? errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length : null;
  const lastPeriod = history.at(-1)?.period ?? null;

  getDb()
    .prepare(
      `INSERT INTO forecast_models
         (organization_id, entity_type, entity_id, metric, method, level, trend, alpha, beta, n_obs, mae, last_period, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, entity_type, entity_id, metric)
       DO UPDATE SET method = excluded.method, level = excluded.level, trend = excluded.trend,
                     n_obs = excluded.n_obs, mae = excluded.mae, last_period = excluded.last_period,
                     updated_at = excluded.updated_at`
    )
    .run(
      organizationId,
      entity.type,
      entity.id,
      metric,
      method,
      state.level,
      state.trend,
      state.alpha,
      state.beta,
      nObs,
      mae,
      lastPeriod,
      new Date().toISOString()
    );

  return { method, level: state.level, trend: state.trend, alpha: state.alpha, beta: state.beta, n_obs: nObs, mae, last_period: lastPeriod };
}

/** Predict the next `horizonMonths` and upsert them into `forecasts`. Refreshes the
 *  model first (cheap + idempotent). */
export function forecastDemand(
  organizationId: number,
  entity: ForecastEntity,
  metric: ForecastMetric,
  horizonMonths = 3,
  asOfIso: string = new Date().toISOString()
): { target_period: string; horizon: number; yhat: number; yhat_lo: number; yhat_hi: number; method: string }[] {
  const model = updateForecastModel(organizationId, entity, metric, asOfIso);
  const history = monthlyHistory(organizationId, entity, metric, asOfIso);
  const factors = seasonalMonthFactors(organizationId);
  const state: HoltState = {
    level: model.level ?? 0,
    trend: model.trend ?? 0,
    alpha: model.alpha,
    beta: model.beta,
  };
  const historyValues = history.map((p) => p.value);
  const base = periodOf(asOfIso);
  const now = new Date().toISOString();
  const db = getDb();
  const out: { target_period: string; horizon: number; yhat: number; yhat_lo: number; yhat_hi: number; method: string }[] = [];

  for (let h = 1; h <= horizonMonths; h++) {
    const target = shiftPeriod(base, -h);
    const idx = monthIndex(factors, periodRange(target).from);
    const yhat =
      model.method === "holt" && history.length >= 3
        ? reseasonalise(holtForecast(state, h), idx)
        : seasonalNaive(historyValues, Math.min(12, historyValues.length || 1), h);
    const { lo, hi } = predictionInterval(yhat, model.mae ?? yhat * 0.4);
    out.push({ target_period: target, horizon: h, yhat, yhat_lo: lo, yhat_hi: hi, method: model.method });

    db.prepare(
      `INSERT INTO forecasts
         (organization_id, entity_type, entity_id, metric, target_period, horizon, yhat, yhat_lo, yhat_hi, method, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, entity_type, entity_id, metric, target_period)
       DO UPDATE SET horizon = excluded.horizon, yhat = excluded.yhat, yhat_lo = excluded.yhat_lo,
                     yhat_hi = excluded.yhat_hi, method = excluded.method, computed_at = excluded.computed_at`
    ).run(organizationId, entity.type, entity.id, metric, target, h, yhat, lo, hi, model.method, now);
  }
  return out;
}

/** org + every active product, both metrics, 3 months. */
export function materialiseForecasts(
  organizationId: number,
  asOfIso: string = new Date().toISOString()
): number {
  const db = getDb();
  const products = db
    .prepare("SELECT id FROM products WHERE organization_id = ?")
    .all(organizationId) as { id: number }[];
  const entities: ForecastEntity[] = [
    { type: "org", id: 0 },
    ...products.map((p) => ({ type: "product" as const, id: p.id })),
  ];
  let n = 0;
  for (const e of entities) {
    for (const metric of ["demand_base_units", "demand_toman"] as ForecastMetric[]) {
      n += forecastDemand(organizationId, e, metric, 3, asOfIso).length;
    }
  }
  return n;
}

export interface DemandBoardEntry {
  entity_type: string;
  entity_id: number;
  label: string;
  metric: string;
  method: string;
  mae: number | null;
  n_obs: number;
  points: { target_period: string; horizon: number; yhat: number; yhat_lo: number; yhat_hi: number }[];
}

export function demandBoard(organizationId: number): DemandBoardEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT f.entity_type, f.entity_id, f.metric, f.target_period, f.horizon, f.yhat, f.yhat_lo, f.yhat_hi,
              fm.method, fm.mae, fm.n_obs,
              p.name AS product_name
         FROM forecasts f
         LEFT JOIN forecast_models fm
           ON fm.organization_id = f.organization_id AND fm.entity_type = f.entity_type
          AND fm.entity_id = f.entity_id AND fm.metric = f.metric
         LEFT JOIN products p ON f.entity_type = 'product' AND p.id = f.entity_id
        WHERE f.organization_id = ?
        ORDER BY f.entity_type, f.entity_id, f.metric, f.horizon`
    )
    .all(organizationId) as {
    entity_type: string;
    entity_id: number;
    metric: string;
    target_period: string;
    horizon: number;
    yhat: number;
    yhat_lo: number;
    yhat_hi: number;
    method: string | null;
    mae: number | null;
    n_obs: number | null;
    product_name: string | null;
  }[];

  const byKey = new Map<string, DemandBoardEntry>();
  for (const r of rows) {
    const key = `${r.entity_type}:${r.entity_id}:${r.metric}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        label: r.entity_type === "org" ? "کل شرکت" : (r.product_name ?? `#${r.entity_id}`),
        metric: r.metric,
        method: r.method ?? "seasonal_naive",
        mae: r.mae,
        n_obs: r.n_obs ?? 0,
        points: [],
      };
      byKey.set(key, entry);
    }
    entry.points.push({
      target_period: r.target_period,
      horizon: r.horizon,
      yhat: r.yhat,
      yhat_lo: r.yhat_lo,
      yhat_hi: r.yhat_hi,
    });
  }
  return [...byKey.values()];
}

/** The near-term daily run-rate the inventory rule needs: the forecast next-month
 *  base-unit yhat ÷ 30, or the trailing-28-day actual when there is no model yet. */
export function avgDailySalesFor(organizationId: number, productId: number): number {
  const db = getDb();
  const next = db
    .prepare(
      `SELECT yhat FROM forecasts
        WHERE organization_id = ? AND entity_type = 'product' AND entity_id = ?
          AND metric = 'demand_base_units'
        ORDER BY target_period ASC LIMIT 1`
    )
    .get(organizationId, productId) as { yhat: number } | undefined;
  if (next && next.yhat > 0) return next.yhat / 30;

  const since = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(ol.packs_delivered, 0) * ol.qty_per_pack), 0) AS base
         FROM order_lines ol JOIN orders o ON o.id = ol.order_id
        WHERE o.organization_id = ? AND ol.product_id = ?
          AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
          AND o.order_date >= ?`
    )
    .get(organizationId, productId, since) as { base: number };
  return row.base / 28;
}

export { currentPeriod };
