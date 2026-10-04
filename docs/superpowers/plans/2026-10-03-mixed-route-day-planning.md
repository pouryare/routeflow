# Mixed-route day planning — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-10-03-mixed-route-day-planning-design.md`
**Status:** ready

**Goal:** An order can carry a requested delivery day; days split by capacity and geography; one run per driver-day holds orders and visits together; the driver sees one ordered list; a van carries its own stock.

**Architecture:** One run table. `lead_runs` is retired into `delivery_runs`; the two stop tables both key to `delivery_runs.id` and are merged for display by one repo module. Every rule that matters lives in a **pure** `lib/` module, because this repo has no component tests — a rule that only exists inside a component is a rule nobody can assert.

**Tech Stack:** Next.js App Router (server components + client islands), `node:sqlite` via `lib/db.ts`, vitest, Tailwind v4 CSS variables, React pointer events (never HTML5 drag-and-drop).

---

## Read this before starting

### Three verified facts this plan depends on

1. **`delivery_stops` has exactly ONE insert site** — `lib/delivery.ts:147`. `order_id` stays `NOT NULL`. No existing reader changes.
2. **`lead_run_stops.run_id` is `REFERENCES lead_runs(id) ON DELETE CASCADE`** (`lib/db.ts:1845`). Re-pointing it at `delivery_runs(id)` **requires the guarded rebuild** at `lib/db.ts:236-268`. This is Phase 2 and it is the only destructive phase.
3. **`clusterIntoDays`'s `seeds` are hints, not pins** (`lib/clusterDays.ts:87,288`). `assign()` (`:140`) ranks every stop including seeds, and `rebalanceToSizes` (`:174`) can relocate one. Pinned stops must be **partitioned out before** the call.

### Machine constraints

- **Never run `next build`** — this machine cannot finish one (cancelled 2026-09-29).
- Verify with `npx tsc --noEmit` (~2 min, background it) and `npx vitest run` (~14 min, background it).
- Full suite: `setsid nohup npx vitest run > /tmp/vitest.log 2>&1 &`, then poll.
- Three tests flake under load and a run reporting them **is a pass**: `tests/district-coverage.test.ts` ("has no interior hole in the net"), `tests/api/routing-route.test.ts` ("plans, commits and freezes"), `tests/routing-repo.test.ts` ("builds a greedy plan ordered nearest-first from the depot"). Re-run a file alone before believing a failure — **twice**, because borderline gives a coin flip.
- `sharp` is pinned to exactly `0.33.5`. Never float it; this CPU has no AVX2.

### Phase map

| # | Phase | Ships |
|---|---|---|
| 1 | `orders.requested_day` | An order can have a day, or «در اولین فرصت» |
| 2 | Fold `lead_runs` → `delivery_runs` | One run per driver-day, both kinds of stop. **Destructive** |
| 3 | `lib/dayCapacity.ts` + split | Days proposed by capacity and geography |
| 4 | `lib/routeOrder.ts` + optimise | Real-road ordering with a straight-line fallback |
| 5 | The board | `?view=runs` in the leads page's shape |
| 6 | Freeze reachability | A board-created run can actually commit |
| 7 | The driver | One list, my planned week, add-a-stop, place-an-order |
| 8 | Van stock | A van is a facility |

**Phase 1 is worth landing on its own.** Phase 2 must not be combined with anything.
---

## File structure

**Create (new, each with one job):**

| Path | Responsibility |
|---|---|
| `lib/requestedDay.ts` | Pure. Does this order have a day? What is its label? Resolve a week offset to a date. |
| `lib/runKinds.ts` | Pure. Kind of a stop → icon, tap behaviour, earns commission. |
| `lib/dayCapacity.ts` | Pure. Three limits → room left; does a stop fit; split proposal. |
| `lib/routeOrder.ts` | Pure. Order a day's stops by drive sequence. Distance fn injected. |
| `lib/vanStock.ts` | Load a van, read it, decide what can be delivered from it. |
| `lib/repo/mixedRuns.ts` | Read one run with both kinds of stop. **The only module that knows there are two tables.** |
| `tests/requested-day.test.ts` | Phase 1 |
| `tests/mixed-runs-foldin.test.ts` | Phase 2, on real data |
| `tests/day-capacity.test.ts` | Phase 3 |
| `tests/route-order.test.ts` | Phase 4 |
| `tests/run-kinds.test.ts` | Phase 7 |

