# RouteFlow Phase 9 (Analysis) — Handoff

**Date:** 2026-09-02 · **Branch:** `phase-9-analysis` (off `phase-8-reps-academy`) · **Status:** code-complete, unmerged.

Spec: `docs/superpowers/specs/2026-09-02-phase-9-analysis-design.md` · Plan: `docs/superpowers/plans/2026-09-02-phase-9-analysis.md` (11 tasks, done).

## What shipped

| Area | Detail |
|---|---|
| Schema | `kpi_definitions` — the KPI registry (`title_fa` · `definition_fa` · `formula_fa` · `owner_role` · `benchmark_fa` · `frequency` · `action_fa` · `tier` · `direction`); `organization_id NULL` = a shipped default, the `reason_codes` treatment (both NULL-org sweeps + `tenancy-schema` no-NULL check skip it). `seedKpiDefinitions` plants **14 Tier-1 rows** with real Persian definitions. `kpi_snapshots` — precomputed values per `(metric, scope_type, scope_id, period)`; `scope_id NOT NULL DEFAULT 0` (0 = org-level) sidesteps the `targets` NULL-in-UNIQUE trap; `numerator`/`denominator` for ratio drill-downs, `sample_size` as the honesty hook; `ix_kpi_snapshots_read`. Both on `TENANT_TABLES`. Brand-new `CREATE TABLE IF NOT EXISTS` — no rebuild, no ALTER. |
| `lib/analysis/*` (pure, no `db`) | `metrics.ts` — `METRICS` (14), `RATIO_METRICS`, `METRIC_DIRECTION`, `formatMetric`, Data Dictionary constants (`ACTIVE_WINDOW_DAYS=60` …). `period.ts` — `periodRange` (Jalali `YYYY-MM` → half-open Gregorian ISO), `periodOf`, `shiftPeriod`, `currentPeriod`. `margin.ts` — `marginPct`, `rollUp` (group `Keyed` lines → `MarginRow` with `margin_toman`/`margin_pct`/`share_pct`, sorted by profit). `health.ts` — `customerHealth` / `salespersonScore` / `driverScore` (weighted 0–100 factor means, `band` good≥70/watch≥40/risk, `reasons` = sub-midpoint factors by weight×deficit). `why.ts` — `explainDelta(before, after, labels)` → per-bucket delta + share of the total move + a headline. `actionCenter.ts` — `priorityScore` (clamped Impact×Probability×Urgency), `rankActionCenter` (split by bucket, sort, cap 12). |
| `lib/repo/*` | `margin.ts` — `marginBy(org, dimension, period, session)` over frozen delivered lines (`customer`/`product`/`salesperson`/`group`/`representative`, `orderFilter`-scoped, refuses a salesperson); `materialiseMargin` writes `net_sales`/`gross_profit`/`gross_margin` at org+group+salesperson. `health.ts` — `customerHealthFor`, `customersHealthOverview` (group-scoped, worst first), `salespersonScoreFor`, `driverScoreFor`, `materialiseHealth`. `why.ts` — `whyChain(session, metric, A, B)` walks territory → salesperson-within-it → funnel stage, descending into the biggest mover; `net_sales`/`gross_profit`/`orders`; on-demand two-period scan. `actionCenter.ts` — `actionCenterFor(session)` gathers six bounded sources (open alerts, stalled orders, overdue receivables, at-risk customers from the health snapshot with a bounded live fallback, stockout risk vs 14-day run-rate, a peer-penetration cross-sell) and ranks them; a driver gets nothing. `kpiSnapshots.ts` — `computeMetric` (one bounded query per metric arm), `refreshSnapshots` (every metric × scope, upserted; the 7 source-attributable metrics also per salesperson), `snapshot`/`snapshotRows`/`newestComputedAt`, `kpiBoard` (**one `kpi_snapshots` read for two periods + `targets` + `kpi_definitions` — never scans `orders`**). `analysisRefresh.ts` — `refreshAll(org, asOf?)`, the sweep entry point (own module so the `kpiSnapshots` ↔ `health` import stays a DAG). |
| API | `GET /api/analysis/kpis` (`kpiBoard`, own-scope for a salesperson), `/why` (manager+, 403 salesperson), `/margin` (manager+, 403 salesperson), `/health` (`?scope=customer|salesperson|driver` [`&id=`]), `/action-center`; `POST /api/analysis/refresh` (owner/group_manager). `proxy.ts`: `/api/analysis/refresh` manager-gated; the read routes gate themselves and the existing driver gate already blocks `/api/analysis` + `/sales/analysis` for a driver. |
| UI | `/sales/analysis` — **Action Center first** (the source: this page matters more than the dashboard), then the KPI strip (value · Δ vs prior · target · ⓘ definition popover · a «چرا؟» button that fetches `/api/analysis/why` and renders the ladder inline), then contribution margin (a dimension toggle; margin % beside revenue; hidden for a salesperson), then a customer-health band summary + the risk list. Freshness line from the newest snapshot `computed_at`. Nav: «تحلیل» tab after «تحلیل و KPI». |
| Tenancy | `kpi_definitions` + `kpi_snapshots` on `TENANT_TABLES`. `twoOrgs` seeds a tenant `kpi_definitions` `net_sales` override + two `kpi_snapshots` rows per org; `tenancy-isolation` asserts snapshots + overrides never cross and the 14 NULL-org defaults stay shared. |

