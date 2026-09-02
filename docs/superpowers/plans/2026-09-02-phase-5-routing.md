# Phase 5 — Routing Implementation Plan

> Execute task-by-task, TDD, commit + push each. No review checkpoints.

**Goal:** Vehicles + route templates/schedules; an OSRM+VROOM optimisation pipeline that degrades to a greedy haversine route with zero services; the planner surface; route freeze at cutoff.

**Spec:** `docs/superpowers/specs/2026-09-02-phase-5-routing-design.md`

## Global Constraints

- Money = whole Toman INTEGER. Distances km REAL, durations minutes. Persian UI, English identifiers. Cross-tenant → 404.
- Migrations idempotent, guarded; `delivery_runs.status` CHECK change = a guarded rebuild.
- New DB access via `lib/repo/`. Never commit to `main`. Never build/restart.
- OSRM/VROOM calls: env-gated glue, `null` on failure, not unit-tested. Everything else TDD'd.
- Vitest bg + poll. eslint `app/ lib/` + per-file. After route add: `npx next typegen && rm -rf .next/dev/types`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: `lib/routing/capacity.ts` — capacity math

**Files:** Create `lib/routing/capacity.ts`, `tests/routing-capacity.test.ts`.

- `effectiveCapacity(input)` — multiplicative factors, `max_stops = max(floor(base × Π), ceil(base × 0.4))`, service/duration = base × Π.
- `vehicleFit(vehicle, load)` → `"weight" | "volume" | "stops" | null`; a null limit is "no limit".
- Tests: no factors → identity; two 0.8 stop factors on base 30 → floor(30×0.64)=19; a punishing 0.1 factor floored to 40% (12); `vehicleFit` returns the first binding constraint; a vehicle with all-null limits always fits.
- Commit.

### Task 2: `lib/routing/matrix.ts` + `lib/routing/osrmMatrix.ts`

**Files:** Create `lib/routing/matrix.ts`, `lib/routing/osrmMatrix.ts`, `tests/routing-matrix.test.ts`.

- `haversineMatrix(points)` — symmetric km via `lib/geo.distanceKm`; diagonal 0.
- `durationMatrixFromKm(km, kmh=22)` — seconds.
- `osrmMatrix.ts`: `parseOsrmTable(data)` (pure — OSRM `/table` `{code:"Ok", distances, durations}` → `{distances_km, durations_s}` or null) + `fetchOsrmTable(points, signal?)` (glue, env `OSRM_TABLE_URL`, `null` on failure).
- Tests: `haversineMatrix` of 3 points is symmetric with a 0 diagonal; two points 1° of latitude apart ≈ 111 km ± 1; `durationMatrixFromKm` of 22 km at 22 km/h = 3600 s; `parseOsrmTable` accepts a well-formed table and rejects `{code:"Error"}` / a ragged matrix.
- Commit.

### Task 3: `lib/routing/vroom.ts` — job builder, applier, greedy fallback

**Files:** Create `lib/routing/vroom.ts`, `tests/routing-vroom.test.ts`.

- `buildVroomJob(deliveries, vehicles, matrix)` → a VROOM request (`jobs` with `amount`/`service`/`time_windows`/`priority`/`skills`, `vehicles` with `capacity`/`skills`, `matrices.car.durations` (+`distances`)).
- `applyVroomSolution(response, keyByIndex)` → `{assignments, unassigned}` with cumulative ETA.
- `greedyAssign(deliveries, vehicles, matrix)` → nearest-neighbour from each vehicle's start + a 2-opt pass (`lib/geo.nearestNeighborOrder`/`twoOptOrder`), capacity-checked, overflow → `unassigned`. `{assignments, unassigned}`.
- `solveVroom(job, signal?)` (glue, env `VROOM_URL`, `null`).
- Tests: `buildVroomJob` puts kg + m³×100 + 1 in each job `amount`, and the vehicle `capacity` triple; `applyVroomSolution` turns a 2-route response into two assignments with ordered `delivery_id`s and rising ETA, and carries `unassigned`; `greedyAssign` with one vehicle and 4 deliveries orders them nearest-first from the depot and drops the 5th when `max_stops=4`.
- Commit.

### Task 4: schema — vehicles, route_templates, route_schedules, delivery_runs ALTERs

**Files:** Modify `lib/db.ts`, `tests/tenancy-schema.test.ts`; Create `tests/routing-schema.test.ts`.

- Three tables in the main schema block. `delivery_runs` ALTERs (guarded) + a guarded rebuild adding `'ready'` to the status CHECK (`rebuildDeliveryRunsStatus`, guarded on CHECK text containing `'ready'`). `products.volume_m3_per_base_unit REAL` ALTER (guarded).
- `TENANT_TABLES` += `vehicles`, `route_templates`. exempt set += `route_schedules`.
- Schema test: tables + uniques exist; `delivery_runs` has `vehicle_id`/`optimisation_json`/`frozen_at`/etc; status CHECK accepts `'ready'`, rejects `'foo'`; `vehicles` UNIQUE `(organization_id, plate)` holds per-org, shareable across orgs.
- Full suite — fix `delivery_runs` exact-column schema tests if any.
- Commit.

