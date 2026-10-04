# The «سفرها» view, rebuilt — `/sales/schedule?view=runs`

**Date:** 2026-10-04
**Status:** design approved in conversation; awaiting spec review
**Supersedes:** the "adopt the leads page's section structure" note in
`2026-10-03-mixed-route-day-planning-design.md` §9

---

## 1. Why this exists

`?view=runs` is five tools stacked in a bare `flex-col`, each its own card, with no
hierarchy telling you where to start:

| # | Panel | Job |
|---|-------|-----|
| 1 | `RunPlanner` | driver + date form that creates a run |
| 2 | `DaySplitPanel` | «پیشنهاد بده», day lanes |
| 3 | `OrderRouteBoard` | pool ⟷ one lane per run, plus a map |
| 4 | `RunTimeline` | in-progress and finished runs |
| 5 | `DriverStreaks` | twelve-week activity grid |

Four defects, each observable:

1. **Two boards over the same data.** `DaySplitPanel` and `OrderRouteBoard` both render a
   pool of free orders and lanes grouped by day/driver. Nothing states which is the truth.
2. **Two drag engines with different feel.** `DaySplitPanel` uses raw HTML5
   `draggable`; `OrderRouteBoard` uses `useCardDrag`, which carries a travel threshold and
   re-resolves the lane under the pointer each move.
3. **A dead end.** The board's empty state says «اول باید یک مسیر باز بسازید» while the only
   form for that sits at the top of the page.
4. **The third repeat.** `RunTimeline` re-lists `OrderRouteBoard`'s lanes as a flat list.

The job itself is three steps — **make a day · split the orders · hand it over** — and the
page shows no path through them. Step three does not exist here at all.

## 2. The one rule

> **Making something new is deliberate. Changing something real is instant.**

This is the whole design. Every decision below is an application of it.

- A lane with **no driver or no date** is a **draft** (پیش‌نویس). Drop orders in freely,
  rearrange all afternoon, change your mind. Nothing is written to a run.
- A lane **with** a driver and a date is a **real run** (no label — it is the normal case).
  Dropping an order in is immediate, because that run already exists.

There is **no global commit button**. The only commit control is «سفر را قطعی کن», which
lives on the draft lane it belongs to, so there is nothing to forget and nothing to
navigate back to.

## 3. Page anatomy

One spine, top to bottom. Drafts and map sit side by side on a wide screen.

```
┌─ PageHeader (/sales/schedule, view=runs) ──────────────┐
├─ ViewTabs: برنامه | سفرها ─────────────────────────────┤
│                                                        │
│  ▸ سفارش‌های آزاد            (count · total kg)        │
│    [6 view toggles]                                     │
│    ▸ pool, in the chosen view                          │
│                                                        │
│  ▸ پیش‌نویس‌های من     ← private to you, said plainly   │
│    ◉ تا وقتی نسازی، هیچ‌کس جز تو این‌ها را نمی‌بیند.    │
│    ┌ draft lanes ┐        ┌──────┐                     │
│    │ driver/date │        │ map  │  ← side by side     │
│    │ order cards │        └──────┘                     │
│    │ قطعی کن     │                                     │
│    └─────────────┘                                     │
│                                                        │
│  ▸ بار مسیرها   — real runs, one lane each on a        │
│                   SHARED axis; kg, leg km, hover pane  │
└────────────────────────────────────────────────────────┘
```

The pool is the source, drafts are what you build from it, runs are what already exists —
so that is the order.

## 4. The pool — six views

`lib/leadViews.ts` is the reference. Two of its eight views are about leads specifically
and **do not transfer**:

| mode | label | transfers? |
|------|-------|-----------|
| `compact` | مختصر | yes |
| `pocket` | جیبی | yes — **better**: orders genuinely have receipts and invoices behind the card |
| `grid` | شبکه‌ای | yes |
| `kanban` | کانبان | **no** — columns are built from *lead status*; confirmed unassigned orders share one status, so the board would be a single column |
| `score` | امتیاز | **no** — lead potential / volume / ease; an order has no such score |
| `table` | جدول | yes |
| `batch` | گروهی | yes — **better**: tick-to-split *is* this page's job |
| `cluster` | منطقه‌ای | yes — orders carry districts |