**Modify:** `lib/db.ts` (schema + rebuild + TENANT_TABLES), `lib/orders.ts`, `lib/delivery.ts`, `lib/repo/leadRuns.ts`, `lib/repo/routing.ts`, `lib/clusterDays.ts` (seeds contract only), `lib/repo/syncPull.ts`, `app/api/sales/orders/route.ts`, `app/(shell)/sales/schedule/page.tsx`, `components/sales/AssignmentBoard.tsx`, `components/sales/OrderForm.tsx`, `app/(bare)/driver/page.tsx`, `MASTER.md`.

---

## Phase 1 — `orders.requested_day`

Independently useful. Small. Everything in Phases 3 and 4 plans against it.

**Files:**
- Modify: `lib/db.ts` (migration), `lib/orders.ts` (`CreateOrderInput`, `readOrders`, `OrderSummary`)
- Modify: `components/sales/OrderForm.tsx`, `app/api/sales/orders/route.ts`
- Create: `lib/requestedDay.ts`, `tests/requested-day.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/requested-day.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveRequestedDay, requestedDayLabel, isUncommitted } from "@/lib/requestedDay";

describe("requested day", () => {
  it("treats a null day as uncommitted — that IS «در اولین فرصت»", () => {
    expect(isUncommitted(null)).toBe(true);
    expect(isUncommitted("2026-10-05")).toBe(false);
  });

  it("labels an uncommitted order in Persian, not as a flag", () => {
    expect(requestedDayLabel(null)).toBe("در اولین فرصت");
  });

  it("resolves a week offset from a known today", () => {
    expect(resolveRequestedDay("week_offset", 1, "2026-10-03")).toBe("2026-10-10");
    expect(resolveRequestedDay("week_offset", 0, "2026-10-03")).toBe("2026-10-03");
  });

  it("refuses a negative offset rather than inventing a past day", () => {
    expect(() => resolveRequestedDay("week_offset", -1, "2026-10-03")).toThrow();
  });

  it("keeps an exact date exactly as given", () => {
    expect(resolveRequestedDay("exact_date", 0, "2026-11-20")).toBe("2026-11-20");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run tests/requested-day.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/requestedDay'`.

- [ ] **Step 3: Write `lib/requestedDay.ts`**

Pure, no I/O. `tehranTodayIso` already exists in `lib/jalali.ts` and takes an optional `now`, so the offset arithmetic is testable against a fixed today.

