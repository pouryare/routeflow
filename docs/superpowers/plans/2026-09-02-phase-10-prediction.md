# Phase 10 — Prediction Implementation Plan

> Execute task-by-task, TDD, commit + push each. No review checkpoints.

**Goal:** Demand forecast, churn scoring, and learned `capacity_factors` — estimation for the cold-start year, lightweight incremental learning (exponential smoothing / online SGD / EWMA) that works from one week of data. No external ML service.

**Architecture:** `lib/predict/*` = pure recursions + defaults. `lib/repo/*` = fold history through them, materialise into `forecasts` / `churn_scores` / `capacity_factors.learned_*`. A sweep (`refreshPredictions`) behind `/api/predict/refresh`. A `/sales/forecast` page reads the materialised rows.

**Spec:** `docs/superpowers/specs/2026-09-02-phase-10-prediction-design.md`

## Global Constraints

- Persian UI, English identifiers. Cross-tenant → 404/empty. Migrations idempotent, guarded; the five tables are new `CREATE TABLE IF NOT EXISTS`, the `capacity_factors` columns are guarded `PRAGMA table_info` ALTERs.
- New DB access via `lib/repo/`; `lib/predict/*` stays pure (no `db` import). `tests/repo-boundary.test.ts` still applies.
- Money = whole Toman INTEGER; quantities = REAL base units. Delivered quantities, `FULFILLED_ORDER_STATUSES`. Jalali `YYYY-MM` periods via `lib/analysis/period`.
- Every prediction carries its `method` — `seasonal_naive` shows as «تخمین», `holt` as «یادگیری».
- Never commit to `main` / build / restart. Vitest + tsc as background commands, poll the log. eslint `app/ lib/` + per-file. After a route add: `npx next typegen && rm -rf .next/dev/types`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Push each task.

---

### Task 1: schema — 5 tables + `capacity_factors.learned_*` + seeds

**Files:** Modify `lib/db.ts`, `tests/tenancy-schema.test.ts`; Create `tests/prediction-schema.test.ts`.

- `seasonal_factors`, `forecast_models`, `forecasts`, `churn_models`, `churn_scores` in the main block after `kpi_snapshots`, per spec §1. `ix_forecasts_read`.
- Guarded ALTER loop for `capacity_factors`: `learned_stop_factor`, `learned_speed_factor`, `learned_service_time_factor`, `learned_max_duration_factor` (REAL), `learned_n` (`INTEGER NOT NULL DEFAULT 0`) — `PRAGMA table_info(capacity_factors)` guard, same idiom as the Phase 5 `delivery_runs` loop.
- `seedSeasonalFactors(db)` — `SEASONAL_FACTOR_SEED` = 12 `month` rows + 7 `dow` rows, each mean-normalised to ~1 (mild shape, documented as a shipped guess). `INSERT … SELECT NULL … WHERE NOT EXISTS` per `(kind, idx)`.
- `seedChurnModel(db)` — one NULL-org `churn_models` row, `weights_json` = `CHURN_MODEL_SEED` (hand-set, recency-dominated: `{bias:-1.2, recency_ratio:1.1, trend:-0.8, tenure:-0.3, complaints:0.5, overdue:0.7}`). `INSERT … WHERE NOT EXISTS (… WHERE organization_id IS NULL)`.
- Call both from `getDb()` next to `seedKpiDefinitions`.
- `TENANT_TABLES` += the 5 tables. Both NULL-org sweeps (`~2123`, `~2635`) + `tenancy-schema` no-NULL check: add `seasonal_factors` and `churn_models` to the skip lists.
- `tests/prediction-schema.test.ts`: the 5 tables + the 5 `capacity_factors` columns exist; `forecasts` UNIQUE `(org, entity_type, entity_id, metric, target_period)` bites; `entity_id`/`scope`-style defaults are 0; `seasonal_factors` after boot = 19 NULL-org / 0 tenant; `churn_models` = 1 NULL-org / 0 tenant; the `kind`/`band`/`entity_type`/`metric` CHECKs reject junk.
- Run → fail → implement → pass. Full suite — fix `tenancy-schema` fallout. Commit + push.

### Task 2: `lib/predict/smoothing.ts` (pure)

**Files:** Create `lib/predict/smoothing.ts`, `tests/predict-smoothing.test.ts`.

