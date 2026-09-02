# RouteFlow Phase 5 — Routing (M7) — Design

**Date:** 2026-09-02 · **Branch:** `phase-5-routing` (off `phase-4-offline-first`) · **Status:** design.

Implements `docs/crm-erp-plan.md` Part 5 row 5 and §4.2: M7 vehicles / route templates / schedules, an OSRM + VROOM optimisation pipeline, the planner surface, and route freeze at the schedule cutoff.

**Environment note.** OSRM and VROOM are self-hosted Docker services that do not exist in this environment. So this phase splits cleanly: the **schema, the capacity math, the VROOM job-builder, the response-applier and the freeze logic are pure and TDD'd**; the two HTTP calls (an OSRM `/table` matrix, a VROOM solve) are thin glue in `lib/routing/osrmMatrix.ts` and `lib/routing/vroom.ts`, guarded on env vars, returning `null` when unreachable exactly as `lib/osrm.ts` already does. A `null` matrix falls back to the straight-line (haversine) matrix `lib/geo.ts` already provides, so the planner still proposes a route — just a less optimal one — with no services running.

---

## 1. Schema

```sql
CREATE TABLE vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  plate TEXT,
  name TEXT NOT NULL,
  driver_default_id INTEGER REFERENCES users(id),
  max_weight_kg REAL,
  max_volume_m3 REAL,
  max_stops INTEGER,
  has_refrigeration INTEGER NOT NULL DEFAULT 0,
  cost_per_km_toman INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, plate)
);

CREATE TABLE route_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  territory_id INTEGER REFERENCES districts(id),
  default_driver_id INTEGER REFERENCES users(id),
  default_vehicle_id INTEGER REFERENCES vehicles(id),
  max_stops INTEGER,
  max_weight_kg REAL,
  max_volume_m3 REAL,
  max_duration_min INTEGER,
  service_time_min INTEGER NOT NULL DEFAULT 8,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, code)
);

CREATE TABLE route_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  route_template_id INTEGER NOT NULL REFERENCES route_templates(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,         -- 0 = شنبه … 6 = جمعه
  start_time TEXT,                      -- 'HH:MM'
  end_time TEXT,
  cutoff_time TEXT,                     -- after this, an add needs an explicit decision
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (route_template_id, day_of_week)
);

-- delivery_runs gains the planning + optimisation record (all plain ADD COLUMN):
ALTER TABLE delivery_runs ADD COLUMN vehicle_id INTEGER REFERENCES vehicles(id);
ALTER TABLE delivery_runs ADD COLUMN route_template_id INTEGER REFERENCES route_templates(id);
ALTER TABLE delivery_runs ADD COLUMN planned_distance_km REAL;
ALTER TABLE delivery_runs ADD COLUMN actual_distance_km REAL;
ALTER TABLE delivery_runs ADD COLUMN planned_duration_min INTEGER;
ALTER TABLE delivery_runs ADD COLUMN actual_duration_min INTEGER;
ALTER TABLE delivery_runs ADD COLUMN capacity_stops INTEGER;        -- effective, after adjustment
ALTER TABLE delivery_runs ADD COLUMN weather_json TEXT;             -- Phase 6 fills this; NULL here
ALTER TABLE delivery_runs ADD COLUMN optimisation_json TEXT;        -- the VROOM request+response
ALTER TABLE delivery_runs ADD COLUMN frozen_at TEXT;                -- set at cutoff / by the planner
```

`delivery_runs.status` gains `'ready'` between `planned` and `in_progress` (a rebuild — the CHECK changes). `frozen_at != NULL` ⇔ `status IN ('ready','in_progress','done')`.

`TENANT_TABLES` += `vehicles`, `route_templates`. `route_schedules` → exempt (through `route_templates`).

---

## 2. Capacity math — `lib/routing/capacity.ts` (pure, tested)

```ts
export interface CapacityInput {
  base_stops: number;
  base_service_min: number;
  base_duration_min: number;
  /** Multiplicative factors, e.g. weather (Phase 6) or a vehicle limit ratio. */
  factors: { stop?: number; service?: number; speed?: number; duration?: number }[];
}
export interface EffectiveCapacity {
  max_stops: number;          // floor(base × Π stop), min 40% of base
  service_min: number;        // base × Π service
  max_duration_min: number;   // base × Π duration
}
export function effectiveCapacity(input: CapacityInput): EffectiveCapacity;

/** Given a set of deliveries (kg, m³) and a vehicle, does it fit? Returns the binding
 *  constraint, or null if it fits. */
export function vehicleFit(
  vehicle: { max_weight_kg?: number | null; max_volume_m3?: number | null; max_stops?: number | null },
  load: { total_kg: number; total_m3: number; stop_count: number }
): "weight" | "volume" | "stops" | null;
```