```ts
import { faJalaliDate } from "./jalali";

export type RequestedKind = "soonest" | "week_offset" | "exact_date";

/** ISO `YYYY-MM-DD`, or null — and null IS «در اولین فرصت». */
export type RequestedDay = string | null;

export const UNCOMMITTED_LABEL = "در اولین فرصت";

export function isUncommitted(day: RequestedDay): boolean {
  return day === null;
}

/** What the card says. Never "ASAP", never a boolean. */
export function requestedDayLabel(day: RequestedDay): string {
  return day === null ? UNCOMMITTED_LABEL : faJalaliDate(day);
}

/** A week offset resolved against a KNOWN today, so the arithmetic is testable. */
export function resolveRequestedDay(
  kind: RequestedKind,
  weeks: number,
  todayIso: string,
): string {
  if (kind === "exact_date") return todayIso;
  if (!Number.isInteger(weeks) || weeks < 0) {
    throw new Error("فاصلهٔ هفته نامعتبر است");
  }
  const base = new Date(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) throw new Error("تاریخ نامعتبر");
  base.setUTCDate(base.getUTCDate() + weeks * 7);
  return base.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
npx vitest run tests/requested-day.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the columns**

In `lib/db.ts`, guarded and idempotent — the repo's existing pattern (`lib/db.ts:4051-4069`):

```ts
// Phase 1 (mixed-route planning): the day a customer asked for. NULL is not "unset" —
// it IS «در اولین فرصت», the label that says nobody has committed this order to a day yet.
// requested_kind records WHICH control the reader used, so a week offset can still read
// «هفتهٔ بعد» after it has been resolved to a concrete date.
const reqCols = (db.prepare("PRAGMA table_info(orders)").all() as { name: string }[]).map(
  (c) => c.name,
);
if (!reqCols.includes("requested_day")) db.exec("ALTER TABLE orders ADD COLUMN requested_day TEXT");
if (!reqCols.includes("requested_kind")) {
  db.exec(
    "ALTER TABLE orders ADD COLUMN requested_kind TEXT CHECK (requested_kind IN ('soonest', 'week_offset', 'exact_date'))",
  );
}
```

**No rebuild.** Both are nullable, neither needs an index. A `CHECK` added this way governs *new* rows only, which is correct — every existing row is «در اولین فرصت» anyway.

- [ ] **Step 6: Thread it through `lib/orders.ts`**

- `CreateOrderInput`: add `requested_day?: string | null; requested_kind?: RequestedKind | null;`
- the INSERT column list at `lib/orders.ts:214` and its params
- `OrderSummary` and `readOrders`'s SELECT (`lib/orders.ts:509`)

- [ ] **Step 7: The form and the API**

`components/sales/OrderForm.tsx` — beside the existing `JalaliDatePicker id="order-date"`
(«تاریخ سفارش»), add a **second** control for the delivery day. Two dates on one order is
correct and is the point: `order_date` is when it was typed, `requested_day` is when it
should go. Offer three — a date, a week offset, or leave it as «در اولین فرصت».

- [ ] **Step 8: Verify and commit**

```bash
npx tsc --noEmit          # background: setsid nohup npx tsc --noEmit > /tmp/tsc.log 2>&1 &
npx vitest run tests/requested-day.test.ts tests/api/orders*.test.ts
git add -A && git commit -m "feat(orders): an order can name the day it is wanted, or stay «در اولین فرصت»"
```

---

## Phase 2 — Fold `lead_runs` into `delivery_runs`

**The only destructive phase. Do it alone.** Its drop is a CASCADE, and
`tests/no-cascade-migration.test.ts` exists because a cascade once destroyed a driver's
assigned work in this repo — *"gone with no error and no entry in any log."*

**Files:**
- Modify: `lib/db.ts` (kind column, `lead_run_stops` rebuild, TENANT_TABLES)
- Create: `lib/repo/mixedRuns.ts`, `tests/mixed-runs-foldin.test.ts`
- Modify then delete: `lib/repo/leadRuns.ts`
- Modify: `tests/lead-pin-foldin.test.ts`, `tests/no-cascade-migration.test.ts`, `tests/tenancy-schema.test.ts`, `tests/api/lead-visit-routing.test.ts`, `tests/api/lead-runs.test.ts`, `tests/role-queries.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/mixed-runs-foldin.test.ts`, asserting: a lead run's stops appear on the same `delivery_runs` row; every stop survives; driver and date are unchanged; `lead_run_stops` has **no** `organization_id` after the rebuild; `assignedToAnotherDriver` still refuses a double assignment. Follow the existing `*-migration-realdata.test.ts` pattern.

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/mixed-runs-foldin.test.ts`. Expected: FAIL, two run tables exist.

- [ ] **Step 3: `delivery_runs.kind`**

```sql
ALTER TABLE delivery_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'delivery_only'
  CHECK (kind IN ('delivery_only', 'mixed'));
```

Defaulting to `delivery_only` is correct for every existing row.

