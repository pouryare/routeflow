# Depot-derived features — design

Date: 2026-08-23
Status: approved feature set, pending spec review

The approved feature set built on the business's two sites — the Bakkeh
warehouse and the Pardis home base — now that they are real points on the map:
a foundation (F0), features 1–6 and 8–13, and the small items 14b–14e. Seventeen
work items, of which 14b is folded into feature 3 rather than built separately.

Features 7 (distance rings) and 14a (site-marker toggle) were considered and cut;
see §7. Feature 13 was re-scoped by a spike; see §9.

## Decisions taken before design

Three answers constrain everything below.

**Solo now, team later.** Nothing per-person appears in the UI. The sites table
carries a nullable owner column from the first migration so adding drivers later
is a settings screen rather than a schema change. The source workbook's
`همکاران` sheet is already provisioned for three salespeople and ten drivers, so
this is a near-term reality, not a hypothetical.

**Straight-line distance only.** Every distance in this document is haversine,
computed in-process by the existing `distanceKm`. No routing engine, no API key,
no external dependency, and it works offline — which matters for a PWA used in a
vehicle. The cost is precision: in Tehran a straight line understates drive
distance by roughly a factor of two.

*This is a labelling obligation, not just a caveat.* Any figure derived from a
straight line must be rendered next to the words `خط مستقیم`, and must never be
formatted as a duration. A number the reader mistakes for drive time produces
worse decisions than no number at all.

The existing planner route line still calls `router.project-osrm.org` (the public
OSRM demo server) to draw its polyline. That is out of scope here, but it is a
production dependency on a demo service whose usage policy prohibits exactly this
— worth a separate decision later.

**The user manages sites.** This promotes the sites editor from the last item on
the list to the foundation everything else reads from.

## 1. The spine

Four shared pieces carry most of the work. Building them once, in
the right place, is most of the design work; the features themselves are then
small.

### 1.1 `facilities` table (F0)

Replaces the `FACILITIES` constant in `lib/facilities.ts`.

```
facilities
  id                INTEGER PK
  slug              TEXT UNIQUE NOT NULL   -- stable seed key
  kind              TEXT NOT NULL          -- 'warehouse' | 'home_base' | 'other'
  name              TEXT NOT NULL
  address           TEXT
  lat               REAL NOT NULL
  lng               REAL NOT NULL
  maps_url          TEXT
  notes             TEXT
  is_default_origin INTEGER NOT NULL DEFAULT 0
  owner_username    TEXT                   -- NULL = shared by everyone
  created_at        TEXT NOT NULL
  updated_at        TEXT NOT NULL
```

`owner_username` is the entire "team later" seam. Nothing reads it in this
round; `resolveOrigin` (§1.2) is written to filter on it so that turning the
feature on later is a query change, not a redesign.

Seeding is idempotent and keyed on `slug`: on first boot, insert the two current
sites if their slugs are absent. Re-running the migration, restoring a backup, or
deploying twice must not duplicate or overwrite user edits.

`updated_at` drives the ETag signature exactly as `saved_locations.updated_at`
already does in `app/api/locations/route.ts`. Without a column that changes on
UPDATE, a pin move would leave the cache signature untouched and the client would
serve a stale position from a 304.

**`is_default_origin` is enforced in the write path, not by an index.** The PATCH
handler clears the flag on all other rows inside the same transaction. A partial
unique index is the textbook answer but SQLite's are easy to get subtly wrong
across the rebuild migrations this schema already performs, and the invariant is
cheap to hold in one handler.

`lib/facilities.ts` keeps its current exported surface — `homeBase()`,
`mainWarehouse()`, `FACILITY_COLOR`, `FACILITY_LABEL`. Only the bodies change,
from array lookups to queries. Every existing call site is untouched, which is
what keeps F0 from sprawling.

API mirrors `/api/locations` — `GET/POST /api/facilities`,
`PATCH/DELETE /api/facilities/[id]` — because that route's shape, ETag handling
and error contract are already proven in this codebase. (`/api/locations` carries
no rate limiting; neither does this. Both sit behind the session cookie.)

The map page reads facilities server-side alongside districts and customers in
`app/page.tsx`, so they arrive in the first paint with no extra round trip.

### 1.2 Origin resolution