Factors compose multiplicatively and the stop count is floored so a bad day *reduces* rather than *cancels*: `effective_max_stops = max(floor(base × Πfactor), ceil(base × 0.4))`. This is the seam Phase 6 plugs weather factors into — Phase 5 uses it only for the vehicle-limit ratio and a plain `1.0` otherwise.

---

## 3. The VROOM pipeline

### 3.1 `lib/routing/matrix.ts` (pure, tested) + `lib/routing/osrmMatrix.ts` (glue)

- `haversineMatrix(points: LatLng[]): number[][]` — a symmetric km matrix from `lib/geo.distanceKm`. Always available.
- `durationMatrixFromKm(km: number[][], kmh = 22): number[][]` — seconds, a flat city speed. The fallback when OSRM is down.
- `osrmMatrix.ts`: `fetchOsrmTable(points, signal?)` → `{ distances_km, durations_s } | null`. `OSRM_TABLE_URL` env (default the same public host `lib/osrm.ts` uses); `null` on any failure. Not unit-tested; `parseOsrmTable(data)` — the shape check — is.

### 3.2 `lib/routing/vroom.ts` — job builder + applier (pure, tested) + solve (glue)

```ts
export interface RoutableDelivery {
  delivery_id: number;
  lat: number; lng: number;
  weight_kg: number; volume_m3: number;
  service_min: number;
  time_window?: [string, string];    // 'HH:MM'
  priority?: number;                 // URGENT > KEY_ACCOUNT > NORMAL > FLEXIBLE
}
export interface RoutableVehicle {
  vehicle_key: number;               // vehicle_id, or a synthetic driver-only id
  start: LatLng; end: LatLng;        // the warehouse
  capacity: [number, number, number]; // [kg, m³×100, stops]  (VROOM wants integers)
  max_duration_s?: number;
  skills?: number[];                 // 1 = refrigerated
}
export function buildVroomJob(
  deliveries: RoutableDelivery[],
  vehicles: RoutableVehicle[],
  matrix: { durations: number[][]; distances?: number[][] }
): VroomRequest;

export interface Assignment {
  vehicle_key: number;
  stops: { delivery_id: number; sort_order: number; eta_min: number }[];
  distance_km: number;
  duration_min: number;
}
export interface SolveResult {
  assignments: Assignment[];
  unassigned: number[];              // delivery_ids VROOM could not place
}
export function applyVroomSolution(response: VroomResponse, keyByIndex: Map<number, number>): SolveResult;
```

- `buildVroomJob` — deliveries → `jobs` (`amount: [kg, m³×100, 1]`, `service`, `time_windows`, `priority`, `skills: [1]` when the customer needs cold-chain — Phase 6 sets that; Phase 5 leaves it off), vehicles → `vehicles` with `capacity` and `skills`. Distances/durations from the matrix.
- `applyVroomSolution` — VROOM's `routes[].steps[]` → per-vehicle ordered `delivery_id` list with cumulative ETA; `unassigned[]` carried through.
- `solveVroom(job, signal?)` (glue, not unit-tested) — `VROOM_URL` env; `null` on failure.
- **Fallback with no VROOM:** `greedyAssign(deliveries, vehicles, matrix)` (pure, tested) — one vehicle, nearest-neighbour from the warehouse then a 2-opt pass (`lib/geo` already has `nearestNeighborOrder` + `twoOptOrder`), capacity-checked, overflow → `unassigned`. This is what runs when `solveVroom` returns `null`.

### 3.3 `lib/repo/routing.ts` (tested)

