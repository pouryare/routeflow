# Phase 9 — Analysis Implementation Plan

> Execute task-by-task, TDD, commit + push each. No review checkpoints.

**Goal:** Precomputed KPI snapshots, contribution margin per dimension, health scores, the "Why?" drill-down, and the Action Center — all pure logic over the frozen order lines, read from a table on the page.

**Architecture:** `lib/analysis/*` = pure functions (metrics vocabulary, margin roll-up, health composites, delta decomposition, priority ranking). `lib/repo/*` = the data-assembly + the snapshot read/write. A sweep (`refreshAll`) materialises; `/sales/analysis` reads snapshots + one bounded Action-Center pass.

**Spec:** `docs/superpowers/specs/2026-09-02-phase-9-analysis-design.md`

## Global Constraints

- Persian UI, English identifiers. Cross-tenant → 404/empty. Migrations idempotent, guarded, no rebuild (both tables are new `CREATE TABLE IF NOT EXISTS`).
- New DB access via `lib/repo/`. `tests/repo-boundary.test.ts` blocks raw SQL in new `app/`/`lib/` files not in `lib/repo/` — all queries live in `lib/repo/`, `lib/analysis/*` stays pure (no `db` import).
- Money = whole Toman INTEGER; quantities = REAL base units. Revenue on **delivered** quantities (`lineTotalToman`/`lineCostToman`/`lineKg`), status ∈ `FULFILLED_ORDER_STATUSES`. Jalali month key via `jalaliMonthKey` (`lib/dashboard.ts`).
- Margin/cost is manager+ only — `marginBy` and `whyChain` refuse a `salesperson` session; routes enforce too.
- Never commit to `main` / build / restart. Vitest + tsc as background commands, poll the log. eslint `app/ lib/` + per-file. After a route add: `npx next typegen && rm -rf .next/dev/types`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Push each task.

---

### Task 1: schema — `kpi_definitions` + `kpi_snapshots` + seed

**Files:** Modify `lib/db.ts`, `tests/tenancy-schema.test.ts`; Create `tests/analysis-schema.test.ts`.

- Both tables in the main schema block after `lesson_progress`, exactly per spec §1. `kpi_snapshots.scope_id INTEGER NOT NULL DEFAULT 0`. Index `ix_kpi_snapshots_read`.
- `seedKpiDefinitions(db)` next to `seedObjectionCards` — a `KPI_DEFINITION_SEED` array of 14 NULL-org rows (the METRICS list, each with `title_fa`/`definition_fa`/`formula_fa`/`owner_role`/`benchmark_fa`/`frequency`/`action_fa`/`tier`/`direction`), `INSERT INTO kpi_definitions (...) SELECT NULL, ... WHERE NOT EXISTS (SELECT 1 FROM kpi_definitions WHERE organization_id IS NULL AND metric = ?)` per row. Call it from `getDb()` where `seedObjectionCards` is called.
- `TENANT_TABLES` += `kpi_definitions`, `kpi_snapshots`. Both NULL-org sweeps in `getDb()` (`UPDATE … WHERE organization_id IS NULL`): add `kpi_definitions` to the `continue` list at both sites (~lines 2123, 2635).
- `tests/tenancy-schema.test.ts` "leaves no row without an organisation": add `kpi_definitions` to the skip set.
- `tests/analysis-schema.test.ts`: both tables + indexes exist; `kpi_snapshots` UNIQUE `(organization_id, metric, scope_type, scope_id, period)` bites (insert two identical → throw); `scope_id` defaults to 0; after boot `SELECT COUNT(*) FROM kpi_definitions WHERE organization_id IS NULL` === 14, `… IS NOT NULL` === 0; the `scope_type` CHECK rejects `'foo'`; the `direction` CHECK rejects `'sideways'`.
- Run `tests/analysis-schema.test.ts` → fail; implement; pass. Full suite — fix any `tenancy-schema` fallout. Commit + push.

### Task 2: `lib/analysis/metrics.ts` — the vocabulary (pure)

**Files:** Create `lib/analysis/metrics.ts`, `tests/analysis-metrics.test.ts`.