Eight features measure distance *from somewhere*. That somewhere is defined
once:

```ts
type OriginSource = "override" | "gps" | "facility" | "first_stop";
interface Origin { lat: number; lng: number; label: string; source: OriginSource; }
```

Precedence, highest first: an explicit per-day override, a live GPS fix, the
facility flagged `is_default_origin`, the first stop in the list.

Two resolvers, one rule: `useOrigin()` for client pages (planner), and
`defaultOrigin(db)` for server reads (report, analytics). The `first_stop`
fallback exists only so a day with no default configured still renders; it is
the current behaviour and is what feature 1 exists to stop relying on.

**The map is the exception, deliberately.** Feature 8 colours customers by
distance, and feature 14c prints distances in the detail panel. Both resolve to
the default-origin *facility* only — never to GPS. Letting a live position feed
them would repaint the whole map as the user drives and change a customer's
printed distance between two glances at the same panel. Those readings describe
the customer relative to the business, not relative to wherever the phone
currently is.

### 1.3 Pure geometry helpers

All additive to `lib/geo.ts`, all pure, all unit-testable without a DOM. This is
where the shared work between features concentrates.

| Helper | Serves |
|---|---|
| `distanceToSegmentKm(p, a, b)` | 3 (corridor band), 5 (restock detection) |
| `routeLengthKm(origin, stops, returnToOrigin)` | 2, 4, 6 |
| `twoOptOrder(stops, origin, returnToOrigin)` | 6 |
| `centroidOf(geometry)` | 10, and 3 via cached centroids |

`distanceToSegmentKm` treats the segment as planar. Over 28 km at Tehran's
latitude the error against a band measured in kilometres is metres — no
projection library is warranted.

### 1.4 District centroids

Nothing computes a district's centre today. `lib/districtGeometry.ts` already
owns geometry server-side, is version-stamped, and is cached indefinitely by the
client — which makes it the correct home. Centroids are computed once per
geometry version and shipped on `DistrictProperties`.

**This is why 10 is sequenced before 3.** Built in that order, the corridor gets
its district centres for free. Reversed, feature 3 computes the same numbers a
second time on the client, on every map load.

## 2. Planner and routing

### Feature 1 — planner starts from the default origin

`app/planner/page.tsx:192` falls back to the *first stop* when no GPS fix exists,
which is the normal case when planning the next day indoors. Every distance
figure and the whole stop order derive from an arbitrary point.

Replace `myPos` with a resolved `Origin` in `orderedStops`, `routeUrl` and
`routeStops`. Always on, no toggle — but the active origin must be visible and
overridable: a chip above the stop list reading `مبدأ: خانه (انبار کوچک)`,
tapping it offers GPS or any site for that day only.

### Feature 2 — return to origin

Appends the origin as a final waypoint so the day's total answers "how long is my
day". Toggle in the day header (`بازگشت به مبدأ`), localStorage-persisted under
`coverage_return_to_origin`, matching `coverage_precision`. Default on.

**Google's share-link format caps waypoints at ten.** With the return leg a long
day can silently exceed it and lose stops. The deep-link builder must detect the
overflow and warn in the UI rather than emit a truncated route.

### Feature 4 — load at home or at the warehouse

Runs `routeLengthKm` twice — origin-direct versus origin-via-warehouse — and
states the delta as one always-on line in the day summary
(`بارگیری از انبار مرکزی: +۱۲ کیلومتر`). `--warn` when it costs, `--good` when it
saves; it is a cost reading, which is what those tokens mean.

### Feature 6 — 2-opt stop ordering

Greedy nearest-neighbour reliably leaves crossings. A 2-opt pass typically
shortens a six-to-ten stop day by 5–15%.

**The stop list has manual reorder arrows writing `sort_order`. A live optimiser
would silently discard manual edits.** So it is explicitly not live: a
`مرتب‌سازی خودکار` button applies the improved order once and reports the win
(`۷٪ کوتاه‌تر`). Manual edits afterwards persist until the button is pressed
again.

Quadratic per pass, which is free at real stop counts.

### Feature 5 — restock on the way past

Runs `distanceToSegmentKm` against each consecutive stop pair. Within 3 km,
renders an inline hint *between the two stops it concerns* with an
`افزودن توقف` button that inserts the warehouse at that index.

