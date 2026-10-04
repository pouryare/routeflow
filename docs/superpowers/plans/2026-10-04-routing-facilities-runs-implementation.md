# Facilities, Routing and the Runs View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every place a real record, make both pages compute routes through one shared core, and rebuild `?view=runs` so a run is planned in drafts, committed deliberately, and can start and end at a building rather than only at a door.

**Architecture:** Four specs form a dependency chain, and the order is **not** their numbering. Spec 2 (facilities) lands first because spec 4's `depot.ts` must ask what a facility *is* after spec 2 changes it. Spec 4 (routing core) lands second because both pages call it. Spec 3 (facility stops) lands third because it needs both. Spec 1 (the page) lands last, because it consumes all three.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, SQLite (`node:sqlite`, WAL), Vitest, Tailwind v4. OSRM for road distance, VROOM for stop ordering (`VROOM_URL` env, unset in dev → greedy fallback).

**Specs:**
1. `docs/superpowers/specs/2026-10-04-schedule-runs-view-design.md`
2. `docs/superpowers/specs/2026-10-04-facilities-and-the-place-picker-design.md`
3. `docs/superpowers/specs/2026-10-04-facility-stops-on-routes-design.md`
4. `docs/superpowers/specs/2026-10-04-one-routing-core-design.md`

---

## Critical constraints for this machine

These are not preferences. Violating them wastes the session.

| Constraint | Consequence |
|---|---|
| **Never run `next build` / `npm run build`.** | This PC cannot finish a production build. Use `npx tsc --noEmit`. |
| **Never run the Playwright smoke suite** (`vitest.smoke.mts`). | Boots a browser and a dev server. |
| **Background the full suite** (~14 min, 2,737 tests). | `setsid nohup npx vitest run > /tmp/vitest.log 2>&1 &`, then poll the log. A foreground "timeout" means it is still running. |
| **`npx tsc --noEmit` takes ~2 min.** | Background it past ~30s. Zero errors is a pass. |
| **`sharp` is pinned to exactly `0.33.5`.** | This CPU has no AVX2. Never float it — `app/api/photos/route.ts` and the receipt route die at import, failing 51 tests in `tests/api/scoping.test.ts`. |
| **Three tests flake under full-suite load.** | `tests/district-coverage.test.ts` ("has no interior hole in the net", 3222ms), `tests/api/routing-route.test.ts` ("plans, commits and freezes", 3704ms), `tests/routing-repo.test.ts` ("builds a greedy plan ordered nearest-first from the depot", 1907ms). All pass alone. Re-run the file alone before believing a failure. **Do not raise the global timeout.** |

## Test conventions in this repository

Every DB-touching test follows this exact shape — copy it, do not invent another:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-<name>-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");   // dynamic: env must be set first

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});
```

The `await import` is mandatory — `getDb` reads the env at module load, so a static import
would bind the real database.

Schema tests are named `<area>-schema.test.ts`; migration tests `<area>-migration-realdata.test.ts`.

---

## Dependency order

```
Phase 1 — Spec 2: facilities + place picker
   ├── lat/lng nullable (migration chain, 3 DDL copies)
   ├── kill FACILITY_SEED + auto-created warehouse + van 0,0
   ├── 9 kinds, icon_key, owner_username read
   └── PlacePicker, /leads position control
        │
        ▼
Phase 2 — Spec 4: one routing core
   ├── distance.ts + DistanceQuality
   ├── delete dayCapacity.byOrigin  (the degrees bug)
   ├── splitIntoDays.ts
   ├── orderStops.ts on VROOM, greedyAssign fallback
   ├── delete twoOptOrder + lib/routeOrder.ts
   ├── depot.ts
   └── the distanceFn ban, as a grep test
        │
        ▼
Phase 3 — Spec 3: facility stops on routes
   ├── deliverFromVan wiring  ← PREREQUISITE, do first
   ├── run_facility_stops + run_unload_lines
   ├── unload verb + six dispositions
   ├── RETURNED / RETURN_IN / SAMPLE_OUT
   ├── facilities in syncPull
   └── driver day: two cards + tap-flow
        │
        ▼
Phase 4 — Spec 1: the runs view
   ├── deliverFromVan now works, so: run_drafts
   ├── six pool views (lib/orderViews.ts, own storage key)
   ├── timeline as بار مسیرها, kg, ghost rings
   ├── driver picker with load bars + 14-week grid
   ├── hover pane
   ├── map beside drafts
   └── delete DaySplitPanel / OrderRouteBoard / RunPlanner
```

**Phase 3's first task is a prerequisite for Phase 4 and is worth doing early** if you want
the van's balance to exist while the rest is built.

---
## File map

**Created (Phase 1 — spec 2)**
- `components/facilities/PlacePicker.tsx` — one button, two paths (facility list / drop a pin)
- `components/facilities/FacilityForm.tsx` — name, kind, icon, address, location
- `components/facilities/FacilityKindSelect.tsx` — kind + icon chooser
- `lib/facilityIcons.ts` — the 9 kinds × their icon options

**Created (Phase 2 — spec 4)**
- `lib/routing/distance.ts` — the one "how far" implementation; `DistanceFn`, `DistanceQuality`, `DistanceMatrix`, `isApproximate` (moved from `lib/routeOrder.ts`)
- `lib/routing/orderStops.ts` — VROOM with `greedyAssign` fallback; returns `{ order, quality }`
- `lib/routing/splitIntoDays.ts` — wraps `clusterDays`; both pages call this
- `lib/routing/depot.ts` — the single origin reader; nothing else reads `is_default_origin`
- `tests/routing-single-core.test.ts` — the **grep test** that enforces the ban

**Created (Phase 3 — spec 3)**
- `lib/repo/unload.ts` — the unload verb + the six dispositions, one transaction
- `components/driver/FacilityStopCards.tsx` — the two cards
- `components/driver/UnloadTapFlow.tsx` — the reconciliation sheet
- `tests/facility-stops-schema.test.ts`, `tests/unload-repo.test.ts`, `tests/unload-sync.test.ts`

**Created (Phase 4 — spec 1)**
- `lib/orderViews.ts` — six views; own storage key (NOT `coverage_lead_view`)
- `lib/repo/runDrafts.ts` — draft read/write
- `components/sales/DayLaneBoard.tsx` — drafts + real runs, map beside
- `components/sales/StopHoverPane.tsx` — the hover pane
- `components/sales/DriverPicker.tsx` — load bars + 14-week grid
- `components/sales/views/*.tsx` — six pool views
- `tests/run-drafts-repo.test.ts`, `tests/order-views.test.ts`

**Modified**
- `lib/db.ts` — 3 `facilities` DDL copies (`:223`, `:1824`, `:3686`), seed removal, 2 new tables, `icon_key`
- `lib/facilityTypes.ts` — `van` was missing from the type; `lat`/`lng` become nullable
- `lib/repo/stock.ts:383` — stop auto-creating a warehouse at `0,0`
- `lib/repo/vanStock.ts:36` — stop inserting vans at `0,0`; add the unload verb
- `lib/dayCapacity.ts` — delete `byOrigin`; use `distance.ts`
- `lib/geo.ts`, `lib/clusterDays.ts` — `distanceFn` removed; `lib/routeOrder.ts` deleted
- `app/(shell)/leads/page.tsx` — `twoOptOrder` → `orderStops`; working position control
- `app/(shell)/sales/schedule/page.tsx` — the new view; five panels removed
- `lib/repo/syncPull.ts` — add `facilities` + the two new tables
- `lib/repo/{briefing,capacityLearning,health,deliveries}.ts` — count facility stops
- `lib/orderStateMachine.ts` — `RETURNED` writer; document `RETURN_IN`
- `lib/repo/routing.ts` — write `actual_duration_min` when a run ends

**Deleted**
- `components/sales/DaySplitPanel.tsx` — raw HTML5 `draggable`; superseded by `useCardDrag`
- `components/sales/OrderRouteBoard.tsx` — "single-stop removal has no endpoint"
- `components/sales/RunPlanner.tsx` — only the schedule page imports it (verified: `/leads` uses `LeadRunPlannerTabFlow`, a substring match that misled an earlier audit)
- `components/sales/RunTimeline.tsx`, `components/sales/DriverStreaks.tsx` — folded into Phase 4
# Phase 1 — Spec 2: Facilities and the place picker

## Task 1: Make `lat`/`lng` nullable across the whole migration chain

**Spec:** §4.1 · **Why first:** everything else in Phase 1 depends on "not placed yet" being legal.

**Files:**
- Modify: `lib/db.ts:223`, `lib/db.ts:1824`, `lib/db.ts:3686` (all three `facilities` DDL copies)
- Modify: `lib/facilityTypes.ts:26`
- Test: `tests/facilities-schema.test.ts`

**Why three copies.** Verified: they are a **migration chain**, not duplication. `:223` is the
`facilities_van_new` rebuild that added `kind`; `:1824` is the original; `:3686` is current
with `group_id` and `slug` restored. Changing only the newest leaves the rebuild paths still
declaring `NOT NULL`, and the constraint returns on the next tenant bootstrap.

- [ ] **Step 1: Write the failing test**

Create `tests/facilities-schema.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-facilities-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("facilities schema", () => {
  it("allows a facility with no location", () => {
    const db = getDb();
    const info = db.prepare("PRAGMA table_info(facilities)").all() as {
      name: string;
      notnull: number;
    }[];
    expect(info.find((c) => c.name === "lat")?.notnull).toBe(0);
    expect(info.find((c) => c.name === "lng")?.notnull).toBe(0);
  });

  it("stores a facility whose location is unknown", () => {
    const db = getDb();
    db.prepare("INSERT INTO organizations (id, name) VALUES (9001, 't')").run();
    const id = Number(
      db
        .prepare(
          `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, organization_id, created_at, updated_at)
           VALUES ('not-placed', 'warehouse', 'هنوز نامشخص', NULL, NULL, 0, 9001, '2026-10-04', '2026-10-04')`
        )
        .run().lastInsertRowid
    );
    expect(db.prepare("SELECT lat, lng FROM facilities WHERE id = ?").get(id)).toEqual({
      lat: null,
      lng: null,
    });
  });

  it("keeps NOT NULL off all three DDL copies in lib/db.ts", () => {
    // The rebuild paths are the trap: a fresh tenant bootstraps through them.
    const src = fs.readFileSync(path.join(process.cwd(), "lib/db.ts"), "utf8");
    expect(src.match(/lat REAL NOT NULL/g) ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/facilities-schema.test.ts`
Expected: FAIL — `lat.notnull` is `1`, and the source contains 3 `lat REAL NOT NULL`.

- [ ] **Step 3: Make it nullable in all three copies**

In `lib/db.ts`, replace **every** occurrence of

```sql
      lat REAL NOT NULL,
      lng REAL NOT NULL,
```
## Task 2: Delete every hard-coded location

**Spec:** §4.1 · **Files:** `lib/db.ts` (seed), `lib/repo/stock.ts:383`, `lib/repo/vanStock.ts:36`

Four sites, each verified by reading it:

| site | what it does |
|---|---|
| `lib/db.ts:4870` `FACILITY_SEED` | seeds two **real addresses** (بکه + پردیس), pinned to `organization_id = 1` |
| `lib/repo/stock.ts:383` | auto-creates «انبار» at `lat 0, lng 0` |
| `lib/repo/vanStock.ts:36` | inserts **every van** at `lat 0, lng 0` |
| `facilities.lat/lng NOT NULL` | forced the two lies above — removed in Task 1 |

- [ ] **Step 1: Write the failing test**

Add to `tests/facilities-schema.test.ts`:

```ts
  it("seeds no facility at all", () => {
    const db = getDb();
    expect(db.prepare("SELECT COUNT(*) AS n FROM facilities").get()).toEqual({ n: 0 });
  });

  it("invents no warehouse at 0,0", () => {
    const db = getDb();
    db.prepare("INSERT INTO organizations (id, name) VALUES (9002, 't')").run();
    const rows = db
      .prepare("SELECT slug, lat, lng FROM facilities WHERE organization_id = ?")
      .all(9002) as { slug: string; lat: number | null; lng: number | null }[];
    for (const r of rows) {
      expect(`${r.slug}:${r.lat},${r.lng}`).not.toBe("انبار:0,0");
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/facilities-schema.test.ts`
Expected: FAIL — the seed inserts 2 rows.

- [ ] **Step 3: Remove the seed**

In `lib/db.ts`, delete the `FACILITY_SEED` constant and its insertion loop (around `:4870`).
Delete the block; do not comment it out — the addresses are personal.

- [ ] **Step 4: Remove the auto-created warehouse**

In `lib/repo/stock.ts` around `:383`, delete the
`INSERT INTO facilities (..., 'انبار', 0, 0, ...)` and replace the call site with:

```ts
throw new Error("انبار تعریف نشده است");
```

**That is already the message the code produces today** when no warehouse exists — the
auto-create was hiding a real requirement behind a fake row. Now it is stated.

- [ ] **Step 5: Remove the van's invented location**

## Task 3: The nine kinds, icons, and homes

**Spec:** §5, §6, §7 · **Files:** `lib/facilityTypes.ts`, `lib/facilityIcons.ts`, `lib/db.ts` (`icon_key`), `components/facilityArt.ts`, `lib/facilities.ts`, `tests/facilities-schema.test.ts`

Decided and recorded:
- **Nine kinds**, which are **labels today** — all eleven reads of `kind` ask only *"which is
  the home base?"* or *"which is the depot?"*
- **The icon is per facility**, not per kind. The kind narrows the field; the person picks.
  This deliberately reverses the `FACILITY_ART` decision.
- **`home` replaces `home_base`**, and `owner_username` finally gets read.

| kind | فارسی | icon options |
|---|---|---|
| `warehouse` | انبار | crates · building-door · silo |
| `factory` | کارخانه | factory · gear |
| `van` | ماشین | van · truck |
| `home` | خانه | house · apartment |
| `office` | دفتر | office · desk |
| `shop` | فروشگاه | shopfront · shelf |
| `cold_storage` | سردخانه | snowflake · cold-room |
| `parking` | پارکینگ | parking-lot · garage |
| `other` | مکان دیگر | pin · marker |

- [ ] **Step 1: Write the failing test**

Add to `tests/facilities-schema.test.ts`:

```ts
  it("accepts the nine kinds including van", async () => {
    const db = getDb();
    db.prepare("INSERT INTO organizations (id, name) VALUES (9003, 't')").run();
    const { FACILITY_KINDS } = await import("@/lib/facilityTypes");
    expect(FACILITY_KINDS).toHaveLength(9);
    for (const kind of FACILITY_KINDS) {
      const id = Number(
        db
          .prepare(
            `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, organization_id, created_at, updated_at)
             VALUES (?, ?, ?, NULL, NULL, 0, 9003, '2026-10-04', '2026-10-04')`
          )
          .run(`k-${kind}`, kind, kind).lastInsertRowid
      );
      expect(id).toBeGreaterThan(0);
    }
  });

  it("stores an icon chosen per facility, not per kind", () => {
    const db = getDb();
    const info = db.prepare("PRAGMA table_info(facilities)").all() as { name: string }[];
    expect(info.map((c) => c.name)).toContain("icon_key");
  });
```

The first fails twice over: `FACILITY_KINDS` has 3 entries, and the CHECK rejects `factory`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/facilities-schema.test.ts`
- [ ] **Step 6: Create `lib/facilityIcons.ts`**

```ts
import type { FacilityKind } from "./facilityTypes";

/** Each kind offers several shapes; the person picks one. The kind narrows the field,
 *  it does not decide the icon -- that reversal is what lets adding a kind later leave
 *  every already-chosen icon valid. */
