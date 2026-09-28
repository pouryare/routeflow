# Leads: assignment awareness and the list bar

**Date:** 2026-09-27
**Status:** approved
**Surface:** `/leads` — the pool, the day split, and the hand-over

## Why

The page is a manager's notebook. It knows every lead, every saved list, and the route
currently being built. It does not know that Reza already has six of those leads assigned to
him. So:

- the pool offers leads that are already spoken for
- the day split plans days containing them
- a hand-over to a second driver is accepted, silently
- and a list saved with **ذخیره به‌عنوان فهرست** cannot be seen, loaded, renamed or deleted,
  because no UI for lists has ever been built

The server does not catch the double-booking either. `createOrReuseLeadRun` checks driver and
date, and nothing else, so nothing stops the same restaurant going to two drivers.

## Diagnosis

Five separate gaps, all with working backend and missing or wrong front end.

1. **The page never asks.** `/leads` fetches `/api/locations` and `/api/lead-lists`. It never
   fetches runs, so it cannot know who has what.
2. **`openList` is never called.** It is destructured in `page.tsx` and appears nowhere else
   in the codebase. `lists`, `activeListId`, `newListName`, `deleteList` and `renameList` are
   all destructured and unused. ESLint was reporting this the whole time; the warnings *were*
   the bug report.
3. **No list bar exists.** The empty-state copy already promises one — *از فهرست بالا* — and
   there is nothing above but the import panel.
4. **`createList` overwrites the current route.** It ends with `setActiveListId(id); setRun(ids)`,
   so a button reading "save a copy" throws away the route being built. This is how list #8
   exists with zero stops.
5. **The server permits double-booking.** Only driver+date is checked.

## Design

### A · One lookup table

A new endpoint, `GET /api/lead-runs/assignments`, returns a flat list scoped to the manager:

```json
[{ "location_id": 14, "driver_name": "رضا احمدی", "run_date": "2026-09-27" }]
```

`readLeadRunAssignments` in `lib/repo/leadRuns.ts` is one join over `lead_run_stops` →
`lead_runs` → `users`, filtered to `status != 'done'`, ordered newest first. No stop
hydration: the pool renders a name and nothing else, and the full roster endpoint's payload
grows without limit.

`useLeads` turns the list into a `Map<location_id, { driverName, runDate, runId }>`. Every
consumer reads that one map, so the pool, the map, the split and the cards cannot disagree.

**Why not reuse `GET /api/lead-runs`:** it hydrates every stop with name, address, coordinates,
status, outcome and two ratings, for the whole roster. `assignableDrivers`,
`readTodaysLeadRun` and `readScopedLeadRuns` are each one shape for one screen; this follows
the same rule.

**Why not denormalize onto `saved_locations`:** runs get overridden, reopened and deleted, so
a column on the location row would drift with nothing to notice it.

Fetched alongside locations and lists; re-fetched on load, after a hand-over, and after a run
or list is deleted. Never polled — the pool must not shift under a manager mid-task.

**A lead on two unfinished routes** is a data anomaly. Newest wins, which is what "first row
seen" already gives us, since the query orders by `run_date DESC, id DESC`.

### B · The pool: hidden by default, with a toggle

One switch beside the search box: **نمایش مکان‌های سپرده‌شده**, off by default. Off, the pool
is the honest working set.

Applied inside `useLeads` so four consumers change together: the pool list, the map, a fresh
split, and the header count. The split inheriting the filter is the point — a pool that hid a
lead while the split still offered it is the exact bug being fixed.

**Never hide by silence.** A line above the pool always states what is hidden:

> ۶ مکان در مسیر رضا احمدی و سارا محمدی پنهان است · نمایش

and **همه مکان‌ها آزاد هستند** when nothing is assigned.

### C · The driver label

`LocationCard` is rendered by five of the eight pool views — مختصر (the default), شبکه‌ای,
کانبان, گروهی, خوشه‌ای — and already has a badge row holding the priority and run chips. One
optional prop and one line there covers five views. جدولی gets a column.

**جیبی and امتیاز are left out.** Both render bespoke single-line rows where a badge would
crowd the name, and the toggle is off by default, so they are only "wrong" after the manager
has deliberately asked to see assigned leads.

> رستوران پارس — ‹ در مسیر رضا احمدی · ۱۴۰۵/۰۶/۰۶ ›

Muted, not a warning colour: a lead on Reza's route is doing its job.

### D · The split

No new logic. `proposeDays` already builds from `routable`, which is now the filtered list, and
`daysNeeded(routable.length, stopsPerDay)` drives the button label, so it never promises days
it cannot fill. The per-day dropdown reads `unassignedLocations`, derived from the same set.