Threshold fixed at 3 km, deliberately not configurable. There is no evidence yet
about the right number; a setting would invite tuning a value nobody can justify.
Revisit after observing it fire.

## 3. Corridor (feature 3)

The highest-value item. The Pardis↔Bakkeh leg is driven regularly and nothing in
the app knows the line exists.

A map layer behind a sidebar toggle (`کریدور بین انبارها`) under the sites
section. When on: a translucent band along the segment, every lead and
`needs_coverage` district whose centroid falls inside it raised to full strength,
everything else dimmed. Width as three chips — `۲ / ۵ / ۱۰ کیلومتر` — not a
slider, which is unusable one-handed in a moving vehicle.

Feature 14b (a dashed supply line between the sites) is folded in here rather
than built separately; it is what makes the band read as a corridor.

With three or more sites a pair selector appears. With two it is implied and no
control is shown.

## 4. Analysis

### Feature 8 — colour customers by distance from origin

A fifth `CustomerColorMode`. One function beside `inactivityColor`, one entry in
the mode array, one legend branch.

**The mode switcher is four equal buttons in a narrow sidebar; a fifth does not
fit at phone width.** It becomes a two-row grid. This is a small change to the
most-used control on the page and needs care.

The legend currently explains district colours only. It must render distance
bands when this mode is active or the map is unreadable.

*Colour tension, resolved:* MASTER.md says a colour means one thing, yet
`inactivityColor` already maps `--good/--warn/--crit` onto a non-status quantity.
Distance is a cost reading, so the same reuse is consistent with existing
precedent. A dedicated sequential ramp would be better data visualisation but
introduces a second colour language on the same markers. Following precedent.

### Feature 10 — coverage gaps nearest first

A sort control on `/report`, not a feature: `نزدیک‌ترین` / `الفبا`. The map
sidebar has no district list, so there is nowhere else it belongs. Depends on
§1.4.

### Feature 9 — cost to serve

A section on the existing `/analytics` dashboard. Sortable table — customer,
distance from origin, revenue in window, revenue per km, below-threshold flag —
wired to the existing `CsvExportButton`.

One setting: cost per km, a numeric input persisted to localStorage. It has no
defensible default, so until a value is entered the table shows the raw ratio
rather than inventing one.

**Data risk, must be surfaced in the UI:** `sales` joins to customers on
`customer_name` as free text, not on an id. Any renamed or differently-spelled
business silently drops out. The section renders a
`N ردیف فروش با هیچ مشتری تطبیق نشد` line so the gap is visible and fixable
rather than quietly wrong.

### Feature 14d — distance in exports

Two columns, nearest site and km, in the CSV export and `/report`.

## 5. Field operations

### Feature 11 — geofence the sites

Extends `GeofenceWatcher` from customers to sites. Arriving at the warehouse
offers to log a restock; leaving home offers to start the day's route. Radius
250 m for a yard against the 150 m used for a shopfront.

A sub-option under the existing `ثبت خودکار بازدید (GPS)` switch, not an
independent toggle — same permission, same watcher, same battery cost.

**Migration required.** `activity_log.entity_type` carries
`CHECK (entity_type IN ('district','customer'))` and SQLite cannot alter a CHECK.
Adding `'facility'` needs the table-rebuild sequence `saved_locations` already
performs in `lib/db.ts:170`. The pattern exists to copy; it is not a one-line
change.

### Feature 12 — day start/end, hours and km

Records departure from and return to the origin, producing real working hours and
distance per day. A compact `امروز` strip on the planner; history on
`/analytics`. Depends on 11.

**Flagged, and accepted for solo use.** The moment a second person uses this, it
logs an employee's movements and working hours. That is a consent question, not a
technical one, and is far cheaper to decide before the data exists. Recorded here
so the decision is deliberate rather than inherited.

## 6. Small items

- **14c** — one mono line in `CustomerDetailPanel`:
  `۱۸ کیلومتر تا خانه · ۳۱ تا انبار مرکزی`. No controls. Cheapest useful item.
- **14e** — site markers on `PlannerRouteMap`, reusing the existing icon
  factory. The planner map currently draws the route but not the sites, so the
  origin is invisible on the very map that routes from it.