export const FACILITY_ICON_OPTIONS: Record<
  FacilityKind,
  { key: string; label_fa: string }[]
> = {
  warehouse: [
    { key: "crates", label_fa: "جعبه‌ها" },
    { key: "building-door", label_fa: "ساختمان با در" },
    { key: "silo", label_fa: "سیلو" },
  ],
  factory: [
    { key: "factory", label_fa: "کارخانه" },
    { key: "gear", label_fa: "چرخ‌دنده" },
  ],
  van: [
    { key: "van", label_fa: "وانت" },
    { key: "truck", label_fa: "کامیون" },
  ],
  home: [
    { key: "house", label_fa: "خانه" },
    { key: "apartment", label_fa: "آپارتمان" },
  ],
  office: [
    { key: "office", label_fa: "دفتر" },
    { key: "desk", label_fa: "میز" },
  ],
  shop: [
    { key: "shopfront", label_fa: "ویترین" },
    { key: "shelf", label_fa: "قفسه" },
  ],
  cold_storage: [
    { key: "snowflake", label_fa: "برف" },
    { key: "cold-room", label_fa: "اتاق سرد" },
  ],
  parking: [
    { key: "parking-lot", label_fa: "پارکینگ" },
    { key: "garage", label_fa: "تعمیرگاه" },
  ],
  other: [
    { key: "pin", label_fa: "نشانه" },
    { key: "marker", label_fa: "نقطه" },
  ],
};

export function iconsFor(kind: FacilityKind) {
  return FACILITY_ICON_OPTIONS[kind] ?? FACILITY_ICON_OPTIONS.other;
}
```

- [ ] **Step 7: Give `other` its own silhouettes**

`components/facilityArt.ts` makes `other` a copy of `warehouse`, reasoning that a third shape
adds *"a symbol the legend has to teach for no gain."* **That was right when the icon was per
kind and is wrong now** — `other` exists because the kind is unknown, so it must not look like
the most common known thing.

- [ ] **Step 8: Make `owner_username` readable**
## Task 4: `PlacePicker`, and `/leads` finally gets a working position control

**Spec:** §8, §9 · **Files:** `components/facilities/PlacePicker.tsx`, `app/(shell)/leads/page.tsx:195-240`, `tests/PlacePicker.test.tsx`

**The bug being fixed.** `LocationPinPicker` exists and is imported by `/leads`, but the
«تعیین موقعیت» control is a **dead button** — `SearchBox` has a clearable chip that `/leads`
bypasses, and there is no way to pick an existing facility.

**The decision:** one button, both paths inside. Not two buttons side by side (the toolbar
already carries a sort dropdown and «انتخاب همه»), and not a search box first (ceremony at
three facilities, which is what exists today).

```
┌─ تعیین موقعیت ──────────────────────────────┐
│ مکان‌های من                                  │
│   📦 انبار بکه            Pardis, Tehran     │
│   🏠 خانهٔ من            فاز ۲، پردیس        │
│   🅿️ پارکینگ شمال        بزرگراهHemmat       │
│ ───────────────────────────────────────────── │
│ اینجا نیست؟ روی نقشه مشخص کن                │
└──────────────────────────────────────────────┘
```

- [ ] **Step 1: Write the failing test**

Create `tests/PlacePicker.test.tsx` (follow the existing component-test pattern in
`tests/LocationCard.test.tsx` for render setup):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PlacePicker from "@/components/facilities/PlacePicker";

const FACILITIES = [
  { id: 1, name: "انبار بکه", kind: "warehouse", lat: 35.7, lng: 51.4, icon_key: "crates" },
  { id: 2, name: "خانهٔ من", kind: "home", lat: 35.7, lng: 51.5, icon_key: "house" },
  { id: 3, name: "پارکینگ شمال", kind: "parking", lat: null, lng: null, icon_key: "garage" },
] as never;

describe("PlacePicker", () => {
  it("offers every facility, and marks the ones with no location", () => {
    render(<PlacePicker facilities={FACILITIES} onPick={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText("انبار بکه")).toBeTruthy();
    expect(screen.getByText("خانهٔ من")).toBeTruthy();
    // A facility with no location is listed but not selectable as a point.
    expect(screen.getByText("هنوز مکان مشخص نیست")).toBeTruthy();
  });

  it("offers the map as a second path, not a second button", () => {
    render(<PlacePicker facilities={FACILITIES} onPick={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /تعیین موقعیت/ })).toHaveLength(1);
    expect(screen.getByText(/روی نقشه مشخص کن/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/PlacePicker.test.tsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write `components/facilities/PlacePicker.tsx`**

Props: `{ facilities: FacilityRow[]; onPick(f: FacilityRow): void; onMapPick(lat: number, lng: number): void; onClear(): void }`.

Rules:
# Phase 2 — Spec 4: One routing core

> **Phase 2 is where the DRY violation is fixed.** Everything here exists because six places
> could each answer "how far?" differently. Read spec 4 §1 before starting.

## Task 5: `lib/routing/distance.ts`, and the ban that prevents recurrence

**Spec:** §2, §2.1, §2.2 · **Files:** create `lib/routing/distance.ts`, `tests/routing-single-core.test.ts`, modify `lib/routeOrder.ts`

- [ ] **Step 1: Write the failing test — the grep test FIRST**

This is the most important test in the plan. It encodes the rule, not a behaviour.

Create `tests/routing-single-core.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROUTING_DIR = path.join(process.cwd(), "lib/routing");

/** Files allowed to declare a distance function. Everything else must ask lib/routing. */
const ALLOWED = new Set([
  path.join(ROUTING_DIR, "distance.ts"),
  path.join(ROUTING_DIR, "orderStops.ts"),
  path.join(ROUTING_DIR, "splitIntoDays.ts"),
  path.join(ROUTING_DIR, "depot.ts"),
]);

function tsFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return tsFiles(p);
      return e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [p] : [];
    });
}

