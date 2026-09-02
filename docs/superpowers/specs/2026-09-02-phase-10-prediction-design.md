# RouteFlow Phase 10 — Prediction — Design

**Date:** 2026-09-02 · **Branch:** `phase-10-prediction` (off `phase-9-analysis`) · **Status:** design.

Implements `docs/crm-erp-plan.md` Part 5 row 10 (demand forecast · churn · learned `capacity_factors` from actuals) and source-extract §6 ("Rule-based first, forecasting later"; "don't build the formula on past sales alone").

**Cold-start rule (user instruction, 2026-09-02):** the company has no history yet. Every predictor **estimates** for the first year — a seasonal-naive baseline off shipped month/day indices — and switches to **lightweight incremental learning that works from as little as one week of data**: exponential smoothing for demand, one-step online SGD for churn, EWMA for capacity. No external ML service; every recursion is a pure function, fully TDD'd.

---

## 1. Schema

All new `CREATE TABLE IF NOT EXISTS` + one guarded ALTER on `capacity_factors`. No rebuilds.

```sql
-- Shipped season shape. NULL-org = a default (seedSeasonalFactors), the reason_codes
-- treatment. A tenant may tune its own once it has a year of its own history.
CREATE TABLE seasonal_factors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER REFERENCES organizations(id),   -- NULL = shipped default
  kind TEXT NOT NULL CHECK (kind IN ('month', 'dow')),    -- Jalali month 1-12, or day-of-week 0-6 (Sat=0)
  idx INTEGER NOT NULL,
  factor REAL NOT NULL DEFAULT 1,                         -- multiplicative, mean ~1 across the cycle
  note_fa TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, kind, idx)
);

-- The learned state of one time series. One row per (entity, metric); folded forward
-- one closed Jalali month at a time.
CREATE TABLE forecast_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('org', 'group', 'product')),
  entity_id INTEGER NOT NULL DEFAULT 0,                   -- 0 for 'org'
  metric TEXT NOT NULL CHECK (metric IN ('demand_base_units', 'demand_toman')),
  method TEXT NOT NULL DEFAULT 'seasonal_naive',          -- 'seasonal_naive' | 'holt'
  level REAL, trend REAL,
  alpha REAL NOT NULL DEFAULT 0.4,
  beta REAL NOT NULL DEFAULT 0.15,
  n_obs INTEGER NOT NULL DEFAULT 0,
  mae REAL,                                               -- rolling mean absolute error, deseasonalised
  last_period TEXT,                                       -- the last Jalali month folded in
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, entity_type, entity_id, metric)
);

-- Materialised predictions the pages + routing read.
CREATE TABLE forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL DEFAULT 0,
  metric TEXT NOT NULL,
  target_period TEXT NOT NULL,                            -- Jalali 'YYYY-MM'
  horizon INTEGER NOT NULL,                               -- months ahead (1..)
  yhat REAL NOT NULL, yhat_lo REAL NOT NULL, yhat_hi REAL NOT NULL,
  method TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  UNIQUE (organization_id, entity_type, entity_id, metric, target_period)
);
CREATE INDEX ix_forecasts_read ON forecasts(organization_id, entity_type, metric, target_period);

-- One logistic weight vector per tenant. NULL-org = shipped defaults.
CREATE TABLE churn_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER REFERENCES organizations(id),   -- NULL = shipped default
  weights_json TEXT NOT NULL,                             -- { bias, recency_ratio, trend, tenure, complaints, overdue }
  n_obs INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id)
);

-- Materialised churn probability per customer.
CREATE TABLE churn_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  probability REAL NOT NULL,
  band TEXT NOT NULL CHECK (band IN ('low', 'watch', 'high')),
  reason_fa TEXT,
  computed_at TEXT NOT NULL,
  UNIQUE (organization_id, customer_id)
);

-- guarded ALTER: learned capacity factors sit *beside* the shipped/tuned ones.
ALTER TABLE capacity_factors ADD COLUMN learned_stop_factor REAL;
ALTER TABLE capacity_factors ADD COLUMN learned_speed_factor REAL;
ALTER TABLE capacity_factors ADD COLUMN learned_service_time_factor REAL;
ALTER TABLE capacity_factors ADD COLUMN learned_max_duration_factor REAL;
ALTER TABLE capacity_factors ADD COLUMN learned_n INTEGER NOT NULL DEFAULT 0;
```