**Six ship. «کانبان» and «امتیاز» are dropped**, and the toggle bar says so honestly rather
than pretending they were never considered.

**Implementation:** a new `lib/orderViews.ts` with its own `OrderViewMode` and its own
storage key. Reusing `lib/leadViews.ts` would share the `coverage_lead_view` key, so
choosing «جدول» here would also switch `/leads` to table — a bug that would be blamed on
something else.


## 5. Drafts

### 5.1 They are un-creatable

A draft comes into being by **dropping the first order in**, or by «پیشنهاد بده» building
several at once. There is no "+ new day" button.

This kills the `RunPlanner` dead-end permanently, and it means a draft lane always holds at
least one order — so it is always worth looking at, and there is no empty-draft state to
design.

### 5.2 They are private to their author

Q1a was answered "varies", so a browser-local draft was rejected: close the tab and the
arranging is gone, and a colleague sees nothing.

Drafts live on the **server**, owned by one user. «پیش‌نویس‌های من» is first person and
carries the privacy on its own; the line beneath states when it ends:

> ◉ تا وقتی نسازی، هیچ‌کس جز تو این‌ها را نمی‌بیند.

A colleague sees the runs you actually built, which is what matters. Drafts are not shared.

### 5.3 Wording

| Old | New | Why |
|-----|-----|-----|
| بساز این روز | **سفر را قطعی کن** | names what becomes real (the سفر) and the transition (قطعی) |
| دو خانهٔ خالی مانده | **اول راننده و تاریخ را انتخاب کن** | says the next action, not a count of gaps |
| واقعی | **deleted** | the normal state does not get a label |
| پیش‌نویس | **پیش‌نویس‌های من** | same word, plus *my* |

The commit button is enabled only when driver **and** date are both set. Disabled, it reads
«اول راننده و تاریخ را انتخاب کن».

There is **no summary or confirmation dialog** (Q1b: *"don't make me click twice"*). The
button's own label states the outcome.

## 6. «پیشنهاد بده»

### 6.1 It writes drafts, never runs

The algorithm's output must be drafts. If it committed runs, one click would finalise thirty
orders and §2 would collapse.

### 6.2 It fills only empty lanes

A lane counts as **empty** only if the algorithm created it from nothing **and** the manager
has not touched it. The first hand-drag into a lane retires it from the algorithm's scope,
permanently.

The alternative — rebuilding everything on each press — would kill "experiment freely",
which is the reason drafts exist. Today's button has exactly that behaviour.

### 6.3 Claims are exclusive

An order in a draft is **claimed**. It must not appear in the free pool and must not be
assignable to another run. This is new, and it is a correctness requirement rather than a
nicety: without it, one order could sit in a draft and a run simultaneously.

## 7. «بار مسیرها» — the real-runs section

`RunTimeline` becomes this section. Not a card list *plus* a timeline — one thing. The
shared axis is its whole value: a column means *"the Nth stop in every van at once."* Split
into per-run cards, that comparison dies, which is defect 4.

### 7.1 What it gains

- **Kilograms.** `TimelineStop` today carries only `total_toman`. A van fills by weight.
  Lane meta becomes «۱۴ مهر · ۹۲۰ کیلو · ۶ از ۸». Weight is already derivable —
  `DaySplitPanel` computes `laneKg` from the frozen `order_lines`.
- **Counts in the legend.** «برگشت خورد ۱» rather than a bare red dot: a refusal becomes a
  number that can be tracked.
- **Empty-slot ghosts.** A 6-stop lane beside an 8-stop one must not read as a shortage, so
  unused tail columns get a faint hollow ring.
- **Tighter columns.** The grid floor is `minmax(2.25rem, 1fr)`; reduce it so a 20-stop day
  stops clipping and scrolling sideways.

### 7.2 The hover pane

The old `.mlanes__tip` shows two lines. It becomes a pane carrying what you actually want
when looking at one stop:

- **customer name · order number**
- **payment state** — label from `PAYMENT_STATUS_LABEL`, plus amount and remainder,
  coloured green / amber / red