- `METRICS` (14, per spec §2), `Metric`, `RATIO_METRICS`, `METRIC_DIRECTION` (`overdue_receivables` + `lost_customers` → `"down"`, rest `"up"`), `isRatio`, `formatMetric(m, v)` (toman → `faToman`-style plain number; ratio → `«{round(v*100)}٪»`; count → integer). Data Dictionary constants: `ACTIVE_WINDOW_DAYS=60`, `REPEAT_MIN_ORDERS=2`, `SAMPLE_CONVERT_DAYS=30`, `ON_TIME_GRACE_DAYS=0`.
- Tests: `METRICS.length===14`, no dupes; every `RATIO_METRICS` member is in `METRICS`; `isRatio('gross_margin')` true, `isRatio('net_sales')` false; `METRIC_DIRECTION` has a key for every metric; `formatMetric('gross_margin', 0.234)` === `'۲۳٪'` (via the app's digit helper), `formatMetric('orders', 12)` === `'۱۲'`.
- No `db` import (a pure module). Fail → implement → pass. Commit + push.

### Task 3: contribution margin — `lib/analysis/margin.ts` (pure) + `lib/repo/margin.ts`

**Files:** Create `lib/analysis/margin.ts`, `lib/repo/margin.ts`, `tests/analysis-margin.test.ts`, `tests/margin-repo.test.ts`.

- Pure `margin.ts`: `MarginLine`, `Keyed`, `MarginRow`, `marginPct(rev, cost)` (0 when `rev<=0`), `rollUp(lines)` — group by `key`, sum revenue/cost/kg, derive `margin_toman`/`margin_pct`/`share_pct` (of total margin; 0 when total is 0), sort by `margin_toman` desc.
- Pure tests: `rollUp` of two lines same key merges; `marginPct(1000, 750)` === `0.25`; `marginPct(0, 0)` === `0`; a negative-margin row keeps a negative `margin_toman` and sorts last; `share_pct` sums to ~1 across positive rows.
- `lib/repo/margin.ts`: `marginBy(orgId, dimension, period, session)` — one query `order_lines` JOIN `orders` (JOIN `customers`/`products`/`users`/`representative_profiles` as the dimension needs), `WHERE o.status IN (FULFILLED)` + `orderFilter(session)`, filtered to the period in JS via `jalaliMonthKey(o.order_date) === period`; map to `Keyed` with `lineTotalToman`/`lineCostToman`/`lineKg`; `rollUp`. Throws if `session.role === 'salesperson'`. `materialiseMargin(orgId, period)` — writes `net_sales`/`gross_profit`/`gross_margin` snapshots for `org` + each `group` + each `salesperson` (uses an internal `system` session-like scope = whole org).
- Repo tests: seed 2 customers, 2 products, delivered orders in a known Jalali month with distinct unit_price/unit_cost; `marginBy(org,'customer',period,ownerSession)` → rows sorted by margin, `margin_pct` matches hand-calc; `marginBy(...,'product',...)`; a `salesperson` session throws; `materialiseMargin` then `SELECT` from `kpi_snapshots` shows a `gross_margin` org row equal to total margin / total revenue.
- Commit + push.

### Task 4: health composites — `lib/analysis/health.ts` (pure)

**Files:** Create `lib/analysis/health.ts`, `tests/analysis-health.test.ts`.

- `Band`, `band(score)` (good≥70 / watch≥40 / risk), `customerHealth`, `salespersonScore`, `driverScore` exactly per spec §4 (weights + reason strings). Each returns `{ score: 0–100 rounded, band, reasons: string[] }`; `reasons` lists only the factors scoring below their midpoint, Persian, most-severe first.
- Tests, one per composite, covering: a perfect input → score ≥ 90, band `good`, `reasons` empty; a clear-risk input → band `risk`, `reasons` names the right factor first; `customerHealth` with `days_since_last_order: null` (never ordered) → cadence factor 0, reason «هرگز سفارشی ثبت نکرده»; `days_since = 3× mean_interval` → cadence 0; `orders_prev_q: 0` guarded (no divide-by-zero, trend treated as flat-or-better); `salespersonScore` with `assigned_customers: 0` guarded; `driverScore` with `stops_per_hour: null` drops that factor and re-normalises the weights.
- No `db` import. Fail → implement → pass. Commit + push.

### Task 5: `lib/repo/health.ts`

**Files:** Create `lib/repo/health.ts`, `tests/health-repo.test.ts`.

- `customerHealthFor(orgId, customerId)`, `customersHealthOverview(session)` (one row per in-scope customer: `{ customer_id, business_name, score, band, reasons }`), `salespersonScoreFor(orgId, userId, period)`, `driverScoreFor(orgId, userId, period)` — assemble the §4 pure inputs from `orders` (cadence + trend + delivery timing), `customerDebt`/`customerDebtsForOrg` (`lib/repo/payments`), `quality_complaints`, Phase-7 `targetProgress` (`lib/repo/targets`). `materialiseHealth(orgId, period)` writes `health_score`-metric snapshots at `customer`/`salesperson`/`driver` scope.
- Tests: a customer with a steady 14-day cadence, last order 10 days ago, no debt, no complaints, 20% margin → band `good`; a customer with last order 90 days ago (mean 20) + `bucket_30_plus` debt → band `risk`, reasons name cadence + payment; `customersHealthOverview` for a manager session returns only their group's customers; `materialiseHealth` writes rows readable by `snapshot(orgId,'health_score',{scope_type:'customer',scope_id})`.
- Commit + push.

### Task 6: the "Why?" drill-down — `lib/analysis/why.ts` (pure) + `lib/repo/why.ts`

**Files:** Create `lib/analysis/why.ts`, `lib/repo/why.ts`, `tests/analysis-why.test.ts`, `tests/why-repo.test.ts`.

- Pure `why.ts`: `Contribution`, `DeltaExplanation`, `explainDelta(before, after)` — union of keys, per-key `delta = after−before`, `share = delta / (Σafter − Σbefore)` (0 when total delta 0), `contributions` sorted by `|delta|` desc, `headline` names `contributions[0]` («بیشترین {افت|رشد} از «{label}»»); `total_before`/`total_after`/`delta`/`pct` (`delta/total_before`, 0 when `total_before` 0).
- Pure tests: `{a:100,b:50}` → `{a:120,b:20}` → total delta −10, `a` +20 share −2.0, `b` −30 share 3.0, sorted `b` first (|−30|), headline names «b» as the drop; a key present only in `after` counts its full value as delta; total-delta-0 case → all `share` 0, `pct` 0.
- `lib/repo/why.ts`: `whyChain(session, metric, periodA, periodB)` → `DeltaExplanation[]` — rung 1 by `group`, rung 2 by `salesperson` within the largest-|delta| group, rung 3 by funnel stage (first-reach `order_events.to_status` counts per period). Each rung reuses one two-period line/order scan bounded by the Jalali windows + `orderFilter`. Refuses a `salesperson` session.
- Repo tests: seed two groups, revenue down only in group B between two months → `whyChain(owner,'net_sales',mA,mB)[0].contributions[0].key` is group B; rung 2 present; rung 3 headline mentions a stage; a `salesperson` session throws.
- Commit + push.

### Task 7: the Action Center — `lib/analysis/actionCenter.ts` (pure) + `lib/repo/actionCenter.ts`

**Files:** Create `lib/analysis/actionCenter.ts`, `lib/repo/actionCenter.ts`, `tests/analysis-action-center.test.ts`, `tests/action-center-repo.test.ts`.

- Pure `actionCenter.ts`: `Bucket`, `Candidate`, `RankedItem`, `priorityScore(i,p,u)` (clamp each to [0,1], return product), `rankActionCenter(cands, capPerBucket=12)` → `{critical,warning,opportunity}` each sorted by `priority` desc, sliced to the cap.
- Pure tests: `priorityScore(2, 0.5, 1)` clamps to `1*0.5*1 = 0.5`; `rankActionCenter` splits by bucket, orders within bucket, respects the cap; empty input → three empty arrays.
- `lib/repo/actionCenter.ts`: `actionCenterFor(session)` → `{critical,warning,opportunity}` — gather candidates from the six sources in spec §6 (open `alerts`; `stalled_order` via `order_events` max-age; `at_risk_customer` via `customerHealthFor`; `stockout_risk` via `availableToPromise` vs 14-day run-rate; `overdue_receivable` via `customerDebt`; `cross_sell` peer-penetration heuristic), each a bounded query, then `rankActionCenter`. Everything `orderFilter`/`groupFilter`-scoped.
- Repo tests: an open critical `alert` → appears in `critical`; a `CONFIRMED` order with a 4-day-old last event → a `stalled_order` warning; a customer with `bucket_30_plus` above the critical floor → `overdue_receivable` critical; a driver session gets nothing (route/proxy gates, but assert the repo scopes too); cap respected when many candidates.
- Commit + push.

### Task 8: snapshot refresh — `lib/repo/kpiSnapshots.ts`

**Files:** Create `lib/repo/kpiSnapshots.ts`, `tests/kpi-snapshots-repo.test.ts`.

- `computeMetric(orgId, metric, scope, period)` → `{value, numerator?, denominator?, sample_size}` — `switch(metric)`, one bounded query per arm, Data Dictionary constants from Task 2. `scope` = `{scope_type, scope_id}`.
- `refreshSnapshots(orgId, period)` → `{written}` — every metric × applicable scope (`org`; per `group`; per `salesperson` for `net_sales`/`gross_profit`/`orders`/`aov`/`active_customers`/`new_customers`/`sample_conversion`), UPSERT into `kpi_snapshots`. Idempotent.
- `snapshot(orgId, metric, {scope_type='org', scope_id=0, period})` → `number | null`.
- `kpiBoard(orgId, period, prevPeriod, session)` → `KpiCard[]` — one `kpi_snapshots` query for the two periods (scoped: an owner sees `org`, a manager sees their `group` row, a salesperson sees their `salesperson` row), one `targets` lookup, join `kpi_definitions` (tenant ∪ NULL-org). `KpiCard = {metric,title_fa,value,prev_value,target,direction,definition_fa,action_fa,delta_pct,on_track}`. **No `orders` scan.**
- `refreshAll(orgId, asOfIso?)` — `refreshSnapshots(current)` + `refreshSnapshots(prior)` + `materialiseMargin(current)` + `materialiseHealth(current)`.
- Tests: seed a known month of delivered orders; `refreshSnapshots(org, period)` writes a positive `written`; `snapshot(org,'net_sales',{period})` equals the hand-summed delivered revenue; `computeMetric` for `gross_margin` returns `value` in [0,1] with `numerator`/`denominator` set; `active_customers` respects the 60-day window (a customer whose last order is 70 days before period-end is excluded); re-running `refreshSnapshots` does not duplicate rows (UNIQUE + upsert); `kpiBoard` returns one card per metric with `prev_value` from the prior period and never runs a query on `orders` (assert via a spy or by row-count invariance after deleting all orders post-refresh).
- Commit + push.

### Task 9: API routes — `/api/analysis/*`

**Files:** Create `app/api/analysis/kpis/route.ts`, `app/api/analysis/why/route.ts`, `app/api/analysis/margin/route.ts`, `app/api/analysis/health/route.ts`, `app/api/analysis/action-center/route.ts`, `app/api/analysis/refresh/route.ts`; Modify `proxy.ts`; Create `tests/api/analysis-route.test.ts`.

- Each route: `getSession` → 401; `dynamic = "force-dynamic"`. `kpis` GET `?period=` (default current Jalali month) → `kpiBoard`. `why` GET `?metric=&from=&to=` → `whyChain`, 403 for `salesperson`. `margin` GET `?dimension=&period=` → `marginBy`, 403 for `salesperson`. `health` GET `?scope=&id?=` → overview or one. `action-center` GET → `actionCenterFor`. `refresh` POST → `requireRole(owner|group_manager)` → `refreshAll(orgId)` → `{written}`.
- `proxy.ts`: `/sales/analysis` + `/api/analysis` → non-driver authenticated (add to the same check `/sales/dashboard` uses); `/api/analysis/refresh` manager-gated (extend the `/api/targets`/`/api/rules` manager check).
- Tests: `cookie(ownerId)` → `kpis` 200 with a cards array; `cookie(salespersonId)` → `margin` 403, `why` 403, `kpis` 200 (own-scope card set); `refresh` POST as owner → 200 `{written>0}`, as salesperson → 403; `action-center` as a manager → 200 buckets. Real salesperson/manager users created in DB (`requireRole` reads `users.role`).
- `npx next typegen && rm -rf .next/dev/types`. Commit + push.

### Task 10: UI — `/sales/analysis` + components + nav

**Files:** Create `app/sales/analysis/page.tsx`, `components/analysis/ActionCenter.tsx`, `components/analysis/KpiStrip.tsx`, `components/analysis/WhyDrilldown.tsx`, `components/analysis/MarginTable.tsx`; Modify `app/sales/layout.tsx`.

- Page (server component, `force-dynamic`): session gate (redirect driver → `/driver`); read `kpiBoard` + `actionCenterFor` server-side; render Action Center → KPI strip → Margin (owner/manager only) → Health band summary, in that order (spec §9). Freshness line from the newest snapshot `computed_at`; a stale banner when it is older than the metric frequency.
- `ActionCenter.tsx` — three columns 🔴/🟠/🟢, ranked cards (title, sub, link). `KpiStrip.tsx` — cards with value, delta vs prior, a bullet vs `target`, an info popover with `definition_fa`/`action_fa`, and a «چرا؟» button on `RATIO_METRICS` + `net_sales`/`orders` that fetches `/api/analysis/why` and shows `WhyDrilldown` inline (breadcrumb of rungs → headline). `MarginTable.tsx` — dimension toggle, table sorted by margin, margin% beside revenue, negative margin in the crit tone.
- `app/sales/layout.tsx`: add `{ href: "/sales/analysis", label: "تحلیل", ready: true }` after «داشبورد» / «تحلیل و KPI» (keep the existing «تحلیل و KPI» → `/sales/dashboard`; the new one is «تحلیل»). Salesperson sees the tab (page self-limits: no margin section, own-scope KPIs).
- Manual check: `npx next typegen`; tsc; eslint the new files. Commit + push.

### Task 11: tenancy, real-data check, handoff

**Files:** Modify `tests/helpers/twoOrgs.ts`, `tests/tenancy-isolation.test.ts`, `docs/crm-erp-plan.md`; Create `tests/analysis-migration-realdata.test.ts`, `docs/HANDOFF-2026-09-02-phase-9-analysis.md`; Modify the memory file.

- `twoOrgs`: `OrgFixture` += `kpiSnapshotId`; `build()` seeds one tenant `kpi_definitions` override (`metric='net_sales'`, renamed `title_fa`) + a couple of `kpi_snapshots` rows per org (`net_sales` org-scope + a `group`-scope row).
- `tests/tenancy-isolation.test.ts`: a new `it(...)` — tenant snapshots + definition overrides never cross; `SELECT COUNT(*) FROM kpi_definitions WHERE organization_id IS NULL` === 14; each org's `kpi_snapshots` rows carry only its own `organization_id`.
- `tests/analysis-migration-realdata.test.ts` (env-gated on the newest `data/backups/*.db`): `foreign_key_check` empty; both tables present; `kpi_snapshots` empty; `kpi_definitions` 14 NULL-org / 0 tenant; `refreshAll(1)` runs clean and writes a positive `net_sales` org snapshot.
- Full suite + `tsc` + `eslint app/ lib/` green. `docs/crm-erp-plan.md` Part 5 row 9 → `**9. Analysis — ✅ DONE** (branch \`phase-9-analysis\`, 2026-09-02, unmerged) | …`.
- Handoff doc (what shipped table, deviations from spec §12, pre-deploy checklist, next = Phase 10). Memory `routeflow-phase-progress.md`: add the Phase 9 bullet, roll the "next up" line to Phase 10.
- Commit + push.

---

## Self-review

- **Spec coverage:** §1 schema → T1; §2 metrics → T2; §3 margin → T3; §4 health pure → T4; §4 health repo → T5; §5 why → T6; §6 Action Center → T7; §7 snapshots → T8; §8 API → T9; §9 UI → T10; §10 tenancy + §11 migration → T11. §12 deviations → recorded in the handoff.
- **Type consistency:** `MarginRow` (T3) consumed by T10 `MarginTable`; `KpiCard` (T8) by T9/T10; `DeltaExplanation` (T6) by T9/T10; `RankedItem` buckets (T7) by T9/T10; `Band` (T4) by T5. `Metric` (T2) is the `metric` column value everywhere.
- **No placeholders:** every task names its files, its pure-vs-repo split, and concrete test assertions.
- **Scope:** one plan, one branch — snapshots + five read features on one page. No decomposition needed.
