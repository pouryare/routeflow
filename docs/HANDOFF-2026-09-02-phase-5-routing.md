# RouteFlow Phase 5 (Routing — M7) — Handoff

**Date:** 2026-09-02 · **Branch:** `phase-5-routing` (off `phase-4-offline-first`) · **Status:** code-complete, unmerged.

Spec: `docs/superpowers/specs/2026-09-02-phase-5-routing-design.md` · Plan: `docs/superpowers/plans/2026-09-02-phase-5-routing.md` (9 tasks, done).

## What shipped

| Area | Detail |
|---|---|
| `lib/routing/capacity.ts` | `effectiveCapacity` (multiplicative factors, `max_stops` floored at 40% of base), `vehicleFit` (first binding constraint), `vehicleLimitFactor`. Pure. The seam Phase 6 plugs its six weather conditions into. |
| `lib/routing/matrix.ts` | `haversineMatrix` (always-available km matrix), `durationMatrixFromKm` (flat 22 km/h). Pure. |
| `lib/routing/osrmMatrix.ts` | `parseOsrmTable` (pure, tested — OSRM `/table` `{code:"Ok", durations, distances}` → km/s or null) + `fetchOsrmTable` (glue, env `OSRM_TABLE_URL`, null on any failure). |
| `lib/routing/vroom.ts` | `buildVroomJob` (jobs `amount:[kg, m³×100, 1]` + `service`/`priority`/`time_windows`/`skills`; vehicles `capacity` triple + `skills`; matrix indices), `applyVroomSolution` (response → ordered assignments + cumulative ETA + `unassigned`), `greedyAssign` (the pure fallback — nearest-neighbour + 2-opt + capacity, overflow → `unassigned`), `solveVroom` (glue, env `VROOM_URL`, null). |
| Schema | `vehicles` (`plate`, limits, `has_refrigeration` skill, `cost_per_km_toman`; `UNIQUE (organization_id, plate)`), `route_templates` (`territory_id`, defaults, capacity ceilings, `service_time_min`), `route_schedules` (`day_of_week`, `cutoff_time`). `delivery_runs` += `vehicle_id`/`route_template_id`/`planned+actual_distance_km`/`planned+actual_duration_min`/`capacity_stops`/`weather_json`/`optimisation_json`/`frozen_at` (plain ADD COLUMN) and a `'ready'` status (`rebuildDeliveryRunsStatus` — reads the live CREATE, rewrites just the CHECK, copies every column). `products.volume_m3_per_base_unit`. `vehicles` + `route_templates` on `TENANT_TABLES`; `route_schedules` exempt. |
| `lib/repo/routing.ts` | `vehiclesRepo` / `routeTemplatesRepo` + CRUD; `routableDeliveriesFor` (PLANNED deliveries on a date, kg/m³ load, priority weight); `buildPlan` (OSRM matrix → haversine fallback, VROOM → greedy fallback, **read-only**, `source: 'vroom' | 'greedy'`); `commitPlan` (one `delivery_runs` per vehicle+driver, stamps distances/duration/capacity/`optimisation_json`, `addStop` each order in order, idempotent); `runsNeedingFreeze` (past-cutoff unfrozen runs); `freezeRun` (`frozen_at` + `status='ready'` + `markReady` every order). |
| `addStop` | Gains `opts.force`. A frozen `delivery_runs` row refuses a plain add («مسیر قطعی شده — افزودن سفارش نیاز به تصمیم صریح دارد»); a forced add writes an `order_events` note. |
| API | `/api/sales/vehicles` (GET/POST), `/api/sales/route-templates` (GET/POST), `/api/sales/routing/plan` (POST, read-only proposal), `/api/sales/routing/commit` (POST), `/api/sales/runs/[id]/freeze` (POST). owner/group_manager; `proxy.ts` gates `/sales/routing`, `/api/sales/routing`, `/api/sales/vehicles`, `/api/sales/route-templates`, `/api/sales/runs/`. |
| UI | `/sales/routing` + `RoutingPlanner` (date, «ساخت پیشنهاد» → per-run cards: vehicle / stops / km / min / per-stop ETA; «تثبیت»; per-run «قطعی‌کردن»; a «بدون بهینه‌ساز — مسیر تقریبی» note when `source='greedy'`; an `unassigned` count). «مسیریابی» nav tab. |
| Tenancy | `twoOrgs` seeds a `vehicles` (`SHARED-PLATE`) + a `route_templates` per org; `tenancy-isolation` asserts no leak and the per-tenant plate `UNIQUE`. |

Suite: 155 files / 1416 tests green (+1 skipped). `tsc` + `eslint app/ lib/` clean. Real-data check passed against the pre-tenancy backup: FK check clean, `delivery_runs` gained the columns + `'ready'`, row count unchanged, the new tables empty.

## Deviations from the plan

- **OSRM + VROOM are Docker services that do not exist here.** They are env-gated glue (`OSRM_TABLE_URL`, `VROOM_URL`), `null` on any failure. The whole pipeline degrades: no OSRM → a haversine + flat-speed matrix; no VROOM → `greedyAssign` (nearest-neighbour + 2-opt + capacity). The planner works and proposes a route with zero services; it labels the result `source: 'greedy'`. Deploying the two containers and setting the two env vars is a pre-deploy step, not a code change.
- **`products.volume_m3_per_base_unit`** — new nullable column, 0 when unset; volume is a soft constraint until real figures are entered.
- **No drag-to-reassign in the planner UI** — propose / commit / re-plan only. A wrong assignment is fixed by moving a stop on the existing runs screen or re-running the plan.
- **Auto-freeze at cutoff is `runsNeedingFreeze` + a manual button** — a running sweep belongs to Phase 7's task spine; the query and the freeze action ship here.
- **`delivery_runs.status` rebuild reads the live CREATE** rather than a hard-coded `createSql`, because by the time it runs the table has ten Phase-5 columns; it rewrites only the CHECK list and copies every column via `PRAGMA table_info`.

## Pre-deploy checklist (after Phase 10, with the whole branch stack)

1. Fresh backup via the SQLite backup API.
2. `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/routing-migration-realdata …` — FK check empty, `delivery_runs` columns + `'ready'` present, row count unchanged.
3. Stand up OSRM + VROOM containers against a Tehran OSM extract; set `OSRM_TABLE_URL` + `VROOM_URL`. Verify a `/api/sales/routing/plan` call returns `source: 'vroom'`.
4. `npm run build` + `systemctl restart routeflow`.
5. Enter real `vehicles` rows (plate, weight/volume/stop limits, `has_refrigeration`) and at least one `route_templates` + `route_schedules` with a `cutoff_time`.

## Next: Phase 6 — Weather

Per `docs/crm-erp-plan.md` §4.1: Open-Meteo (keyless) + `weather_snapshots`, `capacity_factors` (the six conditions, tunable), the forecast frozen into `delivery_runs.weather_json` at planning time, a map layer, a planner weather band. `capacity_factors` feeds `effectiveCapacity` (Phase 5) directly. Open-Meteo is a public keyless API — the client is glue but can actually be exercised; the snapshot table and the factor composition are TDD'd. Branch off `phase-5-routing`.