- **weight (kg)**
- **leg km from the previous stop** — the largest absence; the dot said "4th stop" and
  never said "from where"
- **mini route map with this stop in red** — the pane answers *where*, not only *how much*
- **click → open the invoice**, which ties the timeline to the جیبی view

### 7.3 «کارکرد رانندگان» moves into the driver picker

It stops being a report and becomes a decision input. It is **no longer a section** — the
picker is where it now lives, so every driver row carries all of it:

- **name and avatar**
- **load this week** in kg
- **last six runs as bars**, so heavy and light weeks are visible as shapes
- **their mean**, the fair reference line (§7.4)
- **the fourteen-week grid** (§7.4) — the twelve-week history and two future weeks, per driver

- The **fair reference line** is the **driver's own recent average**, not a fixed vehicle
  capacity. Fairness is what this person's normal week looks like, not an abstract cap.
- A driver with no deliveries shows an **empty strip rather than disappearing**. Absence is
  a mystery; an empty grid is information.

### 7.4 The fourteen-week grid

Five states. Twelve weeks back, **two weeks forward**.

| state | meaning | treatment |
|-------|---------|-----------|
| `d1..d4` | delivered, shaded by stop count | existing accent ramp |
| `p` | **a run exists, nothing recorded yet** | amber fill + amber ring |
| `z` | nothing at all on that past day | sunk |
| `f` | future, nothing planned | hollow ring |
| `F` | **future, already has a run** | accent ring |

`p` and `F` are new, and they fix a single root cause: *«کار نکرده» and «کار کرده ولی ثبت
نکرده» were the same colour.* Splitting them means

- a driver who drove and has not filed yet is **pending**, not idle — so he is not given
  less work because of paperwork;
- the part-finished current week is visibly open, so no decision rests on a twelve-week
  mean dragged down by an incomplete week.

`F` is a consequence nobody asked for and should be kept: you can see who is **already
loaded next week**, so fairness covers tomorrow rather than only yesterday.

The label must not over-claim. `readDriverActivity` counts only rows with
`status = 'delivered'` **and** `delivered_at` set, so the grid measures **recorded** work.
Wording such as «بر اساس تحویل‌های ثبت‌شده» is required, not optional.

## 8. Moving stops

**The stop is the unit.**

- A **delivered** stop never moves, and says why.
- A **pending** stop moves freely between runs, and into or out of drafts.

Moving is a **move, not a copy**, in every direction — run→run, run→draft, draft→run,
draft→draft. An order occupies exactly one place at a time, which is what §6.3 requires and
what `moveStop(orderId, toLane)` must guarantee as a single transaction.

This is the rule `readDeletableRun` already enforces at run level — *"a delivered stop is a
record, not a plan"* — applied at stop level. It matches physics: a delivered parcel is not
a plan; an undelivered one plainly is.

It also settles a live contradiction. `OrderRouteBoard` toasts «برای برداشتن، سفارش را روی
مسیر دیگری بکشید», implying it works, while `/leads`' `refuseAssigned` refuses the same
gesture. Two halves of the app currently disagree; they now agree.

## 9. Undo and delete

**Both**, because both mechanisms already exist.

- **Quick undo** — the toast with «برگرداندن» and a countdown, as `RunPlanner.undoCreate`
  already does on create.
- **Later delete** — from «بار مسیرها», for as long as nothing was delivered.
  `lib/delivery.ts:180 deleteRun` returns `{ releasedOrderIds }`, so orders return to the
  pool on their own. `readDeletableRun` refuses once a stop is delivered.

**Discarding a draft is always free and immediate** — no confirmation, no undo. Nothing
happened, so there is nothing to undo.

## 10. Empty states

An empty **order** pool is Tuesday's work done, not a filtering mistake, so it must not
borrow `EmptyState`'s «یافت نشد» register.

- The pool **header survives** and reads «۰ سفارش آزاد». If the pool collapses to nothing,
  the answer to "how much is left" is thrown away — and that is the number people open this
  page for.
- **Both** a status header **and** a «برنامه‌ریزی هفتهٔ بعد» prompt when the week is done,
  turning the dead end into the next task.