describe("one routing core", () => {
  it("no routing function outside lib/routing declares a distanceFn", () => {
    const offenders: string[] = [];
    for (const root of ["lib", "app", "components"]) {
      for (const file of tsFiles(path.join(process.cwd(), root))) {
        if (ALLOWED.has(file)) continue;
        const src = fs.readFileSync(file, "utf8");
        if (/distanceFn\s*[?:=]/.test(src)) offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lib/routing is the only home of a DistanceFn type", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "lib/routeOrder.ts"), "utf8");
    expect(src).not.toContain("export type DistanceFn");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/routing-single-core.test.ts`
Expected: FAIL listing six offenders: `lib/routeOrder.ts`, `lib/clusterDays.ts`,
`lib/geo.ts`, `lib/dayCapacity.ts`.

- [ ] **Step 3: Create `lib/routing/distance.ts`**

Move the type and the honesty helper out of `lib/routeOrder.ts`:

```ts
import type { LatLng } from "@/lib/geo";
import { distanceKm } from "@/lib/geo";

/** The ONLY definition. Nothing outside lib/routing may declare one -- spec 4 §2.1.
 *  An optional distance with a silent fallback is what let six sites each hold their own
 *  opinion, which is the bug this module exists to end. */
export type DistanceFn = (a: LatLng, b: LatLng) => number;

export type DistanceQuality = "roads" | "straight-line";

export interface DistanceMatrix {
  km: number[][];
  quality: DistanceQuality;
}

/** The labelled fallback. Real for a driver offline, but it is not kilometres -- so
 *  anything showing one says so. */
## Task 6: Delete `byOrigin` — the degrees bug

**Spec:** §4 · **Files:** `lib/dayCapacity.ts:164`, `:196-238`, `tests/day-capacity.test.ts`

`dayCapacity.byOrigin` is `Math.hypot(o.lat - origin.lat, o.lng - origin.lng)` — a raw
**degree** difference, and it **ignores the `distanceFn` it is passed**. So «پیشنهاد بده»
sorted the pool by a meaningless number, and that ordering decides which day fills first.

- [ ] **Step 1: Read the real signature first**

Run: `sed -n '100,120p' lib/dayCapacity.ts` and `sed -n '190,240p' lib/dayCapacity.ts`

Use the **actual** argument order and the **actual** shape of `SplitOrder`. Do not invent
one — a test written against a guessed signature passes vacuously.

- [ ] **Step 2: Write the test that would have caught it**

The fixture must be one where **straight-line and roads disagree**. Create
`tests/day-capacity.test.ts` (this module is pure, so no DB harness is needed):

```ts
import { describe, it, expect } from "vitest";
import { splitByCapacity } from "@/lib/dayCapacity";
import { straightLine, isApproximate } from "@/lib/routing/distance";

const DEPOT = { lat: 35.7, lng: 51.4 };

/** Straight-line ranks A before B. The road fixture reverses it, because the only way
 *  between them crosses a pass. A test that passes under BOTH measures proves nothing --
 *  which is how this survived two audits. */
const A = { id: "A", lat: 35.705, lng: 51.405, packs: 2, weight_kg: 20, requestedDay: null };
const B = { id: "B", lat: 35.706, lng: 51.406, packs: 2, weight_kg: 20, requestedDay: null };

describe("dayCapacity orders by the distance it is given", () => {
  it("does not rank by raw degrees", () => {
    const roads = (p: { lat: number; lng: number }, q: { lat: number; lng: number }) => {
      const straight = Math.hypot(p.lat - q.lat, p.lng - q.lng);
      return p === A ? straight * 400 : straight * 100;
    };
    const plan = splitByCapacity([A, B], 5, DEPOT, roads, 0);
    expect(plan.days[0].orderIds[0]).toBe("B");
  });

  it("sorts an order with no location last, never first", () => {
    const noPlace = { ...A, id: "C", lat: null, lng: null };
    const plan = splitByCapacity([noPlace, B], 5, DEPOT, straightLine, 0);
    expect(plan.days[0].orderIds[0]).toBe("B");
  });

  it("labels the straight-line fallback as approximate", () => {
    expect(isApproximate(straightLine)).toBe(true);
  });
});
```

Adjust the call to the signature you read in Step 1.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/day-capacity.test.ts`
Expected: FAIL — `byOrigin` ignores the function and ranks A first.

- [ ] **Step 4: Delete `byOrigin` and use the passed function**
## Task 7: `splitIntoDays.ts` — one clustering entry point

**Spec:** §4 · **Files:** create `lib/routing/splitIntoDays.ts`, `lib/clusterDays.ts`, `app/(shell)/leads/page.tsx:113`, `tests/split-into-days.test.ts`

`/leads` clusters geographically; `?view=runs` splits by capacity. **Those stay two
functions** — they answer different questions, and forcing one on both would make one worse.
What they share is the *mechanism*: both take every distance from `lib/routing/distance.ts`
and both take their origin from `depot.ts`.

- [ ] **Step 1: Read the real signature first**

Run: `sed -n '250,275p' lib/clusterDays.ts`

Match the **actual** `clusterIntoDays` signature and `DayCluster` shape in the wrapper.

- [ ] **Step 2: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { splitIntoDays } from "@/lib/routing/splitIntoDays";
import { straightLine } from "@/lib/routing/distance";

describe("splitIntoDays", () => {
  it("reports which measure it used", () => {
    const plan = splitIntoDays(
      [
        { id: "a", lat: 35.71, lng: 51.41 },
        { id: "b", lat: 35.66, lng: 51.36 },
      ],
      { stopsPerDay: 5, origin: { lat: 35.7, lng: 51.4 }, distanceFn: straightLine }
    );
    expect(plan.quality).toBe("straight-line");
    expect(plan.days).toHaveLength(1);
  });

  it("splits when the set is larger than one day", () => {
    const stops = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      lat: 35.6 + i * 0.02,
      lng: 51.3 + i * 0.02,
    }));
    const plan = splitIntoDays(stops, {
      stopsPerDay: 3,
      origin: { lat: 35.7, lng: 51.4 },
      distanceFn: straightLine,
    });
    expect(plan.days.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/split-into-days.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Write `lib/routing/splitIntoDays.ts`**

A thin wrapper that **owns the distance default** so no caller has to:

```ts
import { clusterIntoDays, daysNeeded, type DayCluster } from "@/lib/clusterDays";
import {
  straightLine,
  qualityOf,
  type DistanceFn,
  type DistanceQuality,
} from "./distance";
import type { LatLng } from "@/lib/geo";

export interface SplittableStop extends LatLng {
  id: string;
}
## Task 8: `orderStops.ts` — VROOM, with a labelled greedy fallback

**Spec:** §3, §3.1 · **Files:** create `lib/routing/orderStops.ts`, `app/(shell)/leads/hooks/useLeads.ts:205`, `tests/order-stops.test.ts`

`twoOptOrder` and `optimiseRemaining` are deleted in Task 9, **not kept as fallbacks** — two
surviving fallbacks is how there got to three orderers. The fallback is `greedyAssign`, which
already lives beside VROOM.

- [ ] **Step 1: Read the real signatures first**

Run: `sed -n '138,165p' lib/routing/vroom.ts` and `sed -n '200,220p' lib/routing/vroom.ts`

Use the **actual** `greedyAssign` and `solveVroom` shapes. A wrapper written against guessed
signatures compiles and returns nonsense.

- [ ] **Step 2: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { orderStops } from "@/lib/routing/orderStops";
import { straightLine } from "@/lib/routing/distance";

const DEPOT = { lat: 35.7, lng: 51.4 };
const STOPS = [
  { id: "far", lat: 35.8, lng: 51.5 },
  { id: "near", lat: 35.71, lng: 51.41 },
  { id: "mid", lat: 35.75, lng: 51.45 },
];

describe("orderStops", () => {
  it("degrades to greedy and says so", async () => {
    delete process.env.VROOM_URL;   // the branch that actually runs today
    const r = await orderStops(STOPS, DEPOT, { distanceFn: straightLine });
    expect(r.order[0].id).toBe("near");
    expect(r.quality).toBe("greedy");
  });

  it("names the measure it used", async () => {
    const r = await orderStops(STOPS, DEPOT, { distanceFn: straightLine });
    expect(r.distance).toBe("straight-line");
  });

  it("returns every stop exactly once", async () => {
    const r = await orderStops(STOPS, DEPOT, { distanceFn: straightLine });
    expect(r.order.map((s) => s.id).sort()).toEqual(["far", "mid", "near"]);
  });
});
```

The `quality` field is **not decoration**: `VROOM_URL` is unset today, so every run silently
falls back. A run ordered by the fallback must not look like one ordered by the solver.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/order-stops.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Write `lib/routing/orderStops.ts`**

```ts
import { greedyAssign, solveVroom } from "./vroom";
import {
  straightLine,
  qualityOf,
## Task 9: Delete the two dead orderers, and add `depot.ts`

**Spec:** §5, steps 5 and 7 · **Files:** delete `lib/routeOrder.ts`, `lib/geo.ts:104`; modify `tests/route-order.test.ts`, `lib/facilities.ts:66,82`, `lib/repo/coverageAnalytics.ts:106`, `lib/repo/vanStock.ts:133`, `components/CoverageMap.tsx:1107`

`lib/routeOrder.ts` is 155 lines of correct, tested, **uncalled** code. `twoOptOrder` had one
caller, which Task 8 replaced. Both go now.

- [ ] **Step 1: Find every remaining importer — do not trust the plan**

Run:
```bash
grep -rn "routeOrder\|twoOptOrder\|optimiseRemaining\|sortByDistanceFrom\|routeLengthWith\|resolveAnchor\|isApproximate" \
  --include=*.ts --include=*.tsx lib app components tests
```

Every hit must be resolved before deleting. **If this grep finds an importer the audits
missed, that is the point of making it a grep rather than an audit** — fix the importer, do
not restore the module.

- [ ] **Step 2: Move what is still needed**

`isApproximate` moved in Task 5. Anything still imported — `resolveAnchor`,
`sortByDistanceFrom` — moves into `lib/routing/depot.ts` or is inlined at its one call site.

- [ ] **Step 3: Delete**

```bash
git rm lib/routeOrder.ts
```

Remove `twoOptOrder` from `lib/geo.ts:104`.

- [ ] **Step 4: Rewrite `tests/route-order.test.ts`**

Its fixtures are worth keeping — notably the comment at `:17` that a town must not sit **on**
the depot, because zero distance always sorts first and hides the ordering entirely. Move
those cases into `tests/order-stops.test.ts` and `tests/split-into-days.test.ts`, then delete
the file.

- [ ] **Step 5: Create `lib/routing/depot.ts`**

```ts
import type { LatLng } from "@/lib/geo";
import { getDb } from "@/lib/db";

/** Where a day starts, and where stock is loaded from.
 *
 *  The ONLY place that reads is_default_origin. Centralising it is what makes spec 2's
 *  "what is a facility" change land in one place instead of eleven. */
export function depotFor(orgId: number): LatLng | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT lat, lng FROM facilities
        WHERE organization_id = ? AND lat IS NOT NULL
        ORDER BY is_default_origin DESC, id ASC
        LIMIT 1`
    )
    .get(orgId) as { lat: number | null; lng: number | null } | undefined;
  return row?.lat != null && row?.lng != null ? { lat: row.lat, lng: row.lng } : null;
}

/** The facility this driver last loaded from -- the default for a new run. Behaviour, not
 *  a setting: it cannot be forgotten to maintain, and it follows the business when a
 *  second depot opens. */
export function lastLoadedFrom(orgId: number, driverUserId: number): number | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT rfs.facility_id FROM run_facility_stops rfs
         JOIN delivery_runs dr ON dr.id = rfs.run_id
# Phase 3 — Spec 3: Facility stops on routes

## Task 10: Wire `deliverFromVan` — the van's balance does not exist today

**Spec:** §1.4, §3.3 · **Files:** `lib/repo/vanStock.ts:91`, `lib/delivery.ts:355-440`, `tests/van-stock.test.ts`

**This is the single highest-value line in the whole plan.** `deliverFromVan` is defined at
`vanStock.ts:91` and **called from nowhere** in `lib/` or `app/`. Goods loaded at Bākeh and
delivered at noon are not tracked as having left the van. Spec 3's reconciliation asks
`vanOnHand(van, product)` — so without this task **there is no correct number to reconcile
against**.

**The rule, stated once:** `deliverFromVan` fires when goods **physically leave** the van. A
refused or skipped delivery does **not** call it — those goods never left.

- [ ] **Step 1: Write the test that distinguishes the two cases**

```ts
// tests/van-stock.test.ts -- use the DB harness from this plan's header
it("decrements the van on a delivery", () => {
  // load 10 of a product onto a van, deliver 6
  expect(vanOnHand(org, vanId, productId)).toBe(4);
});

it("does NOT decrement the van when the customer refuses everything", () => {
  // load 10, then complete the stop with packs_delivered = 0 on every line
  expect(vanOnHand(org, vanId, productId)).toBe(10);
});

it("decrements only what was actually taken on a partial delivery", () => {
  // load 10, deliver 4 of 10 packs
  expect(vanOnHand(org, vanId, productId)).toBe(6);
});
```

The middle test is the one that matters. It is the case that made spec 3's original
`loaded − delivered` wrong: a refused stop writes **no `deliveries` row**
(`delivery.ts:380` sets `status='refused'`; the insert is in the `else` at `:430`), so
anything counting delivery *rows* under-counts, and the goods stay aboard.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/van-stock.test.ts`
Expected: FAIL — the balance never changes, because nothing calls `deliverFromVan`.

- [ ] **Step 3: Call it from the delivery path**

In `lib/delivery.ts`, inside the branch where a `deliveries` row is actually written —
i.e. **not** the `nothingTaken` case — call `deliverFromVan` per line, for the quantity
delivered:

```ts
for (const line of input.lines) {
  const qty = toBase(line.packs_delivered);
  if (qty > 0) {
    deliverFromVan({
      organizationId: orgId,
      facilityId: vanFacilityId,
      productId: line.product_id,
      qty,
      actorId: input.by,
    });
  }
}
## Task 11: The two tables, and the schema test

**Spec:** §3.1, §3.2 · **Files:** `lib/db.ts`, `tests/facility-stops-schema.test.ts`

**Why a separate table, not a nullable `order_id`.** `delivery_stops` carries
`UNIQUE (run_id, order_id)`, which is what stops one order appearing twice on a run. SQLite
treats NULLs as distinct from each other, so making `order_id` nullable **silently switches
that guard off** — no error, just a duplicate stop.

```
run_facility_stops
  id            PK
  run_id        → delivery_runs(id) ON DELETE CASCADE
  facility_id   → facilities(id)
  role          'load' | 'unload'
  status        'pending' | 'done'
  done_at, done_by, notes
  UNIQUE (run_id, role)          -- one load, one unload

run_unload_lines
  id, run_id → delivery_runs ON DELETE CASCADE
  product_id → products(id)
  disposition 'returned'|'damaged'|'expired'|'discarded'|'lost'|'sample'
  qty_base, note, occurred_at, created_by
```

Neither carries `organization_id`: both are reached through `delivery_runs`, which is in
`TENANT_TABLES` — the same reasoning already recorded for `lead_run_stops`.

- [ ] **Step 1: Write the failing schema test**

Create `tests/facility-stops-schema.test.ts` using the DB harness from this plan's header:

```ts
describe("facility stops schema", () => {
  it("creates both tables", () => {
    const db = getDb();
    for (const t of ["run_facility_stops", "run_unload_lines"]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    }
  });

  it("refuses a second load and a second unload on one run", () => {
    // run + facility + two 'load' rows -> UNIQUE (run_id, role) must throw
  });

  it("leaves delivery_stops' own guard intact", () => {
    // Two stops for the SAME order on one run must still be rejected. This is the
    // regression guard for the whole design: nulling order_id would disable it
    // silently, which is why facility visits get their own table.
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/facility-stops-schema.test.ts`
Expected: FAIL — no such tables.

- [ ] **Step 3: Create both tables in `lib/db.ts`**

Use the DDL above, plus indexes:
## Task 12: `lib/repo/unload.ts` — the verb, the six dispositions, one transaction

**Spec:** §3.3, §6, §6.1, §8 · **Files:** create `lib/repo/unload.ts`, `tests/unload-repo.test.ts`

**The central rule.** *Should come back = `vanOnHand(van, product)`.* There is **no
arithmetic** in this task — no `loaded − delivered`, and no term for failed deliveries,
because a failed delivery's goods never left the van and are already in the balance.

**The samples facility.** One per organisation, named «نمونه‌های داده‌شده», `kind: other`,
auto-created, never edited, never deleted. **Every movement needs a destination or the books
do not balance** — a sample that went nowhere would leave the warehouse's on-hand permanently
wrong by the sampled amount, with nothing recording that it went wrong.

**A sample earns nothing, not even kilograms.** Commission is earned on `deliveries`, and a
disposition creates no delivery — so this is structural, not a rule someone must remember.

- [ ] **Step 1: Write the tests**

Create `tests/unload-repo.test.ts` (DB harness from the plan header):

```ts
it("refuses a reconciliation that declares less than the balance", () => {
  // van holds 6; declare 5 -> throws, and the message names the gap by number
  expect(() => reconcileUnload(...)).toThrow(/۶/);
});

it("gives the same answer at noon and at six", () => {
  // no time argument exists, so this asserts the API has none
  expect(shouldReturn(org, vanId, productId)).toBe(6);
});

it("a returned line moves the stock back to the facility", () => {
  reconcileUnload(...);
  expect(vanOnHand(org, vanId, productId)).toBe(0);
  expect(onHand(org, { product_id: productId, facility_id: depotId })).toBe(6);
});

it("a sample leaves stock, creates no delivery, and earns no commission", () => {
  reconcileUnload(... disposition "sample" ...);
  expect(vanOnHand(org, vanId, productId)).toBe(0);
  expect(deliveriesCreated).toBe(0);          // so no commission is possible
  expect(samplesFacilityBalance).toBe(6);
});

it("writes every line or none", () => {
  // a line that would over-draw must roll the whole reconciliation back
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unload-repo.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write `shouldReturn`**

```ts
/** The only definition of "how much should come back". Asks the ledger rather than
 *  recomputing, so it cannot drift, and it is the same answer at noon and at six. */
export function shouldReturn(orgId: number, vanFacilityId: number, productId: number): number {
  return vanOnHand(orgId, vanFacilityId, productId);
}
```

- [ ] **Step 4: Write the six movements**

| `disposition` | ledger |
|---|---|
| `returned` | `TRANSFER_OUT` van + `TRANSFER_IN` facility |
| `damaged` | `WRITE_OFF` |
| `expired` | `WRITE_OFF` |
| `discarded` | `WRITE_OFF` |
| `lost` | `WRITE_OFF` |
| `sample` | `SAMPLE_OUT` → the samples facility |

## Task 13: `RETURNED` and the door-side replacement

**Spec:** §7, §7.1 · **Files:** `lib/orderStateMachine.ts`, `lib/repo/stock.ts:414-421`, `lib/delivery.ts`, `tests/return-replacement.test.ts`

`RETURNED` is in `ORDER_STATUSES`, is in `TERMINAL_ORDER_STATUSES`, and `syncMutations.ts:154`
treats it as terminal — and **has no writer anywhere**, verified by grep. `RETURN_IN` likewise
has no writer: it appears in `MANUAL_MOVEMENT_KINDS` and a comment in `batchStates.ts`.

- [ ] **Step 1: Write the tests**

```ts
it("a replacement the customer accepts swaps the goods", () => {
  // RETURN_IN (bad goods, customer -> van) + DELIVERY_OUT (fresh, van -> customer),
  // and the expired goods are ON THE VAN, waiting for the end-of-day reconciliation
  expect(vanOnHand(org, vanId, productId)).toBeGreaterThan(0);
});

it("a replacement the customer also refuses ends the order as RETURNED", () => {
  // nothing left the van at that door; the stop is a refusal, not a delivery
  expect(orderStatus).toBe("RETURNED");
});

it("a customer who received nothing owes nothing for it", () => {
  // the adjustment raised for the expired line is credited back, not re-charged
  expect(orderTotalToman).toBe(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/return-replacement.test.ts`
Expected: FAIL — no `RETURNED` writer exists.

- [ ] **Step 3: Add the `RETURNED` transition**

In `lib/orderStateMachine.ts`, add a transition to `RETURNED` with roles
`["delivery_driver","system"]` and effects `["stampReturned"]` — a **new** effect name, added
to `OrderEffect` at `:60`, whose implementation credits the order back.

**Stock and order move in the same transaction.** A half-written return leaves goods
accounted for and a customer still charged, which is worse than either bug alone.

- [ ] **Step 4: Document `RETURN_IN` where it is defined**

`MANUAL_MOVEMENT_KINDS` (`stock.ts:414-421`) has a comment explaining only `PURCHASE_IN` and
`DELIVERY_OUT`. **This spec gives `RETURN_IN` its first meaning** — a door-side swap. Write
## Task 14: `facilities` in `syncPull`, and the five readers

**Spec:** §9 · **Files:** `lib/repo/syncPull.ts`, `lib/repo/briefing.ts:139`, `lib/repo/capacityLearning.ts:67`, `lib/repo/health.ts:260,282`, `lib/delivery.ts:724`, `app/api/sales/runs/route.ts:16`, `tests/unload-sync.test.ts`

**The verified contradiction.** `syncPull` pulls `orders`, `customers`, `delivery_runs`,
`delivery_stops`, `lead_run_stops`, `saved_locations`, `deliveries` and `order_lines` — and
**`facilities` is absent**. Specs 2 and 3 both claimed otherwise; both were wrong. So today a
driver's offline bundle has **no address for any warehouse**, and this feature's whole premise
is that he must know where he is going.

`saved_locations` is not a substitute — different table, geocoding scratch rows, nothing keeps
it in step with `facilities`.

- [ ] **Step 1: Write the failing sync test**

```ts
it("gives an offline driver the facility's address, not just its name", () => {
  const bundle = pullFor(orgId, driverId);
  const facility = bundle.facilities.find((f) => f.slug === "depot");
  expect(facility?.lat).not.toBeNull();
  expect(facility?.lng).not.toBeNull();
});

it("sends the run's facility stops and its unload lines", () => {
  expect(bundle.run_facility_stops.length).toBeGreaterThan(0);
  expect(bundle.run_unload_lines.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unload-sync.test.ts`
Expected: FAIL — `facilities` is not in the bundle.

- [ ] **Step 3: Add three selects to `syncPull`**

`facilities`, `run_facility_stops`, `run_unload_lines` — scoped through `organization_id` /
`delivery_runs` the way `lead_run_stops` already is at `:119`.

- [ ] **Step 4: Make the reconciliation idempotent**

`delivery_stop_id` already gives the ledger its idempotency key; the unload lines need the
same, so a retried sync **converges rather than double-writing the van's balance**. The sharpest
risk in spec 3 — the whole feature runs where there is no signal.

- [ ] **Step 5: Update the five readers to count facility stops**

A load and an unload **are** stops. Without this, run-duration predictions get *less* accurate
the moment this phase lands — silently. The five sites:

| site | what it counts |
|---|---|
| `briefing.ts:139` | `COUNT(*) AS stops` |
| `capacityLearning.ts:67` | `COUNT(*) … status = 'delivered'` |
## Task 15: The driver's day — two cards and the tap-flow

**Spec:** §5, §6 · **Files:** `components/driver/FacilityStopCards.tsx`, `components/driver/UnloadTapFlow.tsx`, `app/(bare)/driver/page.tsx`, `tests/driver-facility-cards.test.tsx`

Neither card takes a number in the sequence, and **neither is numbered**. The unload is a
**destination, not a stop**: as stop 3 it renumbers everything when dragged, and the list
would claim an order that is not real.

```
┌ بارگیری · انبار بکه ──────────── اولِ روز ──── ✓ انجام شد ┐
├ تخلیه · خانهٔ من ──────── هر وقت خواستی ──── [هنوز نکرده] ┤
│                                                            │
│  ۱  بازرگانی کیان          تحویل                 ۳.۱ ک.م  │
│  ۲  پخش البرز              تحویل                 ۱.۸ ک.م  │
└────────────────────────────────────────────────────────────┘
```

- [ ] **Step 1: Write the failing component test**

```tsx
it("shows both cards, neither numbered", () => {
  render(<FacilityStopCards load={load} unload={unload} stops={stops} />);
  expect(screen.getByText("اولِ روز")).toBeTruthy();
  expect(screen.getByText("هر وقت خواستی")).toBeTruthy();
});

it("pre-fills the unload with what the ledger says should return", () => {
  render(<UnloadTapFlow runId={1} />);
  expect(screen.getByText("باقی‌مانده: ۶ کارتن")).toBeTruthy();
});

it("offers six dispositions", () => {
  render(<UnloadTapFlow runId={1} />);
  for (const label of ["برگشت به انبار", "خراب", "تاریخ مصرف گذشته",
                       "دور ریخته شد", "گم شده", "نمونه"]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});

it("lets the driver add several lines", () => {
  // «خراب ۵ کیلو» alongside «تاریخ مصرف گذشته ۲ کارتن» must both be declarable
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/driver-facility-cards.test.tsx`
Expected: FAIL — the components do not exist.

- [ ] **Step 3: Write `FacilityStopCards.tsx`**

The load card's tick reflects the **last confirmed** reconciliation. A queued-but-unsent one
still reads as pending — the manager's question is *"did the extras physically come back"*, and
that is only true when the server says so. **No optimistic UI here.**

- [ ] **Step 4: Write `UnloadTapFlow.tsx`**

A tap-flow, not a form: the app pre-fills every number because it knows what was loaded and
what was delivered. **The driver confirms or corrects — never computes.** Multiple lines are
first-class, each one row with a disposition and a quantity, with the total checked live
against `shouldReturn`.

- [ ] **Step 5: Wire both into `app/(bare)/driver/page.tsx`**

Above the stop list. The page is in the **bare** route group, outside the shell — deliberate: a
phone in a van, one screen, nothing else.
# Phase 4 — Spec 1: The runs view

> The page itself. Everything it needs now exists: facilities are real (Phase 1), routing is
> shared (Phase 2), and the van's balance is true (Phase 3).

## Task 16: `run_drafts` — a draft is a proposed day with no driver yet

**Spec:** §14.1, §2 · **Files:** `lib/db.ts`, `lib/repo/runDrafts.ts`, `tests/run-drafts-repo.test.ts`

**The one rule the whole page obeys:**

> **Making something new is deliberate. Changing something real is instant.**

A lane without a driver or a date is a **draft**. A lane with both is a **run**. There is **no
global commit button** — so there is nothing to forget and nowhere to navigate back to.

```
run_drafts       id, organization_id, user_id,
                 driver_user_id NULL, run_date NULL,   -- NULL ⇒ still a draft
                 created_by_suggest INTEGER,          -- «پیشنهاد بده» made it
                 manual_edits     INTEGER,           -- a hand touched it
                 created_at, updated_at
run_draft_stops  draft_id, order_id, seq
```

`manual_edits` is what makes «پیشنهاد بده» decidable:

> **A lane is empty iff `created_by_suggest = 1 AND manual_edits = 0`.**

The first hand-drag sets it, and **nothing sets it back**. That is the whole of the
"«پیشنهاد بده» fills only empty lanes" decision.

- [ ] **Step 1: Write the failing repo test**

```ts
it("a draft with either field missing is still a draft", () => {
  // driver set, no date  -> draft
  // date set, no driver  -> draft
  // both set            -> not a draft
});

it("the first hand-drag marks the lane, permanently", () => {
  const d = suggestLane(org, user);
  expect(isEmpty(d)).toBe(true);
  moveOrderToDraft(d.id, orderId);
  expect(isEmpty(d)).toBe(true);      // still 'empty' == never hand-touched? NO:
  // ... assert created_by_suggest === 1 && manual_edits === 1
  expect(shouldSuggestOver(d)).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/run-drafts-repo.test.ts`
Expected: FAIL — no such module.

- [ ] **Step 3: Create both tables**

Both carry `organization_id` explicitly (unlike spec 3's, which are reached through
`delivery_runs`) — a draft exists **before** it belongs to a run.

- [ ] **Step 4: Write `lib/repo/runDrafts.ts`**

Drafts are **yours alone** and live on the server, so closing the tab does not lose the
arranging. `user_id` scopes every read and write.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run tests/run-drafts-repo.test.ts
git add lib/db.ts lib/repo/runDrafts.ts tests/run-drafts-repo.test.ts
git commit -m "feat(runs): a draft is a proposed day that does not exist yet

Making something new is deliberate; changing something real is instant. A lane
## Task 18: The board — «بار مسیرها» and «پیش‌نویس‌های من», with the map beside

**Spec:** §5, §6, §7 · **Files:** `components/sales/DayLaneBoard.tsx`, `app/(shell)/sales/schedule/page.tsx`, delete `DaySplitPanel.tsx`, `OrderRouteBoard.tsx`, `RunPlanner.tsx`, `RunTimeline.tsx`, `DriverStreaks.tsx`

**What goes.** Five panels, and the reason for each is in the diagnosis:

- `DaySplitPanel` — raw HTML5 `draggable`, so it behaves unlike `/leads`, which uses the shared
  `useCardDrag` (Pointer Events, 6px travel threshold so a tap is not a drag)
- `OrderRouteBoard` — its own code says *"single-stop removal has no endpoint"*
- `RunPlanner` — only the schedule page imports it. **Verified**: `/leads` uses
  `LeadRunPlannerTabFlow`, and an earlier audit was misled by that substring
- `RunTimeline` + `DriverStreaks` — folded into Tasks 19–20, not simply dropped

**What replaces the dead end.** The board's empty state said «اول باید یک مسیر باز بسازید» —
*first create an open run* — while the only form for that was `RunPlanner`, at the top of the
page. So: scroll up, create, scroll down, drop. **A draft lane cannot be created empty.** A
lane comes into being when you drop the first order in, or when «پیشنهاد بده» builds it.
There is no "+ new day" button — which kills that dead end permanently, and means a draft
always contains at least one order.

**Privacy is one word.** The section header is **«پیش‌نویس‌های من»** — *my* drafts. First
person, so it needs no icon or tooltip. Underneath, one line:

> ◉ تا وقتی نسازی، هیچ‌کس جز تو این‌ها را نمی‌بیند.

**Empty states are statuses, not apologies.** No «سفارشی یافت نشد». The pool header reads
**«۰ سفارش آزاد»** and the runs move up to fill the page — Tuesday's work already done is not
a failure. Plus a **«برنامه‌ریزی هفتهٔ بعد»** prompt when the week is done.

- [ ] **Step 1: Write the failing component test**

```tsx
it("labels drafts as mine and never labels real runs", () => {
  render(<DayLaneBoard drafts={drafts} runs={runs} />);
  expect(screen.getByText("پیش‌نویس‌های من")).toBeTruthy();
  expect(screen.queryByText("واقعی")).toBeNull();   // normal states get no chip
});

it("offers no way to create an empty lane", () => {
  render(<DayLaneBoard drafts={drafts} runs={runs} />);
  expect(screen.queryByText(/روز جدید/)).toBeNull();
});

it("when the pool is empty, says so as a status", () => {
  render(<DayLaneBoard drafts={[]} runs={runs} poolCount={0} />);
  expect(screen.getByText("۰ سفارش آزاد")).toBeTruthy();
  expect(screen.queryByText("سفارشی یافت نشد")).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/day-lane-board.test.tsx`
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Build the board**

- **Left column — real runs** («بار مسیرها»), each with its timeline (Task 19)
- **Middle — «پیش‌نویس‌های من»**, dashed and dim, each with a per-lane commit button
- **Right — the map, beside the drafts** on a wide screen, stacked below on a narrow one

**Why the map moves up.** Geography is the whole reasoning behind splitting a day. Defaulting
to `/leads`' bottom placement would quietly choose the second aim (similarity) over the first
(UX): you would have to scroll past both sections, and your eyes would leave the lanes to use
it.

## Task 19: The timeline becomes «بار مسیرها» — and gains kilograms

**Spec:** §7 · **Files:** `components/sales/RunTimeline.tsx` (rebuilt in place), `lib/streak.ts`, `tests/run-timeline.test.tsx`

The timeline's shared axis is its whole value: **a column means "the 3rd stop in every van at
once."** That only works if all runs sit in one stack — split into separate cards and the
comparison dies. So «بار مسیرها» is **not** cards *plus* a timeline. It **is** the timeline.

**The real addition is kilograms.** The timeline was summing **toman** — money. But a van fills
by **weight**. So «۱۴ مهر · ۹۲۰ کیلو · ۶ از ۸» now sits under the driver's name.

> The number already exists: `DaySplitPanel` computed `laneKg` from the frozen `order_lines`.
> It just never reached this component.

**The legend now counts.** «برگشت خورد ۱» instead of a bare red dot — a refusal becomes a number
you can track rather than a colour you might miss. Plus the two UI improvements: ghost rings in
empty slots (a 6-stop lane beside an 8-stop one should not read as a shortage), and tighter
columns so 20 stops do not spread out and clip.

- [ ] **Step 1: Write the failing test**

```tsx
it("shows kilograms, not money", () => {
  render(<RunTimeline runs={runs} />);
  expect(screen.getByText(/۹۲۰ کیلو/)).toBeTruthy();
  expect(screen.queryByText(/تومان/)).toBeNull();
});

it("marks an unfinished lane with ghost rings, not blanks", () => {
  const { container } = render(<RunTimeline runs={[sixStop, eightStop]} />);
  expect(container.querySelectorAll("[data-ghost]").length).toBeGreaterThan(0);
});

it("counts the refusals in the legend", () => {
  render(<RunTimeline runs={runsWithARefusal} />);
  expect(screen.getByText("برگشت خورد ۱")).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/run-timeline.test.tsx`
Expected: FAIL — the component was deleted in Task 18.

- [ ] **Step 3: Rebuild `RunTimeline.tsx`**

Read `lib/streak.ts` for the existing grid maths and reuse it. Three changes: the `kg` measure
replacing `toman`; ghost rings for slots beyond a lane's length; counts in the legend.

- [ ] **Step 4: Wire `laneKg` through**

It came from the frozen `order_lines`, which `DaySplitPanel` read. That file is gone — move the
query to the server component that feeds the timeline.
## Task 20: The driver picker, the 14-week grid, and the hover pane

**Spec:** §7.3, §7.4, §8, §12 · **Files:** `components/sales/DriverPicker.tsx`, `components/sales/StopHoverPane.tsx`, `lib/repo/driverActivity.ts`, `lib/streak.ts`, `tests/driver-picker.test.tsx`, `tests/stop-hover-pane.test.tsx`

**«کارکرد رانندگان» becomes a decision input, not a report.** It moves into the driver picker,
where it answers *"who is actually loaded?"* — the question you ask when deciding whose van
this is.

**Fourteen columns, five states.** Twelve weeks back, **two weeks forward**. Verified in
`lib/streak.ts`: the window runs backwards from today, and the current week is **partial** —
filled from Saturday to today, with later days as hollow rings so the weekday rows stay aligned.

| | means | colour |
|---|---|---|
| delivered | darker means more stops | the existing ramp |
| **`pending`** | **a run exists, nothing recorded yet** | **amber** |
| nothing, past | did not work | sunk |
| nothing, future | not planned | hollow ring |
| **`planned`** | **future, already has a run** | **accent ring** |

**The amber cell is the fix.** `lib/repo/driverActivity.ts` fills a cell only when a delivery is
**recorded** — `status = 'delivered' AND delivered_at IS NOT NULL`. A driver who drove out this
morning and has not filed yet is **invisible**, and looks idle. Harmless in a report; harmful
the moment the grid decides who carries tomorrow.

**Six load bars plus the mean.** Fairness stops being a feeling. The reference line is **the
driver's own recent average**, not vehicle capacity — that is how the decision is actually made.
The mean **excludes the current partial week**, or an unfinished week drags it down and the bars
disagree with the grid beside them. And the two forward weeks mean fairness now covers
**tomorrow**: the accent-ringed cells show who is already loaded before you commit.

**The hover pane answers five things.** Weight (kg); the **leg distance** in km — the dot said
"4th stop" and never said *from where*; a mini map; payment in three layers using the real
labels from `lib/orderStateMachine.ts` («پرداخت‌نشده» / «بخشی پرداخت‌شده» / «تسویه‌شده») plus
the amounts received; and the customer's outstanding balance.

> **The balance needs an `orderVisibility`-style test.** It is another party's account data:
> the driver needs it to do the job, but as *their own customers*, never the whole book.
> `tests/api/scoping.test.ts` is the pattern.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows a driven-but-unfiled day as pending, not idle", () => {
  const { container } = render(<DriverWeekGrid driver={driverWithRunNoDeliveries} />);
  expect(container.querySelectorAll("[data-pending]").length).toBe(1);
});

it("shows two weeks ahead, and marks days that already have a run", () => {
  const { container } = render(<DriverWeekGrid driver={driver} />);
  expect(container.querySelectorAll("[data-col]").length).toBe(14);
  expect(container.querySelectorAll("[data-planned]").length).toBeGreaterThan(0);
});

it("the pane shows kg, the leg distance, and payment", () => {
  render(<StopHoverPane stop={stop} />);
  expect(screen.getByText(/ک.م/)).toBeTruthy();
  expect(screen.getByText(/از مقصد قبلی/)).toBeTruthy();
  expect(screen.getByText("بخشی پرداخت‌شده")).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify they fail**

Run: `npx vitest run tests/driver-picker.test.tsx tests/stop-hover-pane.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Extend `driverActivity.ts` for 14 columns and the two new states**
## Task 21: Record how long a run actually took, and show failed orders in the pool

**Spec:** spec 1 §13.2, §13.4 and §7.2 · **Files:** `lib/repo/routing.ts:343`, `lib/repo/dayPlan.ts:51`, `lib/repo/briefing.ts:170-180`

Two features that **never worked**, found by audit. Neither is caused by these specs; both are in
the way of the ones that are.

### `actual_duration_min` has no writer

`capacityLearning.ts:41` requires `planned_duration_min IS NOT NULL AND actual_duration_min IS
NOT NULL`, and **nothing in the app writes the second.** The only two writers in the repository
are `tests/capacity-learning-repo.test.ts:41` and `tests/routing-schema.test.ts:46`. So the
query returns **zero rows forever**, `learnCapacityFromRuns` returns `applied: 0` on every
refresh, and `resolvedCapacityFactorsFor` — read by `/sales/forecast` and the weather system —
always falls back to **factory defaults**.

> **The test passes by inserting the value by hand**, proving the function works on data the app
> cannot produce.

- [ ] **Step 1: Write the failing test**

```ts
it("a finished run records how long it actually took", () => {
  // start a run, complete it, read it back
  expect(actual_duration_min).toBeGreaterThan(0);
});

it("capacity learning then sees a row", () => {
  expect(applied).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/run-duration.test.ts`
Expected: FAIL — `actual_duration_min` is `null`.

- [ ] **Step 3: Write it when the run reaches its end state**

In `lib/repo/routing.ts`, wherever a run is closed:

```sql
UPDATE delivery_runs
   SET actual_duration_min = ?, updated_at = ?
 WHERE id = ? AND actual_duration_min IS NULL
```

The `IS NULL` guard makes it idempotent — a retried sync must not overwrite a real measurement.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run tests/run-duration.test.ts tests/capacity-learning-repo.test.ts
git add lib/repo/routing.ts tests/run-duration.test.ts
git commit -m "fix(capacity): a run records how long it actually took

actual_duration_min had no writer outside tests, so capacityLearning's WHERE
clause could never be satisfied. It has been returning zero rows on every refresh
since it was written, and /sales/forecast has been reading factory defaults.

The existing test passes because it inserts the value by hand -- which proves the
function works on data the app cannot produce."
```

### A failed order must show up in the pool

`DELIVERY_FAILED` already transitions back to `PLANNED` (`orderStateMachine.ts:104`), so a
failed order **re-enters planning by itself** — no code needed for that. What is missing is that
the rebuilt pool must **show** it.
## Final gate

Do not declare this work finished until all of these pass.

```bash
# 1. Type safety -- zero errors is a pass. ~2 min, so background it.
setsid nohup npx tsc --noEmit > /tmp/tsc.log 2>&1 &
# then poll:  tail -5 /tmp/tsc.log

# 2. The full suite -- ~14 min, 2,737 tests. NEVER in the foreground.
setsid nohup npx vitest run > /tmp/vitest.log 2>&1 &
# then poll:  tail -20 /tmp/vitest.log
```

**Interpreting the full run.** A report of **1–2 failures with these names is a PASS**:

| test | idle time | vs the 5 s budget |
|---|---|---|
| `tests/district-coverage.test.ts` — *"has no interior hole in the net"* | 3222 ms | 64% |
| `tests/api/routing-route.test.ts` — *"plans, commits and freezes"* | 3704 ms | 74% |
| `tests/routing-repo.test.ts` — *"builds a greedy plan ordered nearest-first from the depot"* | 1907 ms | 38% |

They do **real work** (a 9,576-cell point-in-polygon sweep; a full routing plan), so their cost
is intrinsic. Match on the **test name**, never on counts — the totals drift as work lands. A
failure whose name is **not** on this list is real.

Before believing any failure: `npx vitest run tests/<file>` — **more than once**, because a
borderline test gives a coin flip. **Do not raise the global timeout.**

**Always run this one too:**

```bash
npx vitest run tests/api/scoping.test.ts    # imports the photos route -> catches a sharp bump
```

**And the DRY claim, by hand — this is the whole point of Phase 2:**

```bash
grep -rn "distanceFn" --include=*.ts lib | grep -v "lib/routing/"
# must print nothing

grep -rn "twoOptOrder\|optimiseRemaining" --include=*.ts --include=*.tsx lib app components
# must print nothing

grep -rn "is_default_origin" --include=*.ts lib app components | grep -v "lib/routing/depot.ts\|lib/db.ts"
# must print nothing

grep -rn "lat 0, lng 0" --include=*.ts lib
# must print nothing
```

If any of those prints a line, the duplication this plan was written to end is still there.

---

## What this plan does not do

Stated so nothing is discovered by absence:

- **`next build` is never run**, so there is no bundle-size or page-data verification. Use
  `tsc --noEmit` plus the suite.
- **No Playwright smoke test** — it boots a browser and a dev server.
- **VROOM deployment is out of scope.** `VROOM_URL` stays unset, so `orderStops()` runs the
  greedy path and says so. Deploying a solver is its own piece of work.
- **VROOM pickup jobs are out of scope.** `buildVroomJob` emits deliveries only; extending it to
  `pickup`/`delivery` pairs is a change to tested glue.
- **`/leads` is not rewritten.** It keeps `LeadRunPlannerTabFlow` and its own day-splitting; it
  only starts calling the shared routing core.
- **No data migration of existing runs.** Old runs simply have no facility stops, which the
  union queries in Task 14 handle.

---

## Self-review

Run against the four specs, as a checklist:

**1. Spec coverage.** Every section of every spec maps to a task:

| spec | section | task |
|---|---|---|
| 2 | §4.1 lat/lng nullable | Task 1 |
| 2 | §4.1 hard-coded locations | Task 2 |
| 2 | §5–§7 kinds, icons, homes | Task 3 |
| 2 | §8–§9 picker, `/leads` control | Task 4 |
| 4 | §2 distance module | Task 5 |
| 4 | §4 `byOrigin` deleted | Task 6 |
| 4 | §4 clustering entry point | Task 7 |
| 4 | §3 VROOM the one orderer | Task 8 |
| 4 | §5 steps 5, 7 dead orderers, `depot.ts` | Task 9 |
| 3 | §1.4, §3.3 `deliverFromVan` wired | Task 10 |
| 3 | §3.1–3.2 two tables | Task 11 |
| 3 | §3.3, §6, §8 the unload | Task 12 |
| 3 | §7, §7.1 replacement, `RETURNED` | Task 13 |
| 3 | §9 sync, five readers | Task 14 |
| 3 | §5, §6 driver day | Task 15 |
| 1 | §14.1 drafts | Task 16 |
| 1 | §11 six views | Task 17 |
| 1 | §5–§7 the board | Task 18 |
| 1 | §7 the timeline | Task 19 |
| 1 | §7.3–§7.4, §8, §12 picker, grid, pane | Task 20 |
| 1 | §13.2, §7.2 duration, failed orders | Task 21 |

**No gaps.** Every section of all four specs has a task.

**2. Placeholder scan.** No "TBD", no "implement later", no "add appropriate error handling".
Two places deliberately instruct the engineer to **read the real signature first** —
`dayCapacity` (Task 6 Step 1), `clusterIntoDays` (Task 7 Step 1), `greedyAssign`/`solveVroom`
(Task 8 Step 1). Those are not placeholders: the plan cannot invent a signature, and a test
written against a guessed one passes vacuously. Each says *what* to read and *why*.

**3. Type consistency.** Names are used consistently across tasks:

| name | defined | used |
|---|---|---|
| `DistanceFn` | Task 5 | 6, 7, 8 |
| `DistanceQuality` / `qualityOf` | Task 5 | 7, 8 |
| `straightLine` | Task 5 | 6, 7, 8 |
| `isApproximate` | Task 5 (moved from `lib/routeOrder.ts`) | 6 |
| `splitIntoDays` → `{ days, quality }` | Task 7 | Phase 4 |
| `orderStops` → `{ order, quality, distance }` | Task 8 | 8 (Step 5) |
| `shouldReturn` | Task 12 | 12, 15 |
| `depotFor` / `lastLoadedFrom` | Task 9 (stub) → real in Phase 3 checkpoint | 12, 16 |
| `reconcileUnload` | Task 12 | 12, 15 |
| `facility_id` column | Task 1 (existing) | 11, 12 |
| `run_facility_stops.facility_id` | Task 11 | 9 (real query), 14 |

One deliberate mismatch, and it is the point: **`created_by_suggest` / `manual_edits`** are
asserted in Task 16 and consumed by `isEmpty` there. No later task reads them, because «پیشنهاد
بده» fills empty lanes entirely inside the draft repository — not from the UI.

**4. Scope.** One plan, not four, and the reasoning is recorded at the top: the four specs are a
**chain**, and splitting them would put spec 2's migration in one plan and spec 4's `depot.ts`
in another with a broken dependency between them. Each **phase** is separately shippable and
separately green, which is the granularity that matters for review gates.

**5. Verified `file:line` claims.** Every reference in the plan was checked against source by
reading the line. Two were wrong and are fixed:

- **`stop_count` is in `lib/delivery.ts:724`, not `lib/repo/deliveries.ts`.** Two files whose
  names differ by four characters and a directory. A **sixth** site was found while fixing it:
  `app/api/sales/runs/route.ts:16` runs the same count.
- **`UNIQUE (organization_id, slug)` is at `db.ts:227`,** not the `:197` area I first wrote.

Both were caught by re-reading every reference rather than trusting the sweep that produced it
— the same habit that caught the `dayCapacity.ts:237`/`:238` slip in the specs.

`dayPlan.ts:51` excludes orders that have a run (`NOT EXISTS (SELECT 1 FROM delivery_stops …)`).
A failed order's stop still exists, so it will **not** appear — and the planner never learns to
retry it.

- [ ] **Step 5: Write the failing test**

```ts
it("a failed order is plannable again, without manual rescue", () => {
  expect(pool.map((o) => o.id)).toContain(failedOrderId);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/day-plan.test.ts`
Expected: FAIL — the failed order is excluded by the `NOT EXISTS` clause.

- [ ] **Step 7: Include `DELIVERY_FAILED` orders, with the reason**

In `lib/repo/dayPlan.ts:51`, widen the exclusion so a **failed** order's stop does not hide it,
and carry the stop's `fail_reason_id` onto the card. `briefing.ts:170-180` already lists
yesterday's failures — the pool now agrees with it.

- [ ] **Step 8: Run and commit**

```bash
npx vitest run tests/day-plan.test.ts tests/orders-schema.test.ts
git add lib/repo/dayPlan.ts lib/repo/briefing.ts
git commit -m "fix(runs): a failed order returns to the pool where the planner can see it

DELIVERY_FAILED already transitions back to PLANNED, so a failed order re-enters
planning by itself. But dayPlan excluded any order with a stop, and a failed stop
still exists -- so the order was invisible and the planner never knew to retry it.

Going back to the pool is automatic; going back to the SAME van is a decision, so
the card shows the failure reason rather than re-planning it silently."
```

---

Read `lib/streak.ts:1-40` first — the window arithmetic is
`firstDay = end - (weeks * 7 - 1) * DAY`. **Going forward changes the sign of that arithmetic**;
derive it, do not guess it. Two weeks forward is what removes the need to judge by a 12-week
mean that an unfinished week drags down.

- [ ] **Step 4: Build the picker with the bars and the mean**

- [ ] **Step 5: Build the hover pane**

Three payment layers — label, amounts («۲۰٫۰ از ۵۵٫۲ میلیون»), colour. Use `PAYMENT_STATUS_LABEL`
rather than re-typing the words.

- [ ] **Step 6: Add the scoping test**

A driver sees their own customers' balances and no other tenant's.

- [ ] **Step 7: Run and commit**

```bash
npx vitest run tests/driver-picker.test.tsx tests/stop-hover-pane.test.tsx tests/api/scoping.test.ts
git add components/sales/DriverPicker.tsx components/sales/StopHoverPane.tsx lib/repo/driverActivity.ts lib/streak.ts tests/
git commit -m "feat(runs): performance becomes a decision input

کارکرد رانندگان stops being a report and moves into the driver picker, where it
answers 'who is loaded?' rather than reporting on the past.

Fourteen columns, five states: twelve weeks back and two forward. The amber cell is
the fix -- driverActivity fills a cell only for a RECORDED delivery, so a driver
who drove out and has not filed yet is invisible and looks idle. Harmless in a
report, harmful the moment the grid decides who carries tomorrow.

Six load bars plus the mean, excluding the current partial week -- an unfinished
week drags the average down and would disagree with the grid beside it.

The pane shows the leg distance in km, which the dot never did: it said '4th stop'
and never said from where."
```

---

- [ ] **Step 5: Run and commit**

```bash
npx vitest run tests/run-timeline.test.tsx tests/jalali.test.ts
git add components/sales/RunTimeline.tsx tests/run-timeline.test.tsx
git commit -m "feat(runs): the timeline counts kilograms, because a van fills by weight

It was summing toman -- money -- on the one graphic built to compare loads. The
number already existed as laneKg, computed from the frozen order_lines by
DaySplitPanel; it just never reached this component.

Ghost rings in the empty slots, so a 6-stop lane beside an 8-stop one reads as
finished rather than short. And the legend counts: 'برگشت خورد ۱' is a number you
can track, where a red dot is a colour you might miss."
```

---
**The commit button is per lane, and it is two states.** Filled driver + date → solid cyan
**«سفر را قطعی کن»**. Missing either → grey, disabled, and it says *why* in the next action
rather than counting the problem: «اول راننده و تاریخ را انتخاب کن». You **see** whether you can
commit; you do not read labels to find out.

- [ ] **Step 4: Use `useCardDrag`, never raw `draggable`**

One drag engine across both pages. This is the single most important line in this task: two
drag engines that feel different is a large part of why the page reads as unfinished.

- [ ] **Step 5: Delete the five components**

```bash
git rm components/sales/DaySplitPanel.tsx components/sales/OrderRouteBoard.tsx \
       components/sales/RunPlanner.tsx components/sales/RunTimeline.tsx \
       components/sales/DriverStreaks.tsx
```

Fix any remaining import. **Then verify the claim rather than trusting it:**

```bash
grep -rn "RunPlanner" --include=*.tsx --include=*.ts app components lib
```
Expect only `LeadRunPlanner*` names — those are `/leads`'s own components and stay.

- [ ] **Step 6: Run and commit**

```bash
npx tsc --noEmit
npx vitest run tests/day-lane-board.test.tsx tests/repo-boundary.test.ts
git add -A components/sales app/\(shell\)/sales/schedule/page.tsx tests/
git commit -m "feat(runs): drafts are mine, real runs are silent, and a lane cannot be empty

Five panels go. DaySplitPanel used raw HTML5 draggable while /leads used the shared
useCardDrag -- two engines, so the same gesture behaved two ways on one screen.
OrderRouteBoard's own code said 'single-stop removal has no endpoint'. RunPlanner
is imported only by the schedule page; /leads uses LeadRunPlannerTabFlow, and an
earlier audit was misled by that substring.

The dead end goes with them: the board said 'first create an open run' while the
only form for that sat at the top of the page. A lane now comes into being when
you drop the first order in, so there is no empty draft to look at.

'پیش‌نویش‌های من' says everything in one word. Real runs get no chip at all --
labelling the normal case makes the other state look like the deviation.

The map sits beside the drafts: geography is the reasoning behind splitting a day,
so the thing you judge with and the thing you judge should share a glance."
```

---
missing either a driver or a date is a draft, and there is no global commit button
-- so there is nothing to forget and nowhere to navigate back to.

manual_edits is what makes 'پیشنهاد بده' decidable: a lane is empty iff
created_by_suggest = 1 AND manual_edits = 0. The first hand-drag sets it and
nothing sets it back, which is the whole of 'fills only empty lanes'."
```

---

## Task 17: Six views, and its own storage key

**Spec:** §11 · **Files:** `lib/orderViews.ts`, `tests/order-views.test.ts`

Six of `/leads`'s eight transfer. **Two do not**, and the reason is that they are about lead
*status* and lead *potential*, which a confirmed order has neither of:

| view | label | why |
|---|---|---|
| `kanban` | کانبان | columns are built from lead status (new / called / visited). Confirmed unassigned orders all share one status → a single column. |
| `score` | امتیاز | ranks lead potential, volume, ease. An order has no such score. |

Kept: **compact · pocket · grid · table · batch · cluster**. `pocket` and `batch` are
*better* here — orders genuinely have receipts and invoices behind the card, and tick-boxes
for splitting across days is literally this page's job.

- [ ] **Step 1: Write the failing test**

```ts
it("offers exactly six views", () => {
  expect(ORDER_VIEWS.map((v) => v.key)).toEqual([
    "compact", "pocket", "grid", "table", "batch", "cluster",
  ]);
});

it("stores its choice under its own key, not the leads one", () => {
  // coverage_lead_view is what /leads uses. Reusing it means choosing «جدول» here
  // also switches /leads -- a bug you would blame on something else entirely.
  expect(readOrderView({} as never)).toBe("compact");
  // and writing here must not touch the leads key
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/order-views.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write `lib/orderViews.ts`**

Mirror `lib/leadViews.ts`'s shape, with its own storage key (`coverage_order_view`).

- [ ] **Step 4: Run and commit**

```bash
npx vitest run tests/order-views.test.ts tests/PoolViewToggle.test.ts
git add lib/orderViews.ts tests/order-views.test.ts
git commit -m "feat(runs): six views, not eight -- and its own storage key

کانبان's columns are built from lead status and امتیاز ranks lead potential. A
confirmed order has neither, so both were dropped rather than quietly re-labelled.

پ pocket and batch are better here than on /leads: orders have receipts behind the
card, and tick-boxes for splitting across days is this page's whole job.

The storage key is deliberately not coverage_lead_view."
```

---

- [ ] **Step 6: Run and commit**

```bash
npx vitest run tests/driver-facility-cards.test.tsx
git add components/driver/FacilityStopCards.tsx components/driver/UnloadTapFlow.tsx app/\(bare\)/driver/page.tsx tests/driver-facility-cards.test.tsx
git commit -m "feat(driver): a load and an unload, neither one a numbered stop

The unload is a destination, not a stop. As stop 3 it renumbers everything when
dragged, and the list would claim an order that is not real -- the same mistake as
showing a precise twelve-week grid that was only half real.

The sheet pre-fills every quantity; the driver confirms or corrects and never
computes. Multiple lines are first-class, because 'خراب ۵ کیلو' alongside
'تاریخ مصرف گذشته ۲ کارتن' is the real shape of the job."
```

---

## Phase 3 checkpoint

```bash
npx vitest run tests/facility-stops-schema.test.ts tests/van-stock.test.ts \
  tests/unload-repo.test.ts tests/return-replacement.test.ts tests/unload-sync.test.ts
npx tsc --noEmit
```

Then wire the stubbed query in `depot.ts`:

- [ ] Replace `lastLoadedFrom`'s `return null` stub with the real `run_facility_stops` query,
  which now has a table to read.

```bash
git add lib/routing/depot.ts
git commit -m "feat(routing): lastLoadedFrom reads real runs

The stub existed because run_facility_stops did not. The default for a new run is
the facility this driver last loaded from -- behaviour, not a setting, so it cannot
be forgotten to maintain and it follows the business when a second depot opens."
```

---
| `health.ts:260` | the per-stop rows |
| `health.ts:282` | `on_time_delivery` / `fill_rate` |
| `lib/repo/deliveries.ts` → **`lib/delivery.ts:724`** | `COUNT(ds.id) AS stop_count` |
| `app/api/sales/runs/route.ts:16` | the same count, for the API |

Each becomes a union of `delivery_stops` and `run_facility_stops`.

> **Note the file name.** `stop_count` is in `lib/delivery.ts`, **not**
> `lib/repo/deliveries.ts` — two different files whose names differ by four characters and a
> directory. Verified by grep, after a first draft of this plan cited the wrong one.

Each becomes a union of `delivery_stops` and `run_facility_stops`.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run tests/unload-sync.test.ts tests/offline-migration-realdata.test.ts tests/sync-schema.test.ts tests/capacity-learning-repo.test.ts
git add lib/repo/syncPull.ts lib/repo/briefing.ts lib/repo/capacityLearning.ts lib/repo/health.ts lib/repo/deliveries.ts tests/unload-sync.test.ts
git commit -m "feat(sync): send the driver the place he is going

syncPull pulled saved_locations but never facilities, so an offline bundle had no
address for any warehouse -- while this feature's whole premise is that the driver
must know where he is going. Two earlier specs claimed otherwise; both were wrong.

The reconciliation is idempotent on the same key as deliveries, because a retried
sync must converge rather than double-write the van's balance.

The five readers now count facility stops as stops; without this, run-duration
predictions get quietly worse the moment this lands."
```

---
it there, or the next flow will invent a second one.

- [ ] **Step 5: Note that failed orders re-enter on their own**

`DELIVERY_FAILED` already transitions to `PLANNED` (`:104`), so failed orders return to
planning **by themselves** — no code needed. What Phase 4 needs is a pool that *shows* them.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run tests/return-replacement.test.ts tests/order-pipeline-migration-realdata.test.ts
git add lib/orderStateMachine.ts lib/repo/stock.ts lib/delivery.ts tests/return-replacement.test.ts
git commit -m "feat(orders): a customer who refuses the goods stops owing for them

RETURNED has been a status with no writer -- in ORDER_STATUSES, in
TERMINAL_ORDER_STATUSES, and treated as terminal by syncMutations -- while
RETURN_IN likewise has none. This gives both their first writer.

Stock and order move in one transaction: a half-written return leaves goods
accounted for and a customer still charged. RETURNED is terminal, so retrying the
same goods to a customer who just refused them is not offered."
```

---
`WRITE_OFF`, `RETURN_IN` and `SAMPLE_OUT` are all in `MovementKind` (stock.ts:7-16) and
permitted by the CHECK (db.ts:2551-2553), but **nothing emits them for a van** — this is the
first implementation, so the first test.

- [ ] **Step 5: One transaction, or none**

```ts
db.exec("BEGIN IMMEDIATE");
try {
  // validate EVERY line against shouldReturn() before writing any of them
  // then write all, and insert the run_unload_lines rows
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}
```

**A half-written reconciliation is worse than none** — the van's balance would be wrong and
nothing would say so.

- [ ] **Step 6: Create the samples facility lazily**

```sql
INSERT OR IGNORE INTO facilities (slug, kind, name, organization_id, created_at, updated_at)
VALUES ('samples-given', 'other', 'نمونه‌های داده‌شده', ?, ?, ?)
```

`slug` is `UNIQUE (organization_id, slug)` (db.ts:227), so this is naturally idempotent per
tenant.

- [ ] **Step 7: Run and commit**

```bash
npx vitest run tests/unload-repo.test.ts tests/van-stock.test.ts
git add lib/repo/unload.ts lib/db.ts tests/unload-repo.test.ts
git commit -m "feat(stock): the return leg, as a reconciliation rather than a number

shouldComeBack = vanOnHand(van, product). No arithmetic: a failed delivery's
goods never left the van, so they are already in the balance, and adding a term
for them double-counts.

Multiple lines per unload are first-class -- 'خراب ۵ کیلو' alongside 'تاریخ مصرف
گذشته ۲ کارتن' is the real shape of the job. Declaring less than the balance
refuses and names the gap; every line is written in one transaction, because a
half-written reconciliation is worse than none.

Samples go to a real facility, one per org: every movement needs a destination or
the books do not balance. A sample earns no kilograms, so no commission --
structural, because commission is earned on deliveries and a disposition creates
none."
```

---

```sql
CREATE INDEX IF NOT EXISTS idx_run_facility_stops_run ON run_facility_stops(run_id, role);
CREATE INDEX IF NOT EXISTS idx_run_unload_lines_run ON run_unload_lines(run_id);
```

- [ ] **Step 4: Add the six dispositions as a CHECK**

```sql
disposition TEXT NOT NULL CHECK (disposition IN
  ('returned','damaged','expired','discarded','lost','sample'))
```

`damaged` and `expired` are **separate values writing the same `WRITE_OFF`** — "we broke it"
and "the supplier sent it expired" are different problems, and a manager watching the rates
needs to see which keeps happening.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run tests/facility-stops-schema.test.ts tests/deliveries-schema.test.ts
git add lib/db.ts tests/facility-stops-schema.test.ts
git commit -m "feat(routes): a route can start and end at a building

delivery_stops.order_id is NOT NULL and carries UNIQUE (run_id, order_id). The
obvious shortcut -- null the order_id and squeeze a facility in -- silently
switches that guard off, because SQLite treats NULLs as distinct. No error, just a
duplicate stop. So facility visits get their own table, and the schema test asserts
delivery_stops' guard still refuses a duplicate."
```

---
```

**A refused stop must not reach this block.** The existing `nothingTaken` branch should
already ensure that — verify it, do not assume it.

- [ ] **Step 4: Resolve the van facility id**

The delivery path needs the van's `facility_id`. Read it from the run's `vehicle_id` and go
through `createVanFacility`'s existing idempotency path, so registering one van twice cannot
split its stock across two balances.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run tests/van-stock.test.ts tests/deliveries-schema.test.ts
npx vitest run tests/routing-repo.test.ts tests/stock-schema.test.ts tests/ledger-schema.test.ts
```
Expected: PASS. A failure in the second command means something was reading a balance that
was previously always the loaded quantity — that is worth knowing, not suppressing.

- [ ] **Step 6: Type check and commit**

```bash
npx tsc --noEmit
git add lib/repo/vanStock.ts lib/delivery.ts tests/van-stock.test.ts
git commit -m "fix(stock): the van's balance was never maintained

deliverFromVan was defined at vanStock.ts:91 and called from nowhere in lib/ or
app/. Goods loaded in the morning and delivered at noon were never tracked as
having left the van, so there was no correct number to reconcile an unload against.

deliverFromVan fires when goods physically leave the van. A refused or skipped
delivery does NOT call it -- those goods never left, which is also why a refused
stop writes no deliveries row. Counting delivery rows instead of movement is what
made the first draft of the reconciliation formula over-count by exactly the
refused quantity."
```

---
        WHERE dr.organization_id = ? AND dr.driver_user_id = ? AND rfs.role = 'load'
        ORDER BY dr.run_date DESC, rfs.id DESC LIMIT 1`
    )
    .get(orgId, driverUserId) as { facility_id: number } | undefined;
  return row?.facility_id ?? null;
}
```

`lastLoadedFrom` reads `run_facility_stops`, which **Phase 3 creates**. Until then, return
`null` from a stub; the real query lands in Task 12.

- [ ] **Step 6: Point the origin readers at `depotFor`**

`lib/facilities.ts:66,82`, `lib/repo/coverageAnalytics.ts:106`, `lib/repo/vanStock.ts:133`,
`components/CoverageMap.tsx:1107`.

- [ ] **Step 7: Run the Phase 2 gate**

```bash
npx vitest run tests/routing-single-core.test.ts
npx tsc --noEmit
```
Expected: the grep test **PASSES** with zero offenders, and zero type errors.

- [ ] **Step 8: Commit**

```bash
git commit -am "refactor(routing): delete the two dead orderers, add depot.ts

lib/routeOrder.ts was 155 lines of correct, tested, uncalled code. twoOptOrder had
one caller, replaced in Task 8. Both are gone rather than kept as fallbacks, and
depot.ts is now the only reader of is_default_origin -- eleven call sites each
answering some form of that question is how the duplication started."
```

---

## Phase 2 checkpoint

Do not start Phase 3 until these are green:

```bash
npx vitest run tests/routing-single-core.test.ts tests/day-capacity.test.ts \
  tests/split-into-days.test.ts tests/order-stops.test.ts tests/leads-proposal.test.ts
npx tsc --noEmit
```

Then confirm the DRY claim by hand:

```bash
grep -rn "distanceFn" --include=*.ts lib | grep -v "lib/routing/"
# must print nothing
grep -rn "is_default_origin" --include=*.ts lib app components | grep -v "lib/routing/depot.ts\|lib/db.ts"
# must print nothing
```

---
  type DistanceFn,
  type DistanceQuality,
} from "./distance";
import type { LatLng } from "@/lib/geo";

export interface OrderableStop extends LatLng {
  id: string;
}

export type OrderQuality = "solver" | "greedy";

export interface OrderResult<T> {
  order: T[];
  quality: OrderQuality;
  distance: DistanceQuality;
}

/** The one orderer. VROOM when it is configured, greedy nearest-first when it is not --
 *  and the caller is told which happened. */
export async function orderStops<T extends OrderableStop>(
  stops: T[],
  origin: LatLng,
  opts: { distanceFn?: DistanceFn } = {}
): Promise<OrderResult<T>> {
  const fn = opts.distanceFn ?? straightLine;
  if (stops.length < 2) {
    return { order: stops.slice(), quality: "greedy", distance: qualityOf(fn) };
  }
  const solved = await solveSafely(stops, origin, fn);
  if (solved) return { order: solved, quality: "solver", distance: qualityOf(fn) };
  return {
    order: greedyAssign(stops, origin, fn),
    quality: "greedy",
    distance: qualityOf(fn),
  };
}
```

`solveSafely` reads `process.env.VROOM_URL` exactly as `vroom.ts:202` does today and returns
`null` when unset.

- [ ] **Step 5: Point `/leads` at it**

`app/(shell)/leads/hooks/useLeads.ts:205` currently reads:

```ts
function optimiseRun() { if (!runOrigin) return; updateRun(twoOptOrder(runLocations, runOrigin, false).map((l) => l.id)); toast("ترتیب مسیر بهینه شد.", "success"); }
```

Replace `twoOptOrder` with `await orderStops(...)`, and make the toast tell the truth:

```ts
toast(
  r.quality === "solver" ? "ترتیب مسیر بهینه شد." : "ترتیب مسیر با روش نزدیک‌ترین چیده شد.",
  "success"
);
```

**This visibly changes `/leads` output.** Intended — say so in the commit.

- [ ] **Step 6: Run the tests and commit**

Run: `npx vitest run tests/order-stops.test.ts` → PASS.

```bash
git add lib/routing/orderStops.ts app/\(shell\)/leads/hooks/useLeads.ts tests/order-stops.test.ts
git commit -m "feat(routing): one orderer, which says whether it ran

VROOM when VROOM_URL is set, greedy nearest-first when it is not -- and the
caller is told which happened. The variable is unset in dev, so today every run
silently falls back; a run ordered by the fallback must not look like one ordered
by the solver.

/leads output changes here, visibly. Real roads and a real solver produce
different routes, which is the point -- but it is announced rather than slipped in."
```

---

export interface SplitInput {
  stopsPerDay: number;
  origin: LatLng | null;
  /** The ONE distance. Omit it and you get the labelled straight line -- never a silent
   *  per-module default, which is what this module exists to prevent. */
  distanceFn?: DistanceFn;
}

export interface SplitPlan<T extends SplittableStop> {
  days: DayCluster<T>[];
  quality: DistanceQuality;
}

export function splitIntoDays<T extends SplittableStop>(
  stops: T[],
  input: SplitInput
): SplitPlan<T> {
  const fn = input.distanceFn ?? straightLine;
  const days = clusterIntoDays(
    stops,
    daysNeeded(stops.length, input.stopsPerDay),
    input.origin,
    fn
  );
  return { days, quality: qualityOf(fn) };
}
```

- [ ] **Step 5: Point `/leads` at it**

In `app/(shell)/leads/page.tsx:113`, replace the direct `clusterIntoDays(...)` call with
`splitIntoDays(...)`, reading `days` from the result. **The proposal output must be
identical** — this is a move, not a change. Verify by loading `/leads`, noting the proposed
days before and after.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/split-into-days.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/routing/splitIntoDays.ts lib/clusterDays.ts app/\(shell\)/leads/page.tsx tests/split-into-days.test.ts
git commit -m "refactor(routing): clustering gets one entry point

/leads clusters geographically and ?view=runs splits by capacity -- those stay two
functions, because they answer different questions. What they now share is the
mechanism: the wrapper owns the distance default so no caller can pick its own."
```

---

Remove the function at `:235-239`. Change the sort at `:164` from
`[...candidates].sort((a, b) => byOrigin(a, b, origin))` to:

```ts
const dist = distanceFn ?? straightLine;
const ordered = [...candidates].sort((a, b) => {
  const ax = locOf(a), bx = locOf(b);
  if (!ax && !bx) return 0;
  if (!ax) return 1;   // no location sorts LAST, never first as 0 would
  if (!bx) return -1;
  if (!origin) return 0;
  return dist(origin, ax) - dist(origin, bx);
});
```

An unlocatable order must not jump to the front — the same class of lie, one step removed.

- [ ] **Step 5: Re-point the signature**

Change it to `distanceFn?: DistanceFn` imported from `@/lib/routing/distance`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/day-capacity.test.ts tests/routing-single-core.test.ts`
Expected: `day-capacity` PASS; `routing-single-core` still fails listing `clusterDays.ts` and
`geo.ts` — correct, Tasks 7–8.

- [ ] **Step 7: Commit**

```bash
git add lib/dayCapacity.ts tests/day-capacity.test.ts
git commit -m "fix(routing): the pool was being sorted by raw degrees

dayCapacity.byOrigin used Math.hypot over latitude/longitude differences -- not
kilometres, not even haversine -- and ignored the distanceFn it was handed. That
ordering decides which day fills first, so «پیشنهاد بده» was laying out real
orders by a number that means nothing.

Unlocatable orders now sort last rather than as 0: a missing location must not
look like the nearest one."
```

---
export const straightLine: DistanceFn = distanceKm;

export function isApproximate(fn: DistanceFn): boolean {
  return fn === straightLine;
}

export function qualityOf(fn: DistanceFn): DistanceQuality {
  return isApproximate(fn) ? "straight-line" : "roads";
}
```

- [ ] **Step 4: Re-point `lib/routeOrder.ts` at the new home**

Replace `export type DistanceFn = ...` with
`import type { DistanceFn } from "@/lib/routing/distance";` and make `isApproximate` a
re-export. Do **not** delete the file yet — Task 8 removes it, once `optimiseRemaining`'s
behaviour has moved.

- [ ] **Step 5: Run again — expect fewer offenders, still failing**

Run: `npx vitest run tests/routing-single-core.test.ts`
Expected: FAIL listing `lib/clusterDays.ts`, `lib/geo.ts`, `lib/dayCapacity.ts`. Correct —
those are Tasks 6–8.

- [ ] **Step 6: Commit**

```bash
git add lib/routing/distance.ts lib/routeOrder.ts tests/routing-single-core.test.ts
git commit -m "feat(routing): one distance, and a test that keeps it that way

DistanceFn is declared once here and nowhere else. The grep test is the point:
this rule has been broken three times, so it needs to be checkable rather than
remembered. It fails now, listing the three modules still to migrate."
```

---
- The facility list is the primary path; «اینجا نیست؟ روی نقشه مشخص کن» sits under a divider.
- A facility with `lat === null` renders **disabled** with the label «هنوز مکان مشخص نیست» —
  it exists, but it cannot be given as a point.
- Reuse `LocationPinPicker` for the map path rather than writing a second map.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/PlacePicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire it into `/leads`**

In `app/(shell)/leads/page.tsx:195-240`, replace the dead «تعیین موقعیت» control with
`PlacePicker`, reading facilities from a server call and calling the existing
`savePin`-equivalent path for a map pick. Preserve the existing clearable chip.

- [ ] **Step 6: Type check and commit**

Run: `npx tsc --noEmit`
Expected: zero errors.

```bash
git add components/facilities/PlacePicker.tsx app/\(shell\)/leads/page.tsx tests/PlacePicker.test.tsx
git commit -m "feat(facilities): a working position control on /leads

LocationPinPicker existed and was imported, but «تعیین موقعیت» was a dead button
-- /leads bypassed SearchBox's clearable chip and had no way to pick a facility it
already owned.

One button, both paths inside: your facilities first, the map under a divider. Not
two buttons (the toolbar already has a sort and «انتخاب همه»), and not search-first
(ceremony at three facilities). A facility with no location is listed but
disabled, because it cannot yet be given as a point."
```

---

It exists, is nullable, and **is read by nothing**. Add to `lib/facilities.ts`:

```ts
/** The home of one person, if they have set one up. Null for most tenants -- a business
 *  whose drivers all start at the depot has no reason to enter a house. */
export function homeOf(orgId: number, username: string): FacilityRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM facilities
          WHERE organization_id = ? AND owner_username = ? AND kind = 'home'`
      )
      .get(orgId, username) as FacilityRow | undefined) ?? null
  );
}
```

- [ ] **Step 9: Run the test**

Run: `npx vitest run tests/facilities-schema.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/facilityTypes.ts lib/facilityIcons.ts lib/db.ts lib/facilities.ts components/facilityArt.ts tests/facilities-schema.test.ts
git commit -m "feat(facilities): nine kinds, and the icon is the person's choice

All eleven reads of facility.kind ask only 'which is the home base?' or 'which is
the depot?'. So the kinds are labels today, and the icon -- not the kind -- is what
a person scans.

The icon moving per-facility reverses the FACILITY_ART decision, and 'other' stops
being a copy of 'warehouse': unknown must not look like the most common known
thing."
```

---
Expected: FAIL — length is 3, and `factory` violates the CHECK.

- [ ] **Step 3: Widen the kind CHECK in all DDL copies, as in Task 1**

```sql
kind TEXT NOT NULL CHECK (kind IN ('warehouse','factory','van','home','office','shop','cold_storage','parking','other'))
```

- [ ] **Step 4: Update `lib/facilityTypes.ts`**

```ts
export const FACILITY_KINDS = [
  "warehouse", "factory", "van", "home", "office",
  "shop", "cold_storage", "parking", "other",
] as const;

export type FacilityKind = (typeof FACILITY_KINDS)[number];
```

**`van` was missing from this type while `vanStock.ts` inserted vans** — `FacilityRow` could
not describe a van.

- [ ] **Step 5: Add `icon_key` to the schema and the type**

```sql
icon_key TEXT,
```

```ts
export interface FacilityRow {
  // ...existing fields...
  icon_key: string | null;
}
```

---
In `lib/repo/vanStock.ts` around `:36`:

```ts
`INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, owner_username,
                         organization_id, created_at, updated_at)
 VALUES (?, 'van', ?, NULL, NULL, 0, NULL, ?, ?, ?)`
```

- [ ] **Step 6: Update tests that asserted the seeded slugs**

Run: `grep -rn 'home-pardis\|warehouse-bakeh' tests/ lib/ app/ components/`

Replace count-style assertions such as `["home-pardis","warehouse-bakeh"]` with
`expect(rows.n).toBe(0)`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/facilities-schema.test.ts tests/stock-schema.test.ts tests/batches-schema.test.ts`
Expected: pass. If a stock test now fails with «انبار تعریف نشده است», that is **correct new
behaviour** — the test must create a facility first.

- [ ] **Step 8: Commit**

```bash
git add lib/db.ts lib/repo/stock.ts lib/repo/vanStock.ts tests/
git commit -m "feat(facilities): no location is ever invented

Four sites, each verified by reading it: two seeded real addresses, an
auto-created «انبار» at 0,0, every van inserted at 0,0, and the NOT NULL
constraint that forced the last two.

stock.ts's auto-create was hiding a real requirement behind a fake row -- the
message it avoided is the message it now throws."
```

---

with

```sql
      lat REAL,
      lng REAL,
```

Verify: `grep -c 'lat REAL NOT NULL' lib/db.ts` → must be `0`.

- [ ] **Step 4: Widen the type**

In `lib/facilityTypes.ts`, change the row type:

```ts
export interface FacilityRow {
  // ...existing fields unchanged...
  lat: number | null;
  lng: number | null;
  // ...
}
```

- [ ] **Step 5: Fix the readers that assumed a number**

`npx tsc --noEmit` will name them. Known: `lib/facilities.ts:66,70,82`,
`lib/repo/coverageAnalytics.ts:106`, `components/CoverageMap.tsx:1107`.

The rule at each site: **a facility with no location cannot be an origin or a map pin.** Skip
it rather than substituting `0,0` — substituting is the bug this task removes.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/facilities-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Type check**

Run: `npx tsc --noEmit`  (background it if it exceeds 30s)
Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add lib/db.ts lib/facilityTypes.ts lib/facilities.ts lib/repo/coverageAnalytics.ts components/CoverageMap.tsx tests/facilities-schema.test.ts
git commit -m "feat(facilities): a place may exist before it is placed

lat/lng become nullable, so 'not placed yet' is a legal state instead of
something the code has to lie about with 0,0.

All three facilities DDL copies change: :223, :1824, :3686 are a migration chain,
not duplication. Fixing only the newest leaves the rebuild paths declaring NOT
NULL and the constraint returns on the next tenant bootstrap -- which is exactly
where it would have been discovered, on a fresh tenant, after this shipped."
```

---
- `lib/routeOrder.ts` — after its contents move to `lib/routing/`

---