Dragging an assigned lead is only physically possible with the toggle on, and is refused with
the same toast as a tap.

The exact-size behaviour is unchanged: the typed number is each day's size, remainder last.

**The empty case's message is wrong today.** With everything assigned it says *مکانی با
مختصات برای تقسیم وجود ندارد* — true, and useless. Replaced with a message naming the drivers
and pointing at the toggle.

### E · After a hand-over, the proposal loses only what was handed over

**سپردن مسیر assigns the current route, not a proposed day.** Those differ: the route may be
exactly one day (via **بردن به مسیر**), or a mixture drawn from several. So the rule is not
"clear that day" but "remove the assigned location ids from wherever they sit in the proposal".

| | before | hand over 8 | after |
|---|---|---|---|
| روز ۱ | 8 stops | all 8 | gone |
| روز ۲ | 8 stops | untouched | 8, unchanged |
| روز ۳ | 4 stops | 3 were in the route | 1 |

Days that lose every stop disappear; `removeFromDayGroup` already drops empties, and the same
rule is applied here.

**The filter must never touch a proposal.** An existing پیشنهادات روز is a draft being shaped.
If the assignment filter applied to it, handing over روز ۱ would strip روز ۲ and روز ۳ as well
and destroy a tuned proposal. The filter covers the pool, the map and a *fresh* split only;
a hand-over edits the proposal through this explicit removal.

**Assigned leads already in the current route stay there.** We do not silently delete work; the
badge appears on its pool card and clearing it is the manager's call.

Extracted as a pure function — "handed over these ids; what remains of the proposal?" — because
it is the piece most likely to be subtly wrong.

### F · The list bar

A `CollapsibleSection` above the pool, matching **تنظیمات** and the day-split section on the
same page. Rows: name, stop count, load on tap, with the active one highlighted. Rename and
delete are small icon buttons per row; delete confirms, and the existing undo toast works
because the server already returns the deleted row.

A row rather than chips: nine lists exist already, and each needs three actions. Chips run out
of room, and Persian names need the width.

This is the position the empty-state copy already promises.

### G · Two `createList` bugs

1. **Creating a list must not touch the route.** Removing `setActiveListId`/`setRun` from
   `createList`; only an explicit tap on a row loads. The button means what it says.
2. **No empty lists.** **ذخیره به‌عنوان فهرست** is disabled on an empty day, with the reason on
   the label. List #8 is the evidence this is needed.

### H · The server guard

`createOrReuseLeadRun` refuses a stop already on another driver's **unfinished** route:

> مکان «رستوران پارس» در مسیر سارا محمدی است

A 409, the same shape as the existing busy-day rejection, so the assign sheet's error handling
covers it. Checked inside the existing transaction, so nothing partial is written.

`done` routes do not block — the same predicate as the client filter, which is what keeps the
two from disagreeing.

| | purpose | if it fails |
|---|---|---|
| browser filter | clarity — the pool only shows what is available | cosmetic |
| server guard | correctness — a lead cannot be on two drivers' routes | nothing written |

The filter is convenience; the guard is the rule. A filter that can be lost by one failed
request is not a safety mechanism.

## Error handling

**A failed assignments fetch** shows a persistent banner, not a toast:

> ⚠ وضعیت سپردن مکان‌ها بارگذاری نشد. فهرست ممکن است مکان‌های در مسیر رانندگان دیگر را هم نشان دهد.

The pool keeps working and the server guard catches anything that slips through. Blocking the
page until the data loads would make `/leads` unusable on a flaky network — a worse trade than
a warning plus a backstop.

**A 409 on hand-over** lands in the assign sheet's existing failure state, naming the driver
and the lead. Nothing is written, and the pool is untouched because the route was not yet
emptied.

## Testing

No component tests in this repo, so weight goes on the server and the pure parts.

- `readLeadRunAssignments` — excludes `done`, scopes to group for a manager and org for an
  owner, one row per location, newest wins on a duplicate
- the guard — refuses a stop on another's unfinished route and names the driver; allows a stop
  on a `done` route; is not bypassed by the override path; writes nothing on rejection
- the proposal reduction — a run of ids is removed from whichever days hold them, empty days
  disappear, untouched days keep membership *and* order
- the exact-size split tests stay, so filtering cannot break the 8-per-day promise

Badge placement, the list bar and the toggle are wiring, verified by types and by looking.

## Not included

List copy/paste, reordering, or sharing between users. A list remembers nothing about the
split that produced it — re-splitting is one button press. Only unfinished routes are ever
considered; there is no archive view.