No empty-draft state exists (§5.1). No driver accounts keeps `RunPlanner`'s existing honest
message.

## 11. Responsive

- **Wide screen:** drafts and map side by side. Geography is the reasoning behind splitting
  a day — you do not send one van to Shahr-e Rey and another to Narmak for shops 400 m
  apart — so the signal you judge with sits in the same glance as the thing you judge.
- **Narrow:** map stacks below, which is the `/leads` arrangement anyway.
- **Phone: tap to pick up, tap to place.** No dragging on small screens.

  This is a **second interaction model**, and it will drift from the drag model unless both
  are driven by one shared `moveStop(orderId, toLane)` command with two input adapters. That
  is a requirement, not a nicety — the alternative is the next §8-style contradiction. Every
  lane must also be reachable by tap, so the «انتقال به روز دیگر» select is a first-class
  fallback rather than an afterthought.

  Free win: `useCardDrag` is Pointer Events with a 6px travel threshold, so touch drag
  already works. `DaySplitPanel`'s raw HTML5 `draggable` does not — one more reason it goes.

## 12. The driver's own page

The same information must reach the driver, at the door.

**The plumbing already exists.** `lib/repo/syncPull.ts` pulls `SELECT * FROM orders` and
`SELECT * FROM customers`, so `payment_status`, `notes`, `paid_toman` and
`customers.phone` (db.ts:1435) are **already in the driver's offline snapshot**. A driver
with no signal can already read them. This is rendering work, not network work.

The driver's stop card gains: **payment state**, **order notes**, **kg**, **phone**,
**customer's outstanding balance**.

**Constraint, and it needs its own test.** The outstanding balance is another party's
account data. A driver may see *their own* customers, never the whole book — the same rule
`orderVisibility` already enforces for orders.

## 13. Distance: OSRM everywhere, no exceptions

> **Verified, and the current state does not meet this.**

`lib/clusterDays.ts` accepts a `distanceFn` and honours it at **one** call site out of
seven:

| line | call | honours `distanceFn`? |
|------|------|----------------------|
| 59 | `seedCentroids` — farthest from origin | no, `distanceKm` |
| 72 | `seedCentroids` — farthest from seeds | no |
| 94 | `seedFromSources` | **yes — the only one** |
| 143 | `assign()` — nearest-centroid ranking | no — **and this is the decision** |
| 231 / 279 / 301 | trim / convergence / sort | no |

Two consequences:

1. **`dayCapacity.ts:218` passes `sources = undefined`**, so the runs path never reaches
   line 94. **Wiring OSRM into `planDaySplit` correctly would change nothing.**
2. **`/leads` is also mostly straight-line.** Its `prioritySeeds` only route through
   `seedFromSources`; `assign()` is straight-line either way.

Also `dayCapacity.ts:238 byOrigin` uses raw `Math.hypot` over **degrees** — not kilometres,
not even haversine.

### Required work

- **`distanceFn` becomes mandatory at every distance site** in `clusterDays.ts`. The
  straight-line default stays available as the fallback, but no code path silently prefers
  it.
- **`byOrigin` is deleted** in favour of the shared measure.
- **Chunking.** `fetchOsrmTable` refuses `points.length > 100` (osrmMatrix.ts:55) and the
  pool is routinely 300+. The matrix must be fetched in chunks, or the whole thing degrades
  to straight lines precisely at the scale where it matters.
- **Honest fallback labelling**, following the precedent at `routeOrder.ts:153
  isApproximate()`, which detects fallback by identity against `distanceKm`.
- **Tests must pin OSRM and straight-line to a *different* answer** on a fixture where the
  two genuinely differ. A test that passes under both proves nothing, and would let this
  regress silently again — which is exactly how it got here.

`lib/routeOrder.ts` (`sortByDistanceFrom`, `routeLengthWith`, `optimiseRemaining`,
`isApproximate`) is already parameterised correctly and is the model to follow.

## 14. Data

### 14.1 Draft storage

Two tables, because a draft is *"a proposed day"* and *"the orders on it"*:

