# Lead-run assign lifecycle — design

**Date:** 2026-09-27
**Status:** approved
**Surface:** the `سپردن مسیر` hand-over (`components/leads/LeadRunPlannerTabFlow.tsx`) and the leads page around it

## Why

A hand-over is a one-way door with no way back. The sheet can write a route, but nothing on
the page records that it did, the pool that produced it stays on screen as though it were
still the manager's to-do, and a mistake cannot be caught or corrected. The undo window the
app already has everywhere was not being used here, so the only remedy for a wrong driver or
a wrong day was to assign again — which the busy-day guard now blocks.

A second pass over the page found eight problems of the same kind: UI that does not match
what the system actually does.

## The problems

| # | Problem | Fix |
|---|---|---|
| 1 | `onAssigned` calls raw `setRun`, which does not persist, so `localStorage` keeps the pre-assignment pool and a reload resurrects it | **B** |
| 2 | The pool is not emptied after a hand-over; the section still reads «مسیر فعلی» for a route already given away | **B** |
| 3 | «ثبت بازدید» is rendered on every stop for managers, wired to `() => {}` | **D** |
| 4 | `onAddDayToRun` / `onCreateListFromDay` are passed and never rendered | **E** |
| 5 | *Corrected — see below* | **F** |
| 6 | The same `onTapFlow` prop means two different things by role | **D** — was never a separate defect, it is #3 |
| 7 | Nothing records that the hand-over happened or who received it | **C** |
| 8 | `unassignedLocations` rebuilds a `Set` per location per render, with an `any` cast | **F** |

### #5, corrected

Originally written as "the map and the pool disagree; a pin is silently dropped". That is
wrong. `setRunStops` **throws** `LeadRunError(404)` when a pin is missing, so a bad pin
fails the save loudly and the pool correctly stays put.

The real, smaller problem is a pre-flight gap: a route can be built containing a pin that
can never be assigned, and you only learn that at save time. Reachable through a saved list
holding a since-deleted location id, since `openList` loads ids without checking they still
resolve.

## Design

### A · The hand-over writes nothing until the undo window ends

Tapping «ثبت و سپردن» starts two things together: a toast carrying a **لغو** action, and a
5 s timer. The write happens when the timer ends, not when the button is tapped.

- **لغو** → timer cleared. Cost is zero, because nothing was ever sent.
- **timer expires** → the POST fires, and a success toast replaces the first.

This is the app's existing mechanism, not a new one. `ToastProvider` gives a toast with an
action a lifetime of `ACTION_LIFETIME_MS`, which **is** `OUTBOX_HOLD_MS` (5000), and its bar
already drains. It also pauses on hover, focus and a hidden tab, so the deadline cannot
expire while someone is reaching for it.

The drain bar **leaves the button** and lives in the toast, where it means "still yours"
rather than "about to happen". The auto-submit is removed: an auto-submit is a write nobody
chose, and the write now only happens after a real tap.

The hand-over deliberately does **not** enter the outbox. `mayQueueOffline` is false for
claims, and this is one — `order.plan` ("برنامه‌ریزی سفارچس روی مسیر") is the precedent. A
route nobody has driven yet is an intention, not a record of something that happened.

### B · The pool empties, and stays emptied

`onAssigned` calls `updateRun([])`, which sets state **and** persists to
`localStorage["coverage_lead_run"]`. «سپردن مسیر دیگر» closes the sheet, because the pool is
empty and the next route is built from the pool above.

### C · A permanent record

When the pool is empty, the section shows «آخرین سپرده‌شده: رضا احمدی · ۱۴۰۵/۰۶/۰۶ · ۵ توقف».
Client-side under its own `localStorage` key: it is a per-manager convenience, not shared
state, so it needs no schema and no query. Absent on a first visit, which reads correctly —
nothing has been handed over yet.

### D · The visit button stops lying

`RunPanel` renders «ثبت بازدید» whenever `onTapFlow` is truthy. The manager's handler is
removed, so the button is never rendered for them. A visit outcome belongs to whoever
actually visited, and a tappable control that silently does nothing is worse than its
absence.

### E · The day-split gets its two actions

Each proposed day carries «افزودن به مسیر» and «ذخیره به‌عنوان فهرست». Both callbacks are
already implemented in `page.tsx` and currently unreachable, so this renders them rather
than writing new logic.

The list action uses a generated title — «روز ۱» — and the existing rename flow, rather than
a per-day text input. A text field per proposed day is more friction than a save-as-list
earns, and the name is trivially editable afterwards.

### F · Correctness cleanups

**Pre-flight.** The pool cannot contain a location that will fail to assign. `runLocations`
already filters to routable ids, so the remaining path is a saved list holding a deleted id.
`openList` intersects the loaded ids with the ids that still resolve, and the run is the
filtered set. A location deleted while sitting in a pool is already removed by `remove`.

**`unassignedLocations`** hoists its `Set` out of the per-item rebuild and drops the `any`.

**`RoutableLocation = any`** in `RouteSection` becomes the real `RoutableLocation` from
`useLeads`. This belongs here rather than in a cleanup pass: the day-split handlers being
added consume exactly these values, and typing them means the call sites are checked rather
than waved through.

## Data flow

```
tap ثبت و سپردن
  └─ toast(info, action=لغو)  ─┬─ clicked → clearTimeout → nothing sent
     └─ setTimeout(5000)       │
        └─ POST /api/lead-runs │
           ├─ 201 → onAssigned → updateRun([]) → persist → success toast
           ├─ 409 → error toast, pool untouched, retryable
           └─ 404 → error toast naming the missing location
```

The 409 is the busy-day guard, unchanged. The 404 is #5's pre-flight failing, and #5's fix
means it should no longer be reachable from a list.

## Error handling

Nothing is written until the window ends, so a cancelled hand-over needs no cleanup. A
failed POST leaves the pool exactly as it was, which is right — the save did not happen.
The error toast is a plain failure toast with no action, so it lives its normal lifetime
rather than the 5 s undo window, which would be meaningless for something already failed.

## Testing

No component tests exist in this repo and none are being added. What is testable is pure:

- the drain/hold pair is one number — assert the toast lifetime and the timer use the same
  `OUTBOX_HOLD_MS`, which is a guard against the two drifting apart
- `openList`'s id intersection, extracted as a pure function, is unit-tested against a list
  naming a deleted location
- the existing `tests/api/lead-runs.test.ts` collision cases still hold: a 409 on an active
  day, a 200 on a `done`-day override

The rest is wiring, verified by types and by looking at it.

## Trade-off

**The driver now sees the route about five seconds later** than before. That is the cost of
an undo window that destroys nothing. The alternative is a toast offering «لغو» for a write
that is already live, which is the worse of the two.