- `HoltState`, `holtInit(history, alpha=0.4, beta=0.15)` (level = first non-empty, trend = mean of first-differences, 0 when < 2 points), `holtStep(s, y)` (standard additive recursion, returns a new state), `holtForecast(s, h)` (`max(0, level + h*trend)`), `ewmaStep(prev, y, alpha)`, `seasonalNaive(history, season, h)` (`history[history.length - season + ((h - 1) % season)]`, guarded to last value when history shorter than season), `mae(errors)`, `mape(actual, predicted)` (skip zero actuals), `predictionInterval(yhat, maeVal, z=1.28)` → `{ lo: max(0, yhat - z*1.25*maeVal), hi: yhat + z*1.25*maeVal }`.
- Tests: a linear series `[10,12,14,16]` → `holtInit` then `holtStep`×n tracks it, `holtForecast(_,1)` ≈ next value ±1; a flat series → trend → ~0, forecast ≈ level; `holtForecast` never negative on a steep down-trend; `seasonalNaive([1..12], 12, 1)` === `1`, `(…,12,13)` === `1`; `mae([2,-2,4])` === `2.67` (±); `predictionInterval(100, 10)` lo/hi straddle 100, lo ≥ 0; `predictionInterval(5, 100)` lo === 0.
- No `db` import. Commit + push.

### Task 3: `lib/predict/seasonality.ts` (pure)

**Files:** Create `lib/predict/seasonality.ts`, `tests/predict-seasonality.test.ts`.

- `DEFAULT_MONTH_FACTORS` (12, mean 1 — assert in the test), `DEFAULT_DOW_FACTORS` (7, Sat first, mean 1), `seasonalIndex(monthFactors, dowFactors, iso)` (`toJalali` for the month, `Date.UTC` weekday for the dow, product of the two factors), `deseasonalise(y, idx)` (`idx > 0 ? y / idx : y`), `reseasonalise(yhat, idx)` (`yhat * idx`).
- Tests: both arrays sum to their length (mean 1) within 1e-9; `seasonalIndex` for a known ISO date returns `month[jm-1] * dow[d]`; `deseasonalise(reseasonalise(x, i), i)` ≈ x; `deseasonalise(x, 0)` === x (guarded).
- Commit + push.

### Task 4: `lib/predict/churn.ts` (pure)

**Files:** Create `lib/predict/churn.ts`, `tests/predict-churn.test.ts`.

- `ChurnFeatures`, `ChurnWeights`, `DEFAULT_CHURN_WEIGHTS` (spec §2), `logistic(z)` (`1/(1+e^-z)`, clamps z to ±30), `churnScore(f, w)` (`logistic(w.bias + Σ w_k * f_k)` with `trend` centred: use `(f.trend - 1)`), `churnStep(w, f, label, lr)` (gradient of log-loss: `err = churnScore - label`; `w_k -= lr * err * f_k`; `bias -= lr * err`), `churnBand(p)` (≥0.6 high / ≥0.3 watch / low), `churnReason(f)` (the feature with the largest `weight_k * value_k` contribution → a Persian sentence).
- Tests: `logistic(0)` === 0.5, monotone; a high-recency low-trend feature vector scores > 0.6 with the default weights; `churnStep` moves the score toward the label (score before vs after on the same features, label 1 → higher, label 0 → lower); 200 `churnStep` iterations on a separable synthetic set drives training accuracy > 0.8; `churnBand` cutpoints; `churnReason` names recency when recency dominates.
- Commit + push.

### Task 5: `lib/predict/capacityLearning.ts` + `lib/predict/inventory.ts` (pure)

**Files:** Create `lib/predict/capacityLearning.ts`, `lib/predict/inventory.ts`, `tests/predict-capacity-learning.test.ts`, `tests/predict-inventory.test.ts`.

- `capacityLearning.ts`: `observedFactor(planned, actual)` (`planned > 0 ? actual / planned : null`), `ewmaUpdate(prev, obs, alpha=0.25)` (`prev == null ? obs : prev + alpha*(obs - prev)`), `blendConfidence(n, full=10)` (`Math.min(1, n / full)`).
- `inventory.ts`: `reorderPoint(avgDailySales, leadTimeDays, safetyStock)` (`avgDailySales*leadTimeDays + safetyStock`), `stockDays(available, avgDailySales)` (`avgDailySales > 0 ? available/avgDailySales : Infinity`), `inventoryState(available, avgDailySales, reorder, daysSinceLastSale)` → `dead` if `daysSinceLastSale > 60 && available > 0`; `stockout_risk` if `available <= 0` or `stockDays < leadTime-ish` (use `available < reorder * 0.5`); `low` if `available < reorder`; `overstock` if `stockDays(...) > 60`; else `healthy`.
- Tests: `observedFactor(10, 8)` === 0.8, `observedFactor(0, 5)` === null; `ewmaUpdate(null, 0.8)` === 0.8, `ewmaUpdate(1, 0.8, 0.5)` === 0.9; `blendConfidence(5)` === 0.5, `blendConfidence(50)` === 1; `reorderPoint(4, 3, 10)` === 22; `stockDays(100, 0)` === Infinity; each `inventoryState` branch hit by a crafted input.
- Commit + push.