## 7. Cut

**Feature 7, distance rings.** Rings put information in the air above the map;
feature 8 puts the same information on the customers being decided about. 8
supersedes it.

**Feature 14a, site-marker toggle.** Two markers among 135 customers are not
clutter. A control to manage a problem that does not exist.

## 8. Sequencing

Six stages, each independently shippable and each leaving the app in a good
state. Ordering is driven by the dependency graph in §1, not by feature value.

| Stage | Contents | Rationale |
|---|---|---|
| 1 | F0, 14e, 14c | Foundation, then two trivial consumers that prove the read path end-to-end |
| 2 | 1, 2, 4, 6 | Origin resolution and everything that measures from it |
| 3 | 10, 3 (+14b), 5 | Centroids before the corridor; the corridor's helper before restock |
| 4 | 8, 14d, 9 | Analysis, cheapest first |
| 5 | 11, 12 | Geofence and the activity-log migration, then the day log on top |
| 6 | 13a | Stock, after the spike's re-scope |

## 9. Feature 13, re-scoped by spike

The original framing — "which SKU is at which site" — assumed per-site stock
data. Reading `سیستم فروش و انبار.xlsx` shows that assumption is wrong, and the
correct feature is different and smaller.

**What the workbook actually has:**

- `کالاها` — a real product catalogue: SKU id, category, name, base unit
  (`عدد`/`کیلوگرم`), min-stock alert threshold, average cost, kg per base unit.
  Plus a packagings sub-table mapping each purchase/sale unit to a base-unit
  quantity. Currently four products, four packagings.
- `موجودی انبار` — live stock, fully computed from `خرید` and `فروش`: total in,
  total out, current stock, threshold, status, recent weekly average, reorder
  suggestion. **One global number per SKU. There is no per-site dimension
  anywhere in the workbook.**

Neither sheet is imported today; `lib/importExcel.ts` reads only `مخاطبین` and
`فروش`.

**13a — stock-versus-demand check. Build this.** Import `کالاها` and
`موجودی انبار`. The planner then answers a question that matters daily: do
tomorrow's stops need more of a product than exists? `NMA-ANM` currently sits at
zero against a threshold of 1,200. Uses data that is already maintained and
already correct, and needs no new data entry.

**13b — per-site stock split. Do not build.** The dimension does not exist and
would have to be created by daily manual entry ("what did I load at home this
morning"). That is a recurring cost on the user for a benefit that only appears
when a product is at one site and not the other — which, across four SKUs, is
close to never. Revisit if the catalogue grows substantially or the situation
actually bites.

## 10. Testing

The bulk of the risk is in pure functions, which is where the tests go —
consistent with the existing suite (126 tests, mostly over `lib/`).

- **Geometry (§1.3)** — unit tests per helper. `distanceToSegmentKm` against
  hand-computed cases including the two degenerate ones (projection falling
  beyond either endpoint). `twoOptOrder` asserted to never return a longer route
  than its input, over randomised stop sets.
- **Origin resolution (§1.2)** — a table test over all four precedence levels.
- **`facilities`** — seed idempotency (run the migration twice, assert two rows),
  and the single-default-origin invariant across a PATCH that moves the flag.
- **Import (13a)** — fixture-driven, matching the existing `importExcel` tests.
- **UI** — no new framework. The existing Playwright usage is ad hoc; the map
  layers get a smoke check that markers and layers render without console errors,
  which is what caught the white-popup cascade bug.

## 11. Open risks

| Risk | Where | Handling |
|---|---|---|
| Straight-line read as drive time | 3, 4, 8, 9, 14c, 14d | Mandatory `خط مستقیم` labelling; never format as duration |
| Google waypoint cap silently truncating | 2 | Detect overflow, warn in UI |
| `sales` ↔ customer joined on free text | 9 | Surface unmatched-row count in the section |
| `activity_log` CHECK constraint | 11 | Table-rebuild migration, pattern at `lib/db.ts:170` |
| Auto-order discarding manual edits | 6 | Explicit button, never live |
| Location logging becoming employee monitoring | 12 | Flagged; accepted for solo use, revisit before team rollout |
| OSRM demo server as a production dependency | pre-existing | Out of scope, needs its own decision |