Suite: **green** — `tsc` + `eslint app/ lib/` clean (see the commit CI notes). Real-data check: `foreign_key_check` empty, both tables present, `kpi_snapshots` empty, `kpi_definitions` 14 NULL-org / 0 tenant, `refreshAll(1)` ran clean and wrote a positive `net_sales` org snapshot.

## Deviations from the spec

- **Snapshots are monthly (Jalali `YYYY-MM`) only** — no weekly / rolling-30 grain in v1. A rolling window is a later period-format, not a schema change.
- **`refreshAll` is a function behind `/api/analysis/refresh`, not a cron** — same as Phase 5 `runsNeedingFreeze` / Phase 7 `/api/rules/run`. A scheduler or boot check calls it. The page shows "هنوز محاسبه نشده" when no snapshot exists for the period.
- **`refreshAll` lives in `lib/repo/analysisRefresh.ts`, not `kpiSnapshots.ts`** (the spec put it there) — `health.ts` already imports `kpiSnapshots`, so the orchestrator sits one level up to keep the imports acyclic.
- **The existing `/sales/dashboard` still computes live.** It is the detailed exploration page; the new `/sales/analysis` is the one that honours "raw `orders` is never scanned to render a page" — its only scans are the Action Center's bounded detections. Converting `/sales/dashboard` is follow-on.
- **`whyChain` covers `net_sales` / `gross_profit` / `orders`** (additive metrics) — the «چرا؟» button is shown only on those. A ratio decomposition would need its numerator/denominator split out; deferred.
- **Health weights + Action Center Impact/Urgency mappings are hand-set constants** — like `capacity_factors` and `repHealth`, a Phase 10 learning candidate. `sample_size` on every snapshot is the honesty hook meanwhile.
- **`cross_sell` uses a simple peer-penetration heuristic**, not a model — an opportunity card only, never automated (source's automation table: "system suggests, human decides").
- **No `kpi_definitions` editor UI** — tenant overrides are API-/DB-only; the 14 shipped definitions render read-only in the KPI card's ⓘ popover.

## Pre-deploy checklist (after Phase 10, with the whole branch stack)

1. Fresh backup via the SQLite backup API.
2. `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/analysis-migration-realdata …` — FK check empty, two tables, `kpi_snapshots` empty, 14 NULL-org definitions, `refreshAll` clean.
3. `npm run build` + `systemctl restart coverage-map`.
4. **Wire a scheduler** to `POST /api/analysis/refresh` (hourly or on a post-delivery hook) so the board and Action Center stay warm — until then a manager clicks it, or it runs on first page load being empty is acceptable for a small tenant.

## Next: Phase 10 — Prediction

Per `docs/crm-erp-plan.md` Part 5 row 10: demand forecast, churn scoring, **learned `capacity_factors` from actuals**. Per the user's 2026-09-02 instruction: **estimation for the cold-start year + lightweight incremental learning that works from as little as one week of data**. Branch off `phase-9-analysis`. Pure logic + a small `forecasts` / learned-params table; no external ML service.