```
run_drafts       id, organization_id, user_id,
                 driver_user_id NULL, run_date NULL,   -- NULL ⇒ still a draft
                 created_by_suggest INTEGER,          -- «پیشنهاد بده» made it
                 manual_edits     INTEGER,           -- a hand touched it
                 created_at, updated_at
run_draft_stops  draft_id, order_id, seq
```

`manual_edits` is what makes §6.2 decidable: **a lane is empty iff
`created_by_suggest = 1 AND manual_edits = 0`.** The first hand-drag sets it, and nothing
sets it back.

Both `driver_user_id` and `run_date` are nullable, and a draft with **either** missing is
still a draft — that is §2, expressed as a column.

### 14.2 Derived reads

| needed for | source |
|-----------|--------|
| kg per order | frozen `order_lines` (`kg_per_base_unit` × `qty_per_pack`), as `DaySplitPanel` already does |
| leg km between stops | `lib/routeOrder.ts` with an OSRM measure (§13) |
| customer's outstanding balance | `SUM(total_toman - paid_toman)` over that customer's unsettled **delivered** orders — the whole customer, not this order |
| driver load bars | last six runs per driver by kg |
| 14-week grid states | `delivery_stops.delivered_at` **plus `delivery_runs.run_date`**, since `F` needs a planned run on a future date |

### 14.3 The pool query

`readPlannableOrders` must additionally exclude anything in `run_draft_stops`. A claimed
order is not free.

## 15. Testing

This repo has **no component tests** — no `.test.tsx`, no testing-library — so a rule that
lives only inside a component is a rule nobody can assert. Everything assertable goes in
`lib/`, and each of these is a real test with a real failure mode:

| rule | assertion that would fail today |
|------|-----------------------------------|
| draft eligibility | `created_by_suggest=1 AND manual_edits=0` is the *only* eligible set |
| OSRM is real | OSRM and straight-line give **different** groupings on a fixture where they differ — a test passing under both proves nothing |
| stop movement | a delivered stop refuses to move; a pending one moves |
| exclusivity | an order in a draft appears in neither the pool nor another run |
| balance visibility | a driver sees their own customers' balance and no other tenant's |
| grid states | `p`, `F`, `z`, `f`, `d` each derive from the right predicate |
| view persistence | `lib/orderViews.ts` key ≠ `coverage_lead_view` |

## 16. What is deleted

| goes | why |
|------|-----|
| `RunPlanner` | replaced by driver + date inside a draft lane; it was also the dead-end source |
| `DaySplitPanel` | raw HTML5 `draggable`, second board over the same data, superseded by drafts |
| `OrderRouteBoard` | its lane list becomes the draft lanes; its drag becomes `moveStop` |
| `DriverStreaks` as a section | survives, inside the driver picker (§7.3) |

`RunTimeline` survives as «بار مسیرها». `useCardDrag` survives and gains a tap adapter.
`useRouteMatrix` and `osrmMatrix` survive and gain chunking.

## 17. Scope

**In:** the `?view=runs` page, its data layer, the driver's stop card, and the OSRM
correctness fix in `clusterDays.ts` (§13) — which is in scope because without it the split
this page exists to perform is computed on straight lines.

**Out:** the «برنامه» month view (untouched), `/leads` itself (except that §13 changes its
clustering measure, which is the point), the driver commission card, and offline sync
protocol changes (none needed — §12).

## 18. Known risks

- **§13 changes `/leads` output.** Making `distanceFn` mandatory will alter day proposals
  there. That is a correction, but it is a visible change and should be called out in the
  commit, not slipped in.
- **Chunked OSRM is network-bound.** 300 orders is 3+ table calls. It must be bounded,
  cached, and never block the UI — the fallback must be the straight line, labelled.
- **Two input adapters (§11) will drift** unless the shared-command requirement is enforced
  by test rather than by convention.
- **A draft can go stale.** It lives on the server, so an order inside it can be cancelled,
  credited-held, or delivered elsewhere by somebody else while the draft sits untouched. The
  draft must survive that — it is the manager's idea, not a claim on the world — but any
  order that is no longer plannable must be shown as such and refused at «سفر را قطعی کن»,
  naming the order rather than silently dropping it. This is the same contract
  `commitDaySplit` already has: individual refusals are collected and returned, not thrown.