- [ ] **Step 4: Move the runs** — for each `lead_runs` row, find-or-create the `delivery_runs` row for that `driver_user_id` + `run_date` + `organization_id`, set `kind = 'mixed'`, and record the old→new mapping in a temp table so step 6 can be checked.

- [ ] **Step 5: Rebuild `lead_run_stops`** — the guarded pattern at `lib/db.ts:236-268`: read the live `CREATE TABLE` from `sqlite_master`, rewrite **only** `REFERENCES lead_runs(id)` to `REFERENCES delivery_runs(id)`, copy every column listed by `PRAGMA table_info`, wrap in `PRAGMA foreign_keys = OFF`, recreate `idx_lead_run_stops_run`, and **assert `SELECT COUNT(*)` matches before and after**.

The rebuild must **not** add `organization_id`. That table has never had one, deliberately — it is reached through its parent (noted at `tests/lead-pin-foldin.test.ts:40`). Tenancy stays on `delivery_runs`.

- [ ] **Step 6: Drop `lead_runs`** — only after step 5's count assertion passes, and only once no `lead_run_stops` row points at a `lead_runs` id.

- [ ] **Step 7: `TENANT_TABLES`** — remove `"lead_runs"` (`lib/db.ts:68`). `tests/tenancy-schema.test.ts` iterates that list and asserts every entry has `organization_id`.

- [ ] **Step 8: `lib/repo/mixedRuns.ts`** — read one run with both kinds of stop. **The interleaving rule:** order within each table by `(sort_order, id)`; merge by `sort_order` ascending and break ties by **`id`**. Both columns default to `0`, so without the tiebreak two tables' zeros collide rather than interleave. Mixed runs write `sort_order` unique **across the whole run**, or "visit 3 before delivery 2" is inexpressible.

- [ ] **Step 9: Re-point `assignedToAnotherDriver`** (`lib/repo/leadRuns.ts:174-182`) at `delivery_runs`. Its query joins `lead_run_stops → lead_runs`. It is the *server half* of the double-assignment guard — the browser filter is convenience — so both move together.

- [ ] **Step 10: Update the six test files.** Update, never delete — each asserts real behaviour that must survive.

- [ ] **Step 11: Verify** — `tsc --noEmit`, the six files, then the **full suite in the background**. Any failure naming `lead_runs` means a reader was missed.

- [ ] **Step 12: Commit**

```bash
git commit -m "refactor(runs): one run per driver-day, holding orders and visits"
```

---

## Phase 3 — `lib/dayCapacity.ts` and the split

**Files:** Create `lib/dayCapacity.ts`, `tests/day-capacity.test.ts`. Modify `app/(shell)/sales/schedule/page.tsx`, `components/sales/RunPlanner.tsx`.