### Task 6: `lib/repo/forecast.ts`

**Files:** Create `lib/repo/forecast.ts`, `tests/forecast-repo.test.ts`.

- `monthlyHistory(orgId, entity, metric)` — closed Jalali months (exclude the current), Σ delivered base-units or Σ delivered revenue from `orders`+`order_lines`, scoped by `entity` (`org` / `group.id` / `product.id`), oldest first, as `{ period, value }[]`.
- `updateForecastModel(orgId, entity, metric, asOfIso?)` — fold months after `last_period`: `deseasonalise` (month factor from `seasonal_factors` tenant ∪ default), `holtInit` at the 3rd point then `holtStep`, accumulate `|actual − predicted|` → rolling `mae`; `method = n_obs >= 8 ? 'holt' : 'seasonal_naive'`. Upsert `forecast_models`.
- `forecastDemand(orgId, entity, metric, horizonMonths = 3, asOfIso?)` — per `h`: `yhat = method==='holt' ? reseasonalise(holtForecast(state, h), monthIdx) : seasonalNaive(historyValues, min(12, len), h)`; `predictionInterval(yhat, mae ?? yhat*0.4)`. Upsert `forecasts` (`target_period` = `shiftPeriod(current, -h)`).
- `materialiseForecasts(orgId, asOfIso?)` — `org` + every active `product`, both metrics.
- `demandBoard(orgId)` — read `forecasts` ⨝ `forecast_models` (method/mae/n_obs) ⨝ product names.
- `avgDailySalesFor(orgId, productId)` — `forecastDemand` next-month `demand_base_units` yhat / 30, else trailing-28-day actual / 28.
- Tests: seed ~10 closed months of a rising product demand; `updateForecastModel` → `n_obs` = 10, `method` `holt`, `mae` > 0; `forecastDemand(_,_,_,3)` → 3 `forecasts` rows, `yhat` above the last actual (rising), `yhat_lo < yhat < yhat_hi`, `yhat_lo >= 0`; a product with only 2 months → `method` `seasonal_naive`, still produces rows; `materialiseForecasts` writes an `org` row; re-running does not duplicate. `avgDailySalesFor` positive for the seeded product.
- Commit + push.

### Task 7: `lib/repo/churn.ts`

**Files:** Create `lib/repo/churn.ts`, `tests/churn-repo.test.ts`.

- `churnFeaturesFor(orgId, customerId, asOfIso?)` → `ChurnFeatures` from `orders` (recency / mean interval / this-vs-prior-quarter counts / tenure = months since first order), `quality_complaints` (90d), `customerDebt` (30+ bucket / trailing revenue).
- `churnWeightsFor(orgId)` — tenant `churn_models` ∪ the NULL-org default (`JSON.parse`).
- `scoreChurn(orgId, customerId, asOfIso?)` → `{ probability, band, reason_fa }`.
- `trainChurnFromLapses(orgId, asOfIso?)` — cutoff = `asOf − 60d`; a customer active at the cutoff (≥1 order in the 60d before it) is `label 1` if they then had no order in the 60d after the cutoff, else `label 0`; features computed **as of the cutoff**. One shuffled epoch of `churnStep` (`lr = 0.05`). Persist `weights_json` + `n_obs` only when the set ≥ 10; otherwise leave the default in place and return `{ trained: false }`.
- `materialiseChurnScores(orgId, asOfIso?)` — `scoreChurn` for every customer with ≥ 1 order; upsert `churn_scores`.
- `churnBoard(orgId, band?)` — read `churn_scores` ⨝ customer names, ordered by probability desc.
- Tests: a customer 90 days silent on a 20-day cadence, with 30+ debt → `probability` high, `band` `high`, `reason_fa` mentions recency; a steady weekly buyer → `band` `low`; `trainChurnFromLapses` with < 10 customers → `{ trained: false }`, default weights untouched; with a separable seeded set of ≥ 12 → `{ trained: true }`, `n_obs` set, and a known-lapsed customer scores higher after than a fresh default would; `materialiseChurnScores` writes one row per ordering customer; `churnBoard('high')` filters.
- Commit + push.