### Task 5: `lib/repo/routing.ts` — repos + `routableDeliveriesFor` + `buildPlan`/`commitPlan`

**Files:** Create `lib/repo/routing.ts`, `tests/routing-repo.test.ts`.

- `vehiclesRepo`, `routeTemplatesRepo`; `listVehicles`, `createVehicle`, `listRouteTemplates`, `createRouteTemplate`, `templateScheduleFor`.
- `routableDeliveriesFor(orgId, {date, group_id?})` → `RoutableDelivery[]` (delivery_id, customer lat/lng, kg from `SUM(packs_ordered × qty_per_pack × kg_per_base_unit)`, m³ likewise with `volume_m3_per_base_unit`, `service_min` from the template or a flat 8, priority from `orders.priority`).
- `buildPlan(orgId, {date, group_id?, template_id?})` → gather deliveries + active vehicles (or the template default), `fetchOsrmTable` → haversine fallback, `solveVroom` → `greedyAssign` fallback, `{assignments, unassigned, source}`. Read-only.
- `commitPlan(orgId, plan, {date, planned_by})` → per assignment: find-or-create `delivery_runs (driver, date)`, stamp vehicle/template/distances/duration/capacity_stops/optimisation_json, `addStop` each order in order. Idempotent.
- Tests (no services → greedy path): seed 3 confirmed orders on a date with customers at known coords + one vehicle with a driver default; `buildPlan` returns one assignment ordered nearest-first, `source: 'greedy'`; `commitPlan` creates one run with 3 stops and `planned_distance_km > 0`; a re-commit adds no duplicate stops; a 4th order with `max_stops=3` lands in `unassigned`.
- Commit.

### Task 6: `freezeRun` + `addStop` force-gate + `runsNeedingFreeze`

**Files:** Modify `lib/delivery.ts` (`addStop` gains `force?`), `lib/repo/routing.ts`; Create `tests/routing-freeze.test.ts`.

- `freezeRun(orgId, runId, actor)` — `frozen_at = now`, `status = 'ready'`, `markReady` every order on the run.
- `addStop(db, runId, orderId, sortOrder, opts?: {force?: boolean})` — if the run's `frozen_at` is set and `!opts.force` → `DeliveryError`; a forced add writes an `order_events` note («افزوده به مسیر قطعی‌شده»).
- `runsNeedingFreeze(orgId, asOfIso)` — planned runs whose today's `route_schedules.cutoff_time` has passed and `frozen_at IS NULL`.
- Tests: `freezeRun` sets `frozen_at` + moves every order to `READY`; `addStop` on a frozen run throws, `addStop(..., {force:true})` succeeds and writes an event; `runsNeedingFreeze` returns a past-cutoff unfrozen run and skips a frozen one and a future-cutoff one.
- Commit.

### Task 7: API routes

**Files:** Create `app/api/sales/vehicles/route.ts`, `app/api/sales/route-templates/route.ts`, `app/api/sales/routing/plan/route.ts`, `app/api/sales/routing/commit/route.ts`, `app/api/sales/runs/[id]/freeze/route.ts`; Modify `proxy.ts`; Create `tests/api/routing-route.test.ts`.

- CRUD + `plan` (read-only proposal) + `commit` + `freeze`. owner/group_manager. `proxy.ts` gate.
- `npx next typegen && rm -rf .next/dev/types`.
- Tests: POST a vehicle → 201; `plan` for a seeded date → 200 with `assignments`; `commit` → runs created; `freeze` → 200 and the run's `frozen_at` set; a salesperson → 403.
- Commit.

### Task 8: UI — `/sales/routing`

**Files:** Create `app/sales/routing/page.tsx`, `components/sales/RoutingPlanner.tsx`; Modify `app/sales/layout.tsx`.

- date picker, «ساخت پیشنهاد», per-run cards (driver / vehicle / stops / km / min / capacity), `unassigned` list, «تثبیت», per-run «قطعی‌کردن», `source: 'greedy'` note. Reuse `PlannerRouteMap` if straightforward, else a plain list.
- nav tab «مسیریابی» (owner/manager).
- `tsc` + `eslint` clean (Fragment key / set-state-in-effect disable as in prior panels).
- Commit.

### Task 9: tenancy, real-data check, handoff

**Files:** Modify `tests/helpers/twoOrgs.ts`, `tests/tenancy-isolation.test.ts`, `docs/crm-erp-plan.md`; Create `tests/routing-migration-realdata.test.ts`, `docs/HANDOFF-2026-09-02-phase-5-routing.md`; update memory.

- `twoOrgs`: `OrgFixture` += `vehicleId`; seed a `vehicles` (`SHARED-PLATE`) + a `route_templates` per org.
- `tenancy-isolation`: new `it` — no `vehicles` / `route_templates` leak; both orgs hold `SHARED-PLATE`.
- Real-data test per spec §7. Run against the backup copy.
- Full suite green, `tsc`, `eslint app/ lib/`.
- `docs/crm-erp-plan.md` Part 5 row 5 → ✅ DONE. Handoff. Memory.
- Commit.
