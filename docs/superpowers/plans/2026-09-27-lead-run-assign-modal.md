# Plan — lead-run assign modal

Spec: `docs/superpowers/specs/2026-09-27-lead-run-assign-modal-design.md`

Ordered so each step is verifiable on its own and the risky data rule lands before the UI
that depends on it.

## 1 · Pure helpers — `lib/leadRunAssign.ts` (new)

No I/O, so it is the only part of this change that is directly unit-testable in a repo with
no component tests.

- `busyDatesByDriver(runs)` → `Map<driverId, Map<iso, status>>`
- `blockedDates(runs, driverId)` → `Set<iso>` (only `planned` / `in_progress` are blocked;
  `done` stays pickable)
- `donePhase({ saving, message })` → `"saving" | "ok" | "bad"`
- `summaryOf({ driverName, runDate, stopCount })` → the fact lines, Shamsi + Persian digits
- `busyLabel(n)` → «۱ روز» / «۳ روز» / `null` for 0

Tests: `tests/leadRunAssign.test.ts`.

## 2 · Server rule — the part that protects the data

`lib/repo/leadRuns.ts` → `createOrReuseLeadRun` takes `override?: boolean`:

- no collision → insert, unchanged
- collision on `planned` / `in_progress` → 409, **even with** `override`
- collision on `done`, no `override` → 409
- collision on `done`, `override` → `setRunStops` on that run, `status='planned'`,
  `finished_at=NULL`, `started_at=NULL`, return `reused: true`

`app/api/lead-runs/route.ts` reads `override` off the body and passes it through.

This is what closes defect 9 (stops silently discarded) and makes UI blocking advisory
rather than load-bearing.

Tests: update the existing "refuses a second run" case from `200`/`reused` to `409`; add the
hard block and the `done`-day override, asserting the override really replaced the stops.

## 3 · `JalaliDateInput` — optional `isDisabled`

One optional prop, defaulting to nothing disabled so the other call sites are untouched.
Disabled days get `aria-disabled`, a dimmed struck style, and do not take the pick. `pick()`
is guarded too, so a keyboard Enter on a disabled cursor cannot land on one.

## 4 · CSS

- `.tf-grid.people` — auto-fit, `minmax(158px, 1fr)`, `max-width: 512px`
- `.tf-person` — `min-width: 0` and ellipsis on the name, so 3-up never breaks
- `.jdate__day[aria-disabled]` — dimmed, struck
- `.pick-note` — the muted caption under the picker
- `.tf-person` badge line

## 5 · The three new components

- `components/leads/assign/RunSummary.tsx` — who / what day / how many. Used twice.
- `components/leads/assign/DriverPicker.tsx` — the people grid + the busy-day badge.
- `components/leads/assign/AssignDone.tsx` — three phases, the 5s auto-close on success
  only, and the two actions.

## 6 · Rewrite `LeadRunPlannerTabFlow`

- fetch drivers **and** runs; build the busy map
- driver step → `DriverPicker`; **no** auto-select
- date step → `JalaliDateInput required`, blocked days disabled, `ادامه` disabled until a
  date is chosen, defaults to today
- submit step → `RunSummary`; a `done` day adds the warning and the button becomes
  «جایگزینی و سپردن»
- done → `AssignDone`; `assign()` always sets a message; sends `override` only when the
  warning was shown
- drop `subtitle="lead_run"`, `navAppId`, `onNavigate`, `navigateUrl`
- «سپردن مسیر دیگر» resets the flow in place (the page `key` only covers open/close)

## 7 · Neighbour

`LocationTapFlow.tsx`: `tap-grid one` → `tf-grid one`, `tap-done` → `tf-done`. Same defect,
one file over; leaving it broken next to a fixed sibling would be odd.

## 8 · Verify

`npx tsc --noEmit` · `npx eslint` on every touched file · full `vitest run` ·
`npm run build`. All four must be clean or show only pre-existing failures.