`TENANT_TABLES` += `seasonal_factors`, `forecast_models`, `forecasts`, `churn_models`, `churn_scores`. `seasonal_factors` + `churn_models` get the `reason_codes` treatment (both NULL-org sweeps + `tenancy-schema` no-NULL skip). `seedSeasonalFactors` — 12 month + 7 dow rows, mean-normalised to ~1 (a mild Nowruz/Ramadan-ish shape for month, a Thu/Fri dip for dow — documented as a *shipped guess*, the whole point of the cold-start rule). `seedChurnModel` — one NULL-org `weights_json` (hand-set, recency-dominated).

---

## 2. Pure — `lib/predict/*` (no `db`)

### `smoothing.ts`
```ts
export interface HoltState { level: number; trend: number; alpha: number; beta: number; }
export function holtInit(history: number[], alpha?: number, beta?: number): HoltState;   // level=first, trend=mean diff
export function holtStep(s: HoltState, y: number): HoltState;                             // one observation → new state
export function holtForecast(s: HoltState, h: number): number;                            // level + h*trend, floored at 0
export function ewmaStep(prev: number, y: number, alpha: number): number;
export function seasonalNaive(history: number[], season: number, h: number): number;     // history[len - season + ((h-1) % season)]
export function mae(errors: number[]): number;
export function mape(actual: number[], predicted: number[]): number;
export function predictionInterval(yhat: number, maeVal: number, z = 1.28): { lo: number; hi: number }; // ±z·1.25·mae, lo≥0
```

### `seasonality.ts`
```ts
export const DEFAULT_MONTH_FACTORS: number[];   // length 12, mean 1
export const DEFAULT_DOW_FACTORS: number[];     // length 7, Sat first, mean 1
export function seasonalIndex(monthFactors: number[], dowFactors: number[], iso: string): number;
export function deseasonalise(y: number, idx: number): number;   // y / idx, guarded
export function reseasonalise(yhat: number, idx: number): number;
```

### `churn.ts`
```ts
export interface ChurnFeatures {
  recency_ratio: number;   // days since last order / their mean interval (clamped 0..5)
  trend: number;           // this-quarter orders / prior-quarter (clamped 0..3), centred at 1
  tenure_months: number;   // clamped 0..36, scaled /12
  complaints_90d: number;
  overdue_ratio: number;   // 30+ day debt / trailing revenue, clamped 0..2
}
export type ChurnWeights = { bias: number } & Record<keyof ChurnFeatures, number>;
export const DEFAULT_CHURN_WEIGHTS: ChurnWeights;
export function logistic(z: number): number;
export function churnScore(f: ChurnFeatures, w: ChurnWeights): number;                 // 0..1
export function churnStep(w: ChurnWeights, f: ChurnFeatures, label: 0 | 1, lr: number): ChurnWeights;  // one SGD step
export function churnBand(p: number): "low" | "watch" | "high";                        // ≥0.6 high, ≥0.3 watch
export function churnReason(f: ChurnFeatures): string;                                 // the dominant driver, Persian
```

### `capacityLearning.ts`
```ts
export function observedFactor(planned: number, actual: number): number | null;   // actual/planned, null if planned≤0
export function ewmaUpdate(prev: number | null, obs: number, alpha = 0.25): number; // prev ?? obs, else blend
export function blendConfidence(n: number, full = 10): number;                     // min(1, n/full)
```

### `inventory.ts` (source §6 inventory engine, now with a forecast for `avg_daily_sales`)
```ts
export function reorderPoint(avgDailySales: number, leadTimeDays: number, safetyStock: number): number;
export function stockDays(available: number, avgDailySales: number): number;       // Infinity when sales 0
export type InvState = "healthy" | "overstock" | "low" | "stockout_risk" | "dead";
export function inventoryState(available: number, avgDailySales: number, reorder: number, daysSinceLastSale: number): InvState;
```

---