### Task 8: `lib/repo/capacityLearning.ts` + wire weather + `lib/repo/predictionRefresh.ts`

**Files:** Create `lib/repo/capacityLearning.ts`, `lib/repo/predictionRefresh.ts`, `tests/capacity-learning-repo.test.ts`; Modify `lib/repo/weather.ts`.

- `capacityLearning.ts`: `MIN_LEARN_N = 5`. `learnCapacityFromRuns(orgId, asOfIso?)` — completed `delivery_runs` (status `done`) with `weather_json` holding a `conditions: string[]` and both planned + actual distance/duration + `capacity_stops` + a stop count: per condition, `observedFactor` for `speed` (`planned_duration_min / actual_duration_min`), `stops` (`actual_stops / capacity_stops`), `duration` (`actual_duration_min / planned_duration_min`); `ewmaUpdate` each `learned_*` column on the tenant `capacity_factors` row (INSERT the tenant row from the NULL-org default first if missing), `learned_n += 1`. `resolvedCapacityFactorsFor(orgId)` — the Phase 6 union, but every factor is `learned_n >= MIN_LEARN_N ? learned_x : configured_x`.
- `lib/repo/weather.ts`: `runWeatherAdjustment` swaps `capacityFactorsFor` → `resolvedCapacityFactorsFor` (import from the new module). Nothing else changes; the Phase 6 tests still pass because with `learned_n = 0` the resolved value === the configured value.
- `predictionRefresh.ts`: `refreshPredictions(orgId, asOfIso?)` → `{ forecasts, churn, capacity }` — `updateForecastModel` (org + per product, both metrics) + `materialiseForecasts`; `trainChurnFromLapses` + `materialiseChurnScores`; `learnCapacityFromRuns`. Own module (mirrors `analysisRefresh` — avoids an import cycle through `weather`).
- Tests: seed 6 `done` runs in `heavy_rain` where actual duration is 1.3× planned → after `learnCapacityFromRuns`, the tenant row's `learned_speed_factor` < 1 and `learned_n` = 6; `resolvedCapacityFactorsFor` returns the learned value (n ≥ 5); with only 3 runs → `learned_n` = 3 and `resolved` still === configured. `runWeatherAdjustment` unchanged when `learned_n = 0`. `refreshPredictions` returns non-zero counts on a seeded org.
- Commit + push.

### Task 9: Action Center churn source + `/api/predict/*` routes

**Files:** Modify `lib/repo/actionCenter.ts`, `proxy.ts`; Create `app/api/predict/demand/route.ts`, `app/api/predict/churn/route.ts`, `app/api/predict/capacity/route.ts`, `app/api/predict/refresh/route.ts`, `tests/api/predict-route.test.ts`; Modify `tests/action-center-repo.test.ts`.

- `actionCenter.ts`: a `churnCandidates(session)` reading `churn_scores` band `high` in scope → `kind: "at_risk_customer"`, `bucket: "warning"`, `probability = row.probability`, `impact` from trailing revenue (or a flat 0.5), `href` to the customer. Add to the `actionCenterFor` list. Skip when the table has no rows.
- Routes: each `requireRole(["owner","group_manager"])` (manager tool), `dynamic = "force-dynamic"`. `demand` GET `?entity=&id=&metric=&horizon=` → `demandBoard` (no args) or `forecastDemand` (with args). `churn` GET `?band=&id=` → `churnBoard` / `scoreChurn`. `capacity` GET → `resolvedCapacityFactorsFor` + the `learned_n` per row. `refresh` POST → `refreshPredictions(orgId)`.
- `proxy.ts`: `pathname.startsWith("/api/predict")` → manager-gated (extend the `isBatchAdmin` list); `/sales/forecast` is covered by the existing driver gate + the page redirects a salesperson.
- Tests: `cookie(owner)` → each GET 200; `cookie(salesperson)` → each 403; `refresh` POST as owner → 200 with counts, as salesperson → 403; a seeded `churn_scores` `high` row shows up in `actionCenterFor` warning bucket.
- `npx next typegen && rm -rf .next/dev/types`. Commit + push.

### Task 10: UI — `/sales/forecast` + nav

**Files:** Create `app/sales/forecast/page.tsx`, `components/predict/DemandTable.tsx`, `components/predict/ChurnList.tsx`, `components/predict/LearnedCapacity.tsx`; Modify `app/sales/layout.tsx`.

