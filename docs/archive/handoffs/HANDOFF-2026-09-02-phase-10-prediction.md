# RouteFlow Phase 10 (Prediction) — Handoff

**Date:** 2026-09-02 · **Branch:** `phase-10-prediction` (off `phase-9-analysis`) · **Status:** code-complete, unmerged. **This is the last phase — all of Phase 0–10 is now code-complete.**

Spec: `docs/superpowers/specs/2026-09-02-phase-10-prediction-design.md` · Plan: `docs/superpowers/plans/2026-09-02-phase-10-prediction.md` (11 tasks, done).

## The cold-start rule (user instruction)

The company has no sales history yet. Every predictor **estimates** for the first year and switches to **lightweight incremental learning from as little as one week**: exponential smoothing for demand, one online-SGD step per labelled lapse for churn, EWMA for capacity. No external ML service; every recursion is a pure, tested function. On the page a prediction is badged «تخمین» while it is still a shipped seasonal guess and «یادگیری» once the model has its own months.

## What shipped

| Area | Detail |
|---|---|
| Schema | `seasonal_factors` (12 `month` + 7 `dow` NULL-org multipliers, mean-normalised; `reason_codes` treatment), `forecast_models` (per-series Holt state: `level`/`trend`/`alpha`/`beta`/`n_obs`/`mae`/`method`/`last_period`), `forecasts` (materialised `yhat`/`yhat_lo`/`yhat_hi` per `target_period`, `ix_forecasts_read`), `churn_models` (one NULL-org logistic `weights_json`, `reason_codes` treatment), `churn_scores` (materialised `probability`/`band`/`reason_fa`). `capacity_factors` gains `learned_stop_factor` / `learned_speed_factor` / `learned_service_time_factor` / `learned_max_duration_factor` / `learned_n` via guarded `PRAGMA table_info` ALTER — `learned_n = 0` leaves every Phase 6 reading unchanged. `TENANT_TABLES` += the five; both NULL-org sweeps + `tenancy-schema` no-NULL check skip `seasonal_factors` + `churn_models`. `seedSeasonalFactors` (19 rows), `seedChurnModel` (one recency-dominated vector). |
| `lib/predict/*` (pure, no `db`) | `smoothing.ts` — `holtInit`/`holtStep`/`holtForecast` (floored at 0), `ewmaStep`, `seasonalNaive` (cold-start fallback), `mae`/`mape`, `predictionInterval` (±z·1.25·MAE, floored). `seasonality.ts` — `DEFAULT_MONTH_FACTORS` (12) + `DEFAULT_DOW_FACTORS` (7), both mean 1; `seasonalIndex`/`monthIndex`/`deseasonalise`/`reseasonalise`. `churn.ts` — `ChurnFeatures` (recency_ratio · trend · tenure_months · complaints_90d · overdue_ratio), `DEFAULT_CHURN_WEIGHTS`, `logistic`, `churnScore`, `churnStep` (one log-loss gradient step), `churnBand` (≥0.6 high / ≥0.3 watch), `churnReason`. `capacityLearning.ts` — `observedFactor` (actual/planned), `ewmaUpdate` (seed-then-blend), `blendConfidence`. `inventory.ts` — `reorderPoint` (source §6: `avg_daily_sales × lead_time + safety`), `stockDays`, `inventoryState` (dead / stockout_risk / low / overstock / healthy). |
| `lib/repo/*` | `forecast.ts` — `monthlyHistory` (closed Jalali months, open one excluded, scoped org/group/product), `updateForecastModel` (deseasonalise → `holtInit` at the 3rd point → `holtStep`; `method='holt'` once `n_obs ≥ 8`, else `seasonal_naive`; rolling MAE), `forecastDemand` (3-month horizon → `forecasts` upsert), `materialiseForecasts` (org + every product, both metrics), `demandBoard`, `avgDailySalesFor` (forecast run-rate for the inventory rule), `newestForecastAt`, `seasonalMonthFactors`. `churn.ts` — `churnFeaturesFor` (filters `order_date < asOf`, so it is safe at a historical cutoff), `churnWeightsFor` (tenant ∪ NULL-org default), `scoreChurn`, `trainChurnFromLapses` (label = active-at-cutoff then silent-60d; features as of the cutoff; a few SGD epochs; **no-op below 10 labelled rows**), `materialiseChurnScores`, `churnBoard`. `capacityLearning.ts` — `learnCapacityFromRuns` (completed `done` runs with `weather_json.conditions` + planned/actual duration + stops → per-condition `observedFactor` → `ewmaUpdate` into `capacity_factors.learned_*`, creating the tenant row from the NULL-org default; `learned_n += 1`), `resolvedCapacityFactorsFor` (learned value once `learned_n ≥ MIN_LEARN_N = 5`, else configured), `learnedCapacityCounts`. `predictionRefresh.ts` — `refreshPredictions` (materialiseForecasts + trainChurnFromLapses + materialiseChurnScores + learnCapacityFromRuns), own module so `forecast`/`churn`/`capacityLearning` never import it back. |
| Wiring | `lib/repo/weather.runWeatherAdjustment` reads `resolvedCapacityFactorsFor` instead of `capacityFactorsFor` — identical output while nothing has been learned. `lib/repo/actionCenter` gains a `churnCandidates` source (`churn_scores` band `high` → a warning card), a no-op until the sweep has run. |
| API | `GET /api/predict/demand` (board, or a fresh series with `entity`/`id`/`metric`/`horizon`), `/churn` (board / band slice / one customer), `/capacity` (resolved factors + `learned_n`); `POST /api/predict/refresh`. All `owner`/`group_manager` only; `proxy.ts` manager-gates `/api/predict` + `/sales/forecast`. |
| UI | `/sales/forecast` (manager-only): demand table (next 3 Jalali months, `yhat` with the `[lo–hi]` band, a «تخمین»/«یادگیری» method badge, MAE / n) → churn risk list (`high` then `watch`, probability + `reason_fa` + a customer link) → learned-capacity panel (per condition: resolved speed/stop factor + `learned_n`, ✓ at ≥ 5). A «به‌روزرسانی پیش‌بینی» button + a freshness line. «پیش‌بینی» nav tab after «تحلیل». |
| Tenancy | Five new tenant tables + five `capacity_factors` columns. `twoOrgs` seeds a tenant `seasonal_factors` override + a `forecast_models` row + a `churn_scores` row per org. `tenancy-isolation` asserts models / scores / seasonal overrides / `learned_*` never cross and the 19 + 1 NULL-org defaults stay shared. |