- [ ] **Step 1: Failing test** — three limits; a stop that fits; **filling an existing run before proposing a new day**; a **pinned order never moved** (this must fail against `clusterIntoDays`'s current contract — that is the point); a pinned order's location still pulling its day first; a no-coordinate order blocking the split by id.

- [ ] **Step 2: Implement.** The pinning contract, which is the whole subtlety:

```
pinned  = orders WITH requested_day
free    = orders WITHOUT  (this is what gets clustered)

day.requested_day  → capacity consumed immediately, never re-assigned
free               → clusterIntoDays(free, k, origin, distanceFn, pinnedLocations, cap)
```

`seeds` is passed `pinnedLocations` for what it is genuinely good at — pulling a day's centre
toward work already promised. It is **not** how a pin is held: pinned stops are outside the
arrays `assign()` and `rebalanceToSizes()` ever see, so they cannot move. Capacity subtracts
each day's pinned count first, so a pinned order consumes capacity rather than appearing free.

- [ ] **Step 3: Split fills before it creates.** Fill the **remaining** capacity of days that already have runs; propose a new day only when every existing one is full. Otherwise splitting 30 unplaced orders piles work onto a day that already has 20.

- [ ] **Step 4: A no-coordinate order blocks the split** — `customers.lat/lng` can be NULL. Refuse and **name the order**. Silently dropping it is how work disappears.

- [ ] **Step 5: Wire the panel** — mirror `RouteSection`'s shape: a `stopsPerDay`-style control, a «پیشنهاد بده» button, editable day lanes.

- [ ] **Step 6: Verify and commit** — `feat(runs): days split by capacity and geography, around the days already promised`

---

## Phase 4 — `lib/routeOrder.ts`, OSRM, optimise

**Files:** Create `lib/routeOrder.ts`, `tests/route-order.test.ts`. Reuse `lib/geo.ts` (`nearestNeighborOrder`, `twoOptOrder`, `routeLengthKm`) and `lib/routing/osrmMatrix.ts`.

- [ ] **Step 1: Failing test** — with an injected straight-line function: completed stops fixed and only the remainder reordered; total km reported; empty; single-stop.

- [ ] **Step 2: Implement.** The distance function is a **parameter**, so OSRM and `distanceKm` are interchangeable and the tests run offline. `distanceKm` is the **default**, not a degraded mode.

- [ ] **Step 3: Four anchors** — depot, driver's location, previous stop, chosen point.

- [ ] **Step 4: Optimise** — writes `sort_order` unique across the run. On a **live** run it reorders **only the stops that are not done**, sequencing from where the driver actually is.

- [ ] **Step 5: Honest fallback** — when OSRM fails, **say** the numbers are straight-line. Never show a worse answer as if it were the real one.

- [ ] **Step 6: Verify and commit** — `feat(runs): real-road ordering with an honest straight-line fallback`
---

## Phase 5 — The board

**Files:** Modify `app/(shell)/sales/schedule/page.tsx`, `components/sales/AssignmentBoard.tsx`, `lib/pageMeta.ts`, `MASTER.md`.

- [ ] **Step 1: Sections in the leads page's shape** — pool, day-split panel, the route being built, hand-over. **`AssignmentBoard`'s existing drag-and-drop is kept intact** — do NOT refactor it onto `useCardDrag`.

- [ ] **Step 2: Columns grouped by day**, driver columns within.

- [ ] **Step 3: The shared count line** — each page shows its own stops plus the other's count (`۶ تحویل · ۸ بازدید`), read from **one endpoint** so the two numbers cannot disagree.

- [ ] **Step 4: Access** — sales manager, owner, platform_owner. `phone_sales` may add orders and is bounced from planning (the existing page guard). **No new gate**: `phone_sales` is already in `CAN_SELL` (`app/api/sales/orders/route.ts:24`).

- [ ] **Step 5: Hand-over wizard** — copy `LeadRunPlannerTabFlow`, do not rebuild: driver → date → summary → 5 s undo → commit. It now writes a **mixed** run and the summary shows both counts. Reuse `blockedDates` / `needsOverride` from `lib/leadRunAssign.ts`.

- [ ] **Step 6: `MASTER.md:688`** — it says the Assignment board is superseded by Order pipeline. This phase **grows** the board, so that line becomes wrong. Correct it in the same change.

- [ ] **Step 7: Verify and commit** — `feat(board): the runs view takes the leads page's shape`

---

## Phase 6 — Freeze reachability

Depends on Phase 2. Small, but without it "committed" is a word with no behaviour behind it.

**Files:** Modify `lib/repo/routing.ts`.

- [ ] **Step 1: Failing test** — a run with **no** `route_template_id` freezes on the default cutoff.

- [ ] **Step 2: Implement.** `runsNeedingFreeze` (`:388`) inner-joins `route_schedules` on `route_template_id`, and `createRun` (`lib/delivery.ts:97`) / `commitPlan` (`:333`) insert **no** `route_template_id`. NULL plus an inner join drops the row, so **board-created runs never freeze at all** — today or after any other phase. `LEFT JOIN` plus an organisation-level default `cutoff_time`.

- [ ] **Step 3: Mixed freeze** — `freezeRun` moves every stop's order to `READY`; a pin stop has no order, so record its `sort_order` as fixed instead.

- [ ] **Step 4: Verify and commit** — `fix(runs): a board-created run can actually commit`

---

## Phase 7 — The driver

**Files:** Modify `app/(bare)/driver/page.tsx`, `app/api/sales/orders/route.ts`, `lib/repo/syncPull.ts`. Create `lib/runKinds.ts`, `components/driver/AddStopSheet.tsx`, `tests/run-kinds.test.ts`.

- [ ] **Step 1: `lib/runKinds.ts`** — pure. Kind → icon, tap behaviour, earns commission. A table test over all three kinds.

- [ ] **Step 2: One interleaved list** — `driverDaySections` already returns both. Render one ordered list, not two sections: a person thinks in one day.

- [ ] **Step 3: Tap once** — delivery opens the amount collector, revisit the outcome note, a new pin the coordinate confirm.

- [ ] **Step 4: My planned week** — the same mixed list by day, for the next seven days.

- [ ] **Step 5: On the spot** — «افزودن به امروز» / «برای بعد» / **«ثبت سفارش»**. The last needs **no permission**: both van roles are already in `CAN_SELL` (`app/api/sales/orders/route.ts:24`). It needs a surface, not a gate.

- [ ] **Step 6: A driver sees their own orders.** `app/api/sales/orders/route.ts:20-23` records the defect in its own comments — an order a driver places *"will not appear in this list until it is on a delivery run… deliberately not changed here."* Add the authorship scope rule. Without this, field orders produce "it didn't save" reports.

- [ ] **Step 7: Sync** — `syncPull` (`lib/repo/syncPull.ts:86-111`) carries delivery runs and **no** lead rows. Add them. This is the regression test for the gap that motivated the whole merge.

- [ ] **Step 8: Verify and commit** — `feat(driver): one list, and a driver can see their own orders`

---

## Phase 8 — Van stock

**Files:** Modify `lib/db.ts` (`facilities` rebuild + `vehicles.facility_id`). Create `lib/vanStock.ts`, `tests/van-stock.test.ts`.

- [ ] **Step 1: Failing test** — a load is `TRANSFER_OUT` + `TRANSFER_IN`; per-van on-hand; **a delivery from the van decrements the van, not the warehouse.** The last is the regression test for the double-count this phase exists to prevent.

- [ ] **Step 2: `facilities.kind` gains `'van'`** — a CHECK change, so the guarded rebuild at `lib/db.ts:236-268`.

- [ ] **Step 3: `vehicles.facility_id`** — plain nullable `ALTER`. `vehicles` already carries the three capacity limits (`max_weight_kg`, `max_volume_m3`, `max_stops`) that Phase 3 reads.

- [ ] **Step 4: Load a van** — the two movement kinds already exist (`lib/repo/stock.ts:417-418`). On-hand is `onHand(orgId, { facility_id })` — **no new stock arithmetic**.

- [ ] **Step 5: Deliver from the van** — `DELIVERY_OUT` against the **van** facility. Today there is no `locations` table and no van can hold stock, so this would decrement the warehouse a second time.

- [ ] **Step 6: Not on the van → a pending order for the next run.** Reuse `spawnBackorder` (`lib/repo/deliveries.ts:270`) — it already copies lines at the original price — with `requested_day` set.

- [ ] **Step 7: "Next week, not now"** — the driver picks a week offset or a date, and it **cannot be forgotten**, because that guarantee is structural: an order with a `requested_day` and no run appears in that day's planning pool and counts against its capacity. There is no state in which it is invisible.

- [ ] **Step 8: Verify and commit** — `feat(stock): a van is a facility, and goods move warehouse → van`

---

## Final verification

```bash
npx tsc --noEmit          # ZERO errors
setsid nohup npx vitest run > /tmp/vitest.log 2>&1 &   # then poll the log
```

A run reporting 1–2 failures named `district-coverage`, `api/routing-route` or
`routing-repo` **is a pass**. A failure with any other name is real — re-run that file alone,
twice, before believing it.

**Never run `next build`.** It cannot finish on this machine.

---

## Cleanup owed from earlier work

- [ ] Delete `app/(bare)/toast-demo/page.tsx` — marked `TEMPORARY — delete this file once the drain has been looked at and signed off`, and the drain shipped in `7bce3ea`.

Depends on Phase 2. Small, but without it "committed" is a word with no behaviour behind it.

**Files:** Modify `lib/repo/routing.ts`.

- [ ] **Step 1: Failing test** — a run with **no** `route_template_id` freezes on the default cutoff.

- [ ] **Step 2: Implement.** `runsNeedingFreeze` (`:388`) inner-joins `route_schedules` on `route_template_id`, and `createRun` (`lib/delivery.ts:97`) / `commitPlan` (`:333`) insert **no** `route_template_id`. NULL plus an inner join drops the row, so **board-created runs never freeze at all** — today or after any other phase. `LEFT JOIN` plus an organisation-level default `cutoff_time`.

- [ ] **Step 3: Mixed freeze** — `freezeRun` moves every stop's order to `READY`; a pin stop has no order, so record its `sort_order` as fixed instead.

- [ ] **Step 4: Verify and commit** — `fix(runs): a board-created run can actually commit`

---

## Outcome — what actually shipped

All eight phases are implemented and verified. `npx tsc --noEmit` reports zero errors, and the
full suite runs green apart from two long-standing failures that predate this work.

| Phase | Commit | What landed |
|---|---|---|
| 1 — a day on an order | `c09f787`, `8211bdd` | `orders.requested_day`, «در اولین فرصت» as a NULL (not a flag), the order-form field |
| 2 — the fold | `c8b1f38` | `lead_runs` folded into `delivery_runs`; guarded by a row-count and an orphan assertion before the DROP |
| 3 — the split | `e306ea0`, `07c849d` | `lib/dayCapacity.ts` (19 tests) and the panel on `?view=runs`; three limits read from the existing `vehicles` columns |
| 4 — ordering | `1164cd4` | `lib/routeOrder.ts` (16 tests); a finished stop never moves; the fallback is detected by identity so it cannot be forgotten |
| 5 — the board | `6fc5fd5` | The shared count line (Q35), one read for both pages; the repo-boundary failure fixed by moving SQL, not allowlisting |
| 6 — freeze | `3676171` | `LEFT JOIN` so a board-created run can commit at all; 17:00 Tehran default |
| 7 — the driver | `f5b7abb` | Visits reach the phone (`syncPull`), and a driver sees their own field orders (`orderFilter`), plus `lib/runKinds.ts` |
| 8 — van stock | `0ddc5d4` | A van is a facility; a van delivery no longer double-counts the warehouse |

Cleanup owed from earlier work is also done: `app/(bare)/toast-demo/page.tsx` deleted, and
`MASTER.md`'s claim that the Assignment board is superseded was corrected.

### Four defects found by measuring rather than reading

1. **Seeds do not pin.** Sweeping `clusterIntoDays` showed 106 of 1,575 seeded stops landing in a
   day dominated by the other town. Promised orders are partitioned OUT of the clustered set.
2. **Board runs never froze.** `runsNeedingFreeze` inner-joined on `route_template_id`, which
   `createRun` leaves NULL. "Committed" had no behaviour behind it.
3. **Drives were blind to visits.** `syncPull` read delivery tables only, so offline a driver saw
   half the manifest, with no error.
4. **Field sales were invisible.** A driver's own order appeared nowhere until a manager loaded it
   onto a van — recorded as a known defect in the route's own comments and left there.

### The lesson worth keeping

Three of those four were **cited with a real file and line number in this plan, and were still
wrong.** Accurate references make a claim more persuasive, not less — they read as already
checked. Every one of them was found by opening the function and asking what it actually does.
