# Mixed-route day planning — design

**Date:** 2026-10-03
**Status:** approved
**Surfaces:** `/sales/schedule?view=runs` (the planning board), `/leads` (unchanged as a page),
`/driver` (the driver's day), the order form
**Baseline:** the leads page's section structure and hand-over flow, copied for orders

---

## Why

A person who drives for this company is one person in one van on one loop. They deliver
goods, revisit an old shop to collect an order, and walk into a restaurant nobody called.
That is one working day. The app models it as two, because two unrelated tables hold it:

| | delivery | lead |
|---|---|---|
| tables | `delivery_runs` + `delivery_stops` | `lead_runs` + `lead_run_stops` |
| a stop is | an `orders` row | a `saved_locations` pin |
| assigned on | `?view=runs`, by drag-and-drop | `/leads`, by a four-step wizard |
| `UNIQUE (driver_user_id, run_date)` | yes | yes — **independently** |
| read by | 22 files | 3 |
| **synced offline** | **yes** (`lib/repo/syncPull.ts:86-111`) | **no** |

Three consequences, in ascending order of how much they cost:

1. **A driver can hold two runs on one day** and nothing notices. The two uniqueness
   constraints do not talk to each other.
2. **The offline driver is blind to visits.** `syncPull` carries `delivery_runs`,
   `delivery_stops` and their orders. A field rep with no signal sees deliveries and no
   prospect work at all.
3. **The manager assigns on two pages**, so the day's real load is invisible while it is
   being built. `/leads` says "Reza, Tuesday, 8 visits"; `?view=runs` says "Reza, Tuesday,
   6 deliveries". Neither is lying. Both are incomplete.

`lib/driverDay.ts` already decided the principle — `// Both, or neither.` — and `/driver`
already renders both sections. **The unification is half-built on the driver's side and
unbuilt on the manager's.** This spec finishes it.

### What this spec is not

It is **not** a merge of the two pages. `/leads` stays the leads page and `?view=runs` stays
the orders board; a manager hunts leads and a dispatcher loads vans, and those are different
jobs with different pools. Merging the pages would put two subjects on one screen, and a page
gets long when it has two subjects rather than one. What merges is the **route** and the
**day** — the things a driver experiences as a single thing.

---

## The decisions this rests on

Settled across six rounds of questions; each is load-bearing later.

| Decision | Value |
|---|---|
| Pages | Two stay separate. The leads page's *sections* become the UI for order routing |
| Merge depth | **Route and day only.** One run holds orders + pins + revisits; one ordered list |
| The uncommitted word | **«در اولین فرصت»** — a label meaning "not yet committed", NOT a queue |
| Capacity | stops / weight / volume, chosen per run — **already on `vehicles`** |
| Splitting | fills the *remaining* capacity of days that already have runs |
| An order with no coordinates | **blocks** the split; place it by hand first |
| Distance | four anchors offered; real roads (OSRM) with a straight-line fallback; plus optimise |
| Access | sales manager, owner, platform_owner. `phone_sales` may only add orders |
| Driver day | one interleaved list, plus a "my planned week" |
| Optimise on a live run | reorders **only what is left** |
| Commission | unchanged. Only deliveries earn |
| Van stock | **in scope.** A van is a smaller inventory fed warehouse → van |
| Field order | a driver may place an order on the spot; the driver sees their own orders |
| "Customer says next week" | driver picks a week offset **or** a specific date; never forgotten |

---

## Architecture

**Approach B: one run, two stop tables.** `lead_runs` is retired. `delivery_runs` gains a
`kind`. Stops stay in two tables, both keyed to `delivery_runs.id`.

```sql
-- delivery_runs gains one column
ALTER TABLE delivery_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'delivery_only'
  CHECK (kind IN ('delivery_only', 'mixed'));

-- lead_run_stops is re-pointed at delivery_runs; lead_runs is emptied then dropped
-- (order_id stays NOT NULL on delivery_stops — no rebuild, no integrity hole)
```

Why this and not one stop table:

- **No existing reader changes.** Every query reading `delivery_stops` keeps working, because
  a delivery stop is still exactly what it was. `delivery_stops` is INSERTed in exactly one
  place (`lib/delivery.ts:147`), and `order_id` keeps its `NOT NULL`.
- **No guarded rebuild.** Adding a nullable `location_id` to `delivery_stops` (the
  one-stop-table alternative) would require dropping `order_id NOT NULL`, and SQLite cannot
  `ALTER` a CHECK — it needs the rebuild-and-copy dance at `lib/db.ts:236-268`. Every reader
  would then have to handle a stop with no order.
- **It is honest about the two kinds of stop.** A delivery has an order and earns commission.
  A visit has a pin and a next-action. They share a *day and a driving order*, which is what
  is physically true, without pretending they are the same row.

Rejected: **one stop table** (above), and **keep both tables + a union view** — which is
cheapest but leaves the driver with two runs and no offline visits, i.e. it does not fix the
problem this spec exists to solve.
### Modules

Each one has one job and can be read alone.

| Module | Job |
|---|---|
| `lib/runKinds.ts` | **pure.** Is this stop a delivery, a visit, or a new pin? What icon, what does tapping it do, does it earn commission? No I/O. |
| `lib/dayCapacity.ts` | **pure.** Three limits → remaining room on a day; does this stop fit; split proposals that fill existing runs before creating new ones. |
| `lib/routeOrder.ts` | **pure.** Order a day's stops by drive sequence. Distance function injected, so OSRM and straight-line are interchangeable and both testable. |
| `lib/vanStock.ts` | Load a van (`TRANSFER_OUT` + `TRANSFER_IN`), what is on it, what can be delivered from it. |
| `lib/repo/mixedRuns.ts` | Reads one run with both kinds of stop, interleaved by `sort_order`. The only place that knows a run has two stop tables. |
| `components/board/RouteColumn.tsx` | A run's column: both kinds of stop, ordered. |
| `components/board/DaySplitPanel.tsx` | The split proposal, capacity-aware. Mirrors `RouteSection`. |
| `components/driver/AddStopSheet.tsx` | Add-a-pin and place-an-order, on the spot. |

The pure modules are the point. This repo has **no component tests** — no `.test.tsx`, no
testing-library — so a rule that only exists inside a component is a rule nobody can assert.
Everything worth asserting lives in one of the four `lib/` files above.

---

## Data model

### 1. A run has a kind

`delivery_runs.kind` — `delivery_only` or `mixed`. Present so the manager's board and the
driver's list can tell "this day is deliveries only" from "this day is mixed" without a
second query. Existing rows default to `delivery_only`, which is correct for all of them.

### 2. One uniqueness constraint, finally

`lead_runs` is retired. `delivery_runs` keeps its `UNIQUE (driver_user_id, run_date)`, and now
it is the **only** one. One driver, one day, one run — so a driver can no longer hold a
delivery run and a lead run on the same date.

Migration: for each `lead_runs` row, find-or-create the `delivery_runs` row for that
`driver_user_id` + `run_date`, set its `kind` to `mixed`, and re-point its stops. Then
`lead_run_stops.run_id` is rewritten to the delivery run's id and `lead_runs` is dropped.
Reversible: the mapping is asserted by the migration test, and nothing is destroyed until the
new path has been exercised.

### 3. `orders` grows a requested day

```sql
ALTER TABLE orders ADD COLUMN requested_day TEXT;        -- ISO, null = «در اولین فرصت»
ALTER TABLE orders ADD COLUMN requested_kind TEXT         -- 'soonest' | 'week_offset' | 'exact_date'
  CHECK (requested_kind IN ('soonest', 'week_offset', 'exact_date'));
```

`requested_day IS NULL` **is** «در اولین فرصت». There is no boolean flag and no separate
queue: the label is the absence of a day, and the split fills days from what has none.

`requested_kind` exists because the driver was offered **both** a week offset and a specific
date. A week offset is stored as the concrete date it resolves to, and `requested_kind`
remembers which was chosen, so the card can say «هفتهٔ بعد» rather than a date the driver did
not pick.

### 4. A van is a facility

```sql
-- facilities.kind CHECK gains 'van' — needs a guarded rebuild (db.ts:236-268 pattern)
-- vehicles gains a nullable link
ALTER TABLE vehicles ADD COLUMN facility_id INTEGER REFERENCES facilities(id);
```

A van is a **smaller inventory**, exactly as the business describes it: goods move
`TRANSFER_OUT` at the warehouse and `TRANSFER_IN` at the van, and both movement kinds already
exist (`lib/repo/stock.ts:417-418`). Once a van is a facility, per-van on-hand is the existing
`onHand(orgId, { facility_id })` — **no new stock arithmetic**, and `DELIVERY_OUT` lands on the
van instead of decrementing the warehouse a second time.

---

## Day assignment

`requested_day` set, or null. That is the whole model.

- **Unchanged freely, with undo.** A day is a plan, not a commitment, until the run is frozen —
  and there is already a freeze mechanism for delivery runs (`runsNeedingFreeze` /
  `freezeRun`, `lib/repo/routing.ts:377,402`) with a per-weekday `cutoff_time` and a `'ready'`
  status.
- **Freeze is now one rule for both kinds.** A frozen run locks orders and visits alike,
  because the thing being promised is *the driver's day*, and a day cannot be half-promised.
  `freezeRun` currently moves every stop's order to `READY`; a mixed run's pin stops have no
  order to move, so the freeze pins their `sort_order` instead.
- **«در اولین فرصت» orders are the split's raw material.** Not a queue, not auto-assigned —
  they are simply the orders the manager has not yet committed to a day.

Where the day is set: **both** — the order form, and a day picker on the board card.

---

## Splitting, distance, and capacity

### Capacity comes from `vehicles`

```sql
max_stops INTEGER, max_weight_kg REAL, max_volume_m3 REAL   -- lib/db.ts:2320
```

All three already exist and nothing reads them for splitting. **No new schema.** Which limit
binds is a per-run choice; the manager picks stops, weight, or volume when they plan, and
`lib/dayCapacity.ts` reduces it to a single "is there room" number.

### The split fills before it creates

The proposal fills the **remaining** capacity of days that already have runs, and only
proposes a new day when every existing one is full. Splitting 30 unplaced orders therefore
cannot pile more work onto a day that already has 20 — which the naive version would.

Pinned orders are **frozen and seeds**: an order with a `requested_day` is not moved by the
split, and it seeds the clustering so the rest fit around it. `clusterIntoDays` already takes
`seeds` and a `distanceFn`, so this is a call-site change, not a rewrite.

**A no-coordinate order blocks the split.** `customers.lat/lng` can be null, and an order that
cannot be placed is not a proposal — the split refuses and names the order, because silently
dropping it is how work disappears.

### Distance: real roads, straight-line fallback

Four anchors: the depot, the driver's location, the previous stop, and a chosen point.
`fetchOsrmTable` (`lib/routing/osrmMatrix`) is already used by `/leads` via `useRouteMatrix`;
it is capped at 100 points and needs the network.

The fallback is not a degraded mode, it is the **default**: `lib/routeOrder.ts` takes its
distance function as a parameter, so OSRM and `distanceKm` are interchangeable and the tests
run on the offline one. When OSRM fails, the app says the numbers are straight-line rather
than quietly showing a worse answer as if it were the real one.

### Optimise

A visual sort **and** an optimise button that reports the day's total km. Reordering writes
`sort_order`. On a **live** run it reorders **only the stops that are not done** — completed
stops are fixed, and the remaining ones are sequenced from wherever the driver actually is.

---

## The two manager pages

Each page keeps its own pool and its own stops. Each shows the other's **count**, because the
manager's actual question is "how full is Reza's Tuesday", not "how many orders are on it".

> **۶ تحویل · ۸ بازدید** — 14 stops

This is the fix for the cross-page blindness. Neither page lies about what it manages, and
both refuse to hide the day's real load. The count is read from one endpoint, so the two
numbers cannot disagree.

`?view=runs` adopts the leads page's section structure — pool, day-split panel, the route
being built, then the hand-over — with `AssignmentBoard`'s **existing drag-and-drop kept
intact**. Its columns are grouped by day with driver columns within.

**`MASTER.md:688` needs updating in this work.** It says the Assignment board is superseded by
Order pipeline. This spec grows the board, so that line becomes wrong and must be corrected
in the same change rather than left to mislead the next reader.

### Access

`?view=runs` reaches sales manager, owner, platform_owner. `phone_sales` may add orders and is
bounced from planning — which is the existing page guard, unchanged. `phone_sales` is already
in `CAN_SELL` (`app/api/sales/orders/route.ts:24`), so "can only add orders" needs no new gate.

### The hand-over wizard

The leads page's `LeadRunPlannerTabFlow` is copied, not rebuilt: driver → date → summary →
5-second undo → commit. It now writes a **mixed** run, and the summary shows both counts. The
existing blocked-dates rule (`blockedDates`, `needsOverride` in `lib/leadRunAssign.ts`) is
reused verbatim — with one run table, the two screens can no longer disagree about who is busy.

---

## The driver

### One list, interleaved

`driverDaySections` already returns both. The change is to render them as **one ordered
list**, not two sections, because a person thinks in one day. `sort_order` is the shared
ordering; `lib/runKinds.ts` says what each row is and what tapping it does.

**Tap once to complete any stop.** A delivery opens the amount collector, a revisit opens the
outcome note, a new pin confirms its coordinates. One gesture, three destinations — which is
only safe because the kind is unambiguous and is carried on the row.

### "My planned week"

`/driver` gains a week view: the same mixed list, by day, for the next seven days. The
manager's plan is visible before the day arrives, so a driver can see tomorrow rather than
discovering it in the van.

### On the spot

Standing in a restaurant nobody called, the driver gets one sheet offering:

- **Add a visit to today** — a new pin, added to the current run now.
- **Save for later** — a new pin, planner's decision.
- **Take an order** — the existing order form. Already permitted: both van roles are in
  `CAN_SELL`. It needs a surface, not a permission.

If the driver **might** have the goods, they deliver now. The order is fulfilled from the
van's own stock when it is there.

### A driver sees their own orders

`app/api/sales/orders/route.ts:20-23` records the defect in its own comments:

> *"an order a driver places from a lead will not appear in this list until it is on a
> delivery run… deliberately not changed here."*

Shipping field-order placement without this would produce "it didn't save" reports. The fix
is a scope rule for van roles — their own orders by authorship — plus a test.

### Commission

Unchanged. Only deliveries earn; a visit contributes nothing. The card stays gated on
`commission.kg > 0` as it is today, so a visit-only day shows no commission rather than a
confusing zero.

---

## Van stock

A van is a facility; loading it is a pair of movements that already have names.

```
TRANSFER_OUT  warehouse   -qty      goods leave the depot
TRANSFER_IN   van         +qty      goods are on the van
DELIVERY_OUT  van         -qty      goods reach the customer
```

So on-hand on a van is `onHand(orgId, { facility_id })`, the same function the warehouse uses.
No parallel inventory model, no second `DELIVERY_OUT` path, and the double-count risk
disappears because the movement lands on the van.

**Not on the van → a pending order for the next run.** `spawnBackorder`
(`lib/repo/deliveries.ts:270`) already copies lines into a new order at the original price;
it is reused, with `requested_day` set.

**"Next week, not now" → a day the driver picks**, by week offset or exact date, and **it
must not be forgotten**. That guarantee is structural rather than a reminder: an order with a
`requested_day` and no run simply appears in that day's planning pool, and the split counts
it against capacity. There is no state in which it is invisible.

---

## Error handling

| Case | Answer |
|---|---|
| Drop on a frozen run | Refused at the API, not the UI. The board already refuses to write on a drop — it proposes a confirm sheet — so the refusal has a place to live |
| Order without coordinates, split requested | Refused, naming the order. Never silently dropped |
| OSRM unreachable | Straight-line distances, labelled as such |
| No van facility linked to a vehicle | The run planner cannot claim van stock; falls back to warehouse availability |
| Driver places an order over the credit limit | Created and flagged for approval, never refused — a sale lost to a missing authority is worse than one the office clears |
| Optimise with every stop done | No-op with a message, not an empty reordering |
| Stop already on another driver's live run | Refused — `assignedToAnotherDriver` already does this for pins and the rule now covers both kinds |

---

## Testing

No component tests exist in this repo, so the assertions live in the pure modules.

- **`lib/runKinds.ts`** — a stop's kind, its icon, whether tapping opens the collector or the
  note, and whether it earns commission. A table test over all three kinds.
- **`lib/dayCapacity.ts`** — three limits; a stop that fits; **filling an existing run before
  proposing a new day**; a pinned order acting as a seed and never moving; a no-coordinate
  order blocking the split by id.
- **`lib/routeOrder.ts`** — ordering with an injected straight-line function: completed stops
  fixed, only the remainder reordered; total km reported; empty and single-stop cases.
- **`lib/vanStock.ts`** — a load is `TRANSFER_OUT` + `TRANSFER_IN`; per-van on-hand; a
  delivery from the van decrements **the van**, not the warehouse. The last one is the
  regression test for the double-count this spec exists to prevent.
- **Migration, on real data** — the `lead_runs` → `delivery_runs` fold preserves every stop,
  every driver and every date. Follows the existing `*-migration-realdata.test.ts` pattern.
- **Uniqueness** — one driver, one day, one run, proven by attempting the double insert.
- **Van-order visibility** — a driver's own order is readable by them before it is on a run.
- **Sync** — a mixed run reaches the offline client with **both** kinds of stop. This is the
  regression test for the gap in `syncPull`.

The three known-flaky tests under full-suite load (`district-coverage`, `api/routing-route`,
`routing-repo`) are unrelated to this work; a run reporting 1–2 failures with those names is
a pass.

---

## Scope

Deliberately **not** in this spec, and why:

- **Merging `/leads` and `?view=runs` into one page.** Two subjects on one screen. The user
  reversed this after first asking for it, and the reversal is right.
- **Rewriting the 22 readers of `delivery_runs`.** They keep working; that was the point of
  Approach B.
- **Real road routing as an optimisation problem.** OSRM gives distances, not a solver. The
  ordering is nearest-neighbour plus 2-opt (`lib/geo.ts`), which is what `/leads` already uses.
- **Automatic background assignment.** «در اولین فرصت» is a label. The app never assigns a
  day by itself; the manager does.
- **A load-planning UI for the depot.** Loading a van is a movement; building the screen that
  batches those movements is its own work.

### Phasing

One spec, seven phases, each independently shippable:

1. **`orders.requested_day` / `requested_kind`** + the order form field. Useful alone.
2. **The `lead_runs` → `delivery_runs` fold** + uniqueness + mixed-run reads.
3. **`lib/dayCapacity.ts`** + the split, filling existing runs.
4. **`lib/routeOrder.ts`** + OSRM with fallback + optimise.
5. **`?view=runs` sections**, the day columns, the shared count line, `MASTER.md`.
6. **The driver**: one interleaved list, my planned week, add-a-stop, place-an-order, and the
   van-order visibility fix.
7. **Van stock**: the `facilities` rebuild, the `vehicles` link, the load movement, and the
   field-order fulfilment path.

Phase 1 is worth landing on its own — it is small, it is independently useful, and it is what
phases 3 and 4 plan against.

---

## Open decisions taken by delegation

Recorded because they were mine to make, not the user's:

- **Freeze is one rule for both kinds.** A day is promised whole or not at all.
- **The driver day is one interleaved list**, not two sections. `driverDaySections` already
  returns both; the data was the only reason it looked like two.
- **An over-limit field order is created and flagged**, never refused.
- **Optimise fixes completed stops in place.**
- **Van stock is in scope** and a van is a `facilities` row — because the business already
  describes vans as smaller inventories, and `stock_movements` already has the two movement
  kinds needed.
- **A week offset and a specific date are both offered**, stored as one concrete day plus the
  choice that produced it.

## Corrections made during design

Two estimates in conversation were wrong and are corrected here rather than carried forward:

- "Rewrite the 22 files that read `delivery_runs`" — no. `delivery_stops` is INSERTed in
  exactly one place (`lib/delivery.ts:147`), and Approach B leaves every reader untouched.
- "Merge the tables and hope for the best" — the offline consequence was found only on
  checking: `syncPull` carries no lead rows, so a separate `lead_runs` leaves the field
  driver blind to visits. That finding is why the route merges at all.