- Page (server, `force-dynamic`): redirect non-manager → `/sales`; read `demandBoard` + `churnBoard` + `resolvedCapacityFactorsFor` (+ `learned_n`) + newest `forecasts.computed_at` server-side. Render Demand → Churn → Learned capacity. A «به‌روزرسانی پیش‌بینی» button (client island posting to `/api/predict/refresh` then `router.refresh()`).
- `DemandTable.tsx` — product rows, next 3 months `yhat` with `[lo–hi]`, a method badge («تخمین» amber / «یادگیری» green), `MAE`, `n`. Org total on top.
- `ChurnList.tsx` — `high` then `watch`, name · `probability` as a percent · `reason_fa` · customer link.
- `LearnedCapacity.tsx` — condition · configured factor · learned factor · `learned_n` bar; a note that learning starts overriding at n ≥ 5.
- `app/sales/layout.tsx`: `{ href: "/sales/forecast", label: "پیش‌بینی", ready: ["owner","group_manager"].includes(session.role) }` after «تحلیل».
- `npx next typegen`; tsc; eslint the new files. Commit + push.

### Task 11: tenancy, real-data check, handoff, finish the branch

**Files:** Modify `tests/helpers/twoOrgs.ts`, `tests/tenancy-isolation.test.ts`, `docs/crm-erp-plan.md`; Create `tests/prediction-migration-realdata.test.ts`, `docs/HANDOFF-2026-09-02-phase-10-prediction.md`; Modify the memory file.

- `twoOrgs`: `OrgFixture` += `forecastModelId`, `churnScoreId`; seed a tenant `seasonal_factors` override + a `forecast_models` row + a `churn_scores` row per org.
- `tenancy-isolation`: models / forecasts / scores never cross; the 19 NULL-org `seasonal_factors` + the 1 NULL-org `churn_models` stay shared; a tenant `capacity_factors.learned_*` value does not leak.
- `tests/prediction-migration-realdata.test.ts` (env-gated): FK check empty; the 5 tables + 5 `capacity_factors` columns; `forecasts`/`forecast_models`/`churn_scores` empty; `seasonal_factors` 19 NULL-org / 0 tenant; `churn_models` 1 / 0; `refreshPredictions(1)` clean + ≥ 1 `forecasts` row.
- Full suite + `tsc` + `eslint app/ lib/` green. `docs/crm-erp-plan.md` Part 5 row 10 → `**10. Prediction — ✅ DONE** …`; also mark the "Sequencing note" / any Part-5 preamble that all 10 phases are code-complete.
- Handoff doc (what shipped, deviations from spec §9, the cold-start behaviour, pre-deploy checklist incl. wiring a scheduler to `/api/predict/refresh`, next = merge + deploy the whole stack).
- Memory `routeflow-phase-progress.md`: add the Phase 10 bullet; change the "next up" line to "all 10 phases code-complete — next is the merge + deploy of the whole stacked branch chain with a fresh SQLite-backup-API copy, done with the user".
- Commit + push.
- **Then** invoke `superpowers:finishing-a-development-branch`: run the full suite, and present the 3 options (merge locally / push+PR / keep as-is) for the branch. Do **not** merge — the user's standing instruction is that the whole stack merges + deploys together after Phase 10, with a fresh backup, and "i will check the entire app once everything is done and live". Report that Phase 10 (and the whole Phase 0–10 chain) is code-complete and awaiting the user's merge/deploy decision.

---

## Self-review

- **Spec coverage:** §1 → T1; §2 smoothing → T2, seasonality → T3, churn → T4, capacity/inventory → T5; §3 forecast repo → T6, churn repo → T7, capacity repo + refresh → T8; §4 wiring → T8 (weather) + T9 (Action Center); §5 API → T9; §6 UI → T10; §7 tenancy + §8 migration → T11; §9 deviations → handoff.
- **Type consistency:** `HoltState` (T2) used by `forecast.ts` (T6). `ChurnFeatures`/`ChurnWeights` (T4) by `churn.ts` repo (T7). `resolvedCapacityFactorsFor` (T8) returns Phase 6's `FactorRow[]` shape so `weatherAdjustment` is unchanged. `demandBoard`/`churnBoard` rows (T6/T7) consumed by T9 routes + T10 components.
- **No placeholders:** every task names files, the pure/repo split, and concrete assertions.
- **Scope:** one plan, one branch — three predictors sharing a sweep + one page. No decomposition needed. This is the last phase; T11 ends by handing the merge decision to the user.