## 3. Repos

### `lib/repo/forecast.ts`
- `monthlyHistory(orgId, entity, metric)` — closed Jalali months (exclude the current, still-open one) of `demand_base_units` (Σ delivered base qty) or `demand_toman` (Σ delivered revenue) from `orders`, oldest first.
- `updateForecastModel(orgId, entity, metric, asOfIso?)` — for every closed month after `last_period`: deseasonalise, `holtStep` (or seed `holtInit` at the 3rd point), accumulate `|error|` → rolling `mae`; `method='holt'` once `n_obs ≥ 8`, else keep `seasonal_naive`. Persist the state.
- `forecastDemand(orgId, entity, metric, horizonMonths = 3)` — from the model: per future month `h`, `yhat = method==='holt' ? reseasonalise(holtForecast(state,h), idx(month)) : seasonalNaive(history, 12 or len, h)`; `predictionInterval(yhat, mae)`. Upsert `forecasts`.
- `materialiseForecasts(orgId)` — org + every active product, both metrics, 3-month horizon.
- `demandBoard(orgId, period?)` — read `forecasts` (+ the model's `method`/`mae`/`n_obs`) for the page; joins product names.
- `avgDailySalesFor(orgId, productId)` — the near-term run rate the inventory rule needs (`forecast next-month yhat / 30`, or the trailing-28-day actual when no model yet).

### `lib/repo/churn.ts`
- `churnFeaturesFor(orgId, customerId, asOfIso?)` → `ChurnFeatures` from `orders` (recency, cadence, trend, tenure), `quality_complaints`, `customerDebt`.
- `scoreChurn(orgId, customerId)` → `{ probability, band, reason_fa }` using the tenant weights ∪ the NULL-org default.
- `trainChurnFromLapses(orgId, asOfIso?)` — build a labelled set from history: a customer is **lapsed (label 1)** if, at a cutoff 60 days before `asOf`, they were active and then had no order for 60 days; **retained (label 0)** otherwise. One epoch of `churnStep` over the set (shuffled, `lr` small). Persist `weights_json` + `n_obs`. No-op when the set is < 10 (stay on the default).
- `materialiseChurnScores(orgId)` — `scoreChurn` for every customer with ≥ 1 order, upsert `churn_scores`.
- `churnBoard(orgId, band?)` — read `churn_scores` joined to customer names.

### `lib/repo/capacityLearning.ts`
- `learnCapacityFromRuns(orgId, asOfIso?)` — completed `delivery_runs` with a `weather_json` condition list and both planned + actual distance/duration/stops: per condition, `observedFactor` for speed (`planned_duration / actual_duration` ~ inverse), stops (`actual_stops / capacity_stops`), duration; `ewmaUpdate` the tenant `capacity_factors` row's `learned_*` columns (create the tenant row from the NULL-org default first if absent), bump `learned_n`.
- `resolvedCapacityFactorsFor(orgId)` — like Phase 6 `capacityFactorsFor`, but each factor is `learned_n >= MIN_LEARN_N ? learned_x : configured_x` (`MIN_LEARN_N = 5`). `lib/repo/weather.runWeatherAdjustment` switches to this (one-line change).

### `lib/repo/predictionRefresh.ts`
- `refreshPredictions(orgId, asOfIso?)` → `{ forecasts, churn, capacity }` — `updateForecastModel` + `materialiseForecasts`, `trainChurnFromLapses` + `materialiseChurnScores`, `learnCapacityFromRuns`. The sweep entry point (own module — mirrors `analysisRefresh`).

---

## 4. Wiring into earlier phases (small, documented)

- **Action Center** (`lib/repo/actionCenter.ts`) — add a `churn` source: `churn_scores` band `high` → an `at_risk_customer`-bucket candidate, `probability` as the `probability` factor. One function, ~15 lines.
- **Weather / routing** — `runWeatherAdjustment` reads `resolvedCapacityFactorsFor`. Routing already flows the adjustment into `buildPlan`; nothing else changes.
- **Stock** — `/sales/stock` (or the forecast page) shows `inventoryState` + `reorderPoint` using `avgDailySalesFor`. The Phase 9 Action Center `stockout_risk` keeps its simpler run-rate; a follow-on can point it at `avgDailySalesFor`.

---

## 5. API

| route | method | notes |
|---|---|---|
| `/api/predict/demand` | GET `?entity=&id=&metric=&horizon=` | `demandBoard` / `forecastDemand` read; manager+ |
| `/api/predict/churn` | GET `?band=` or `?id=` | `churnBoard` / `scoreChurn`; manager+ |
| `/api/predict/capacity` | GET | `resolvedCapacityFactorsFor` + `learned_n`; manager+ |
| `/api/predict/refresh` | POST | `refreshPredictions(orgId)` — the cron hook; owner/group_manager, `proxy.ts` manager-gated |

---

## 6. UI — `/sales/forecast`

One manager-facing page, three blocks:
1. **Demand** — a table: product · next 3 Jalali months (`yhat` with the `[lo, hi]` band) · `method` badge (`تخمین` vs `یادگیری`) · `MAE` · `n` months of history. An org total row on top.
2. **Churn risk** — the `high` then `watch` customers: name · probability · `reason_fa` · a link to the customer.
3. **Learned capacity** — per condition: shipped/tuned factor vs learned factor vs `learned_n` (confidence), so a manager sees the model is nudging `heavy_rain` toward what their own routes actually show.

A «به‌روزرسانی پیش‌بینی» button (manager) → `POST /api/predict/refresh`. Freshness line from the newest `forecasts.computed_at`. Nav: «پیش‌بینی» tab after «تحلیل».

Every prediction on the page is labelled with its method: while `method='seasonal_naive'` the badge reads «تخمین» and the copy says the figure is a shipped seasonal guess until the company has its own months — the source's "rule-based first" made visible.

---

## 7. Tenancy

Five new tenant tables + five new `capacity_factors` columns. `seasonal_factors` + `churn_models` keep NULL-org defaults. `twoOrgs` seeds a tenant `seasonal_factors` override + a `forecast_models` row + a `churn_scores` row per org. `tenancy-isolation`: models / forecasts / scores never cross; the NULL-org seasonal + churn defaults stay shared; `learned_*` on a tenant `capacity_factors` row does not leak.

---

## 8. Migration safety

`tests/prediction-migration-realdata.test.ts` (env-gated, real backup): `foreign_key_check` empty; the five tables + the five `capacity_factors` columns exist; `forecasts` / `forecast_models` / `churn_scores` empty; `seasonal_factors` has 19 NULL-org rows (12 + 7), 0 tenant; `churn_models` 1 NULL-org, 0 tenant; `refreshPredictions(1)` runs clean and writes at least one `forecasts` row.

---

## 9. Deviations anticipated

- **Monthly grain, 3-month horizon.** No daily forecast or a longer horizon in v1 — the recursion is grain-agnostic, so both are a later caller change.
- **`refreshPredictions` is a function behind `/api/predict/refresh`, not a cron** — the Phase 5/7/9 pattern.
- **Holt (level+trend), not Holt-Winters.** Seasonality is handled by the shipped `seasonal_factors` multipliers applied outside the recursion (deseasonalise → smooth → reseasonalise), so the model itself stays two-parameter and stable from ~3 points. A tenant learning its own seasonal shape from a full year is a follow-on.
- **Churn training is one epoch of plain SGD on ≤ a few hundred rows**, in-process, on the sweep. No held-out validation, no regularisation beyond feature clamping. The default weights carry a brand-new tenant; training only nudges once there are ≥ 10 labelled outcomes.
- **Learned capacity factors sit in new `learned_*` columns** and only override the configured value once `learned_n ≥ 5` — a manual tune via `upsertCapacityFactor` still shows until the model has five observations, then the model wins in the sweep. Documented, reversible (drop the columns / revert the one `runWeatherAdjustment` line).
- **`inventory.ts` ships but only the forecast page consumes it fully** — pointing the Phase 9 Action Center `stockout_risk` at `avgDailySalesFor` is a one-line follow-on.
- **No model-quality UI beyond MAE + `n` + the method badge.** Enough for a manager to know whether to trust a number; a backtest chart is out of scope.