Suite: **green** (`tsc` + `eslint app/ lib/` clean — see the commit CI notes; `tests/jalali.test.ts` "agrees with Intl for every day across 20 Jalali years" is a known slow/flaky test under full-suite parallelism, passes in isolation and on re-run — unrelated). Real-data check: `foreign_key_check` empty, five tables + `learned_*` columns present, `forecasts`/`forecast_models`/`churn_scores` empty, 19 + 1 NULL-org seeds, `refreshPredictions(1)` ran clean.

## Deviations from the spec

- **Monthly grain, 3-month horizon.** No daily forecast or a longer horizon in v1 — grain is a caller argument, not a schema change.
- **`refreshPredictions` is a function behind `/api/predict/refresh`, not a cron** — the Phase 5/7/9 pattern. Wire a scheduler at deploy.
- **Holt (level + trend), not Holt-Winters.** Seasonality is applied outside the recursion via `seasonal_factors` (deseasonalise → smooth → reseasonalise), so the model stays two-parameter and stable from ~3 points. A tenant learning its own seasonal shape from a full year is a follow-on.
- **`updateForecastModel` recomputes from the full closed history** each run rather than folding only new months — months are few, and it makes re-runs trivially idempotent. Framed as "folding" in the spec; the effect is the same.
- **Churn training is a few epochs of plain SGD** (spec said "one epoch") on ≤ a few hundred rows, in-process, on the sweep — no held-out validation, no regularisation beyond feature clamping. The default weights carry a new tenant until ≥ 10 labelled lapses exist.
- **`learnCapacityFromRuns` learns `speed_factor` and `stop_factor` only** — the two with clean observations (`planned_dur/actual_dur`, `actual_stops/capacity_stops`). `learned_service_time_factor` / `learned_max_duration_factor` columns exist but are populated later; `resolvedCapacityFactorsFor` falls back to the configured value for any null learned column.
- **`inventory.ts` ships but only `avgDailySalesFor` is consumed so far** — pointing the Phase 9 Action Center `stockout_risk` at it (instead of its own trailing run-rate) is a one-line follow-on.
- **Health weights, churn default weights, seasonal factors, and the Action Center Impact/Urgency mappings are all hand-set constants.** They are the shipped estimate; the learning paths (churn SGD, capacity EWMA, and a future seasonal-shape learner) replace them per-tenant as data arrives.

## Pre-deploy checklist — the whole Phase 0–10 stack

1. **Fresh backup via the SQLite backup API** (not `cp` — `routeflow.db` is WAL mode).
2. Run every `*-migration-realdata` test against that copy: `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/*-migration-realdata` — all should pass (FK check empty, new tables/columns present, seeds present, sweeps run clean).
3. Merge the branch chain in order (`phase-0-tenancy` → … → `phase-10-prediction`) into `main`, or fast-forward if it is already linear.
4. `npm run build` + `systemctl restart routeflow`.
5. **Wire schedulers** (or a boot hook) to `POST /api/rules/run`, `POST /api/analysis/refresh` and `POST /api/predict/refresh` — hourly, or on a post-delivery trigger — so the briefing, the KPI board, the Action Center and the forecasts stay warm.
6. **Author the academy content** (Phase 8 backlog): `content/academy/*/index.mdx` for modules 1–7 from the source ChatGPT conversation; flip `_manifest.json` `status` to `ready` per module.
7. Sanity-check `/today`, `/sales/analysis`, `/sales/forecast` and a driver's `/driver` with real data before handing over.

## Next

There is no next phase. The RouteFlow CRM/ERP build (Part 5 of `docs/crm-erp-plan.md`) is code-complete across all ten phases. The remaining work is the merge + deploy above, which is the user's call — "i will check the entire app once everything is done and live."