- `vehiclesRepo`, `routeTemplatesRepo` (`makeRepo`, tenant); `listVehicles`, `createVehicle`, `listRouteTemplates`, `createRouteTemplate`, `templateScheduleFor(templateId, dayOfWeek)`.
- `routableDeliveriesFor(orgId, { date, group_id? })` — every `deliveries` row `status='PLANNED'` whose order is `CONFIRMED`/`PLANNED` on `date`, joined to the customer's lat/lng and the order's total kg / m³ (kg from `order_lines.kg_per_base_unit`; m³ from a new `products.volume_m3_per_base_unit` nullable column, 0 when unset).
- `buildPlan(orgId, { date, group_id?, template_id? })` — gather deliveries + vehicles (template default, or every active vehicle), fetch the matrix (OSRM → haversine fallback), `solveVroom` (→ `greedyAssign` fallback), return `{assignments, unassigned, source: 'vroom' | 'greedy'}`. **Read-only** — proposes, does not write.
- `commitPlan(orgId, plan, { date, planned_by })` — for each assignment: find-or-create the `delivery_runs` row for `(driver, date)`, set `vehicle_id` / `route_template_id` / `planned_distance_km` / `planned_duration_min` / `capacity_stops` / `optimisation_json`, then `addStop` each delivery's order in `sort_order` (Phase 3's `addStop`, which also `planDelivery`s). Idempotent per `(run, order)` via the existing `UNIQUE`.
- `freezeRun(orgId, runId, actor)` — set `frozen_at = now`, `status = 'ready'`, and `markReady` every order on the run (Phase 3). After a freeze, `addStop` on that run throws `DeliveryError('مسیر قطعی شده — افزودن سفارش نیاز به تصمیم صریح دارد')` unless called with `{ force: true }` (a new opt), and every forced add writes an `order_events` note.
- `runsNeedingFreeze(orgId, asOf)` — planned runs whose template schedule `cutoff_time` for today has passed and `frozen_at IS NULL`. A boot-time / cron sweep can auto-freeze these; Phase 5 ships the query + a manual freeze button, the auto-sweep is a one-liner a later cron task calls.

---

## 4. API

| route | method | notes |
|---|---|---|
| `/api/sales/vehicles` | GET, POST | owner/group_manager |
| `/api/sales/route-templates` | GET, POST | owner/group_manager |
| `/api/sales/routing/plan` | POST `{date, group_id?, template_id?}` | build a proposal (read-only); returns `{assignments, unassigned, source}` |
| `/api/sales/routing/commit` | POST `{date, assignments}` | write the runs + stops |
| `/api/sales/runs/[id]/freeze` | POST | freeze; `{force:true}` on a frozen run's stop-add elsewhere |

`proxy.ts`: `/api/sales/vehicles`, `/api/sales/route-templates`, `/api/sales/routing/*` → owner/group_manager (like the batch board).

---

## 5. UI — `/sales/routing`

A lean delivery-routing surface distinct from the existing `/planner` (which plans salesperson coverage visits, not delivery runs):

- date picker (defaults today) + optional template/group filter.
- «ساخت پیشنهاد» → calls `/routing/plan`; shows each proposed run (driver, vehicle, stop count, km, duration, capacity used) and an `unassigned` list with the binding reason.
- a map (`PlannerRouteMap`, reused) with the proposed stops per run in colour.
- «تثبیت» → `/routing/commit`; then each run shows a «قطعی‌کردن» button → `/runs/[id]/freeze`.
- `source: 'greedy'` shows a «بدون بهینه‌ساز — مسیر تقریبی» note.
- nav tab «مسیریابی» (owner/manager).

Drag-to-reassign between runs is **deferred** — noted in the handoff. The planner reviews and commits or rejects; a wrong assignment is fixed by re-running the plan or moving a stop on the existing runs screen.

---

## 6. Tenancy

`vehicles`, `route_templates` on `TENANT_TABLES`; `route_schedules` exempt (through `route_templates`). `twoOrgs` seeds a `vehicles` row (`SHARED-PLATE` colliding) + a `route_templates` row per org; `tenancy-isolation` asserts no leak + the per-tenant `UNIQUE (organization_id, plate)`.

---

## 7. Migration safety

`tests/routing-migration-realdata.test.ts` (env-gated): `foreign_key_check` empty; `delivery_runs` gains the new columns, all NULL on legacy rows; `delivery_runs` row count unchanged; the `status` CHECK now accepts `'ready'`.

---

## 8. Deviations anticipated

- **OSRM/VROOM are glue, not built** — env-gated, `null` on failure, and the whole pipeline degrades to a haversine matrix + a nearest-neighbour/2-opt greedy assign. The planner works with zero services running; it just proposes a rougher route and says so (`source: 'greedy'`).
- **`products.volume_m3_per_base_unit`** is a new nullable column defaulting to 0 — volume capacity is a soft constraint until a real figure is entered.
- **No drag-to-reassign in the planner UI** this phase — propose / commit / re-plan only.
- **Auto-freeze at cutoff is a query + a one-liner**, not a running cron — Phase 7's task spine is where scheduled sweeps live.
- **`delivery_runs.status` rebuild adds `'ready'`** — guarded on the CHECK text, same pattern as the Phase 3 orders rebuild.
