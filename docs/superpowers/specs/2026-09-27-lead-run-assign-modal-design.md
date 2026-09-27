# Lead-run assign modal — design

**Date:** 2026-09-27
**Status:** approved
**Surface:** the `سپردن مسیر` hand-over sheet (`components/leads/LeadRunPlannerTabFlow.tsx`)

## Why

The sheet is a manager handing a day's route to a driver. It currently reads as a form that
was never finished: the driver is a closed dropdown, the date is a Gregorian picker in an
otherwise Shamsi app, the confirmation says only "N stops", success is declared before the
write lands, and assigning to a day the driver already has silently discards the stops you
just picked. Two CSS class names the markup uses (`tap-grid`, `tap-done`) do not exist.

This is a redesign of that one sheet, aligned to `docs/tap-flow-principles.md`.

## Defects found

| # | Defect | Where |
|---|---|---|
| 1 | `tap-grid one` used 3×; no `.tap-grid` rule exists — those containers get no grid, no gap | modal ×2, `LocationTapFlow` |
| 2 | `tap-done` used 2×; the real class is `tf-done` — success panel unstyled | modal, `LocationTapFlow` |
| 3 | `done` renders "مسیر سپرده شد" synchronously on `saved`, before the POST resolves; `assign()`'s early return leaves it stuck | `assign`, `done` |
| 4 | `subtitle="lead_run"` — a machine key shown to users | `<TapFlow>` |
| 5 | Submit step confirms blind: shows only "N stops", not who or which day | submit step |
| 6 | Done screen has no next action (§8 anti-pattern) | `done` |
| 7 | Single driver is auto-selected (§9: "never pre-selected") | fetch effect |
| 8 | `run_date` optional in the UI but `assertIsoDate("")` throws 400 — reachable | date step |
| 9 | Reuse branch returns the old run **without** `setRunStops`, so new stops are discarded while reporting success | `createOrReuseLeadRun` |

**Not a defect:** the six progress dots on a three-step flow. `tap-flow-principles.md` §2
shows six dots and calls progress "approximate on a tree". Left alone.

## Design

### Driver step — a picker of people

Not a dropdown (§8: "a dropdown inside a sheet … needs chips or a search step"). An
auto-fit grid, two-up on a phone and three-up where there is room:

```css
.meridian .tapflow .tf-grid.people {
  grid-template-columns: repeat(auto-fit, minmax(158px, 1fr));
  max-width: 512px;  /* .sheet has no max-width, so without this a desktop gives 9 columns */
}
```

Cells stay horizontal (avatar beside name) and are never narrower than 158px, which is where
a Persian name fits. The name truncates with an ellipsis and carries `title`. Each card
shows a line under the name — «۳ روز مسیر دارد» — so a driver with a free week is visible
before the calendar is ever opened. Persian has a singular for one: 1 reads «۱ روز», 2 and
up read «N روز», and 0 shows no line at all rather than «۰ روز».

`DriverPicker` owns this and nothing else.

### Date step — Shamsi, and required

`JalaliDateInput` replaces `<input type="date">`. It is a drop-in: it emits ISO
`YYYY-MM-DD`, exactly what the native input emitted, so `assign()` and the API contract are
untouched. Only the reading and the picking become Jalali.

`required` is passed, which hides «پاک کردن» — the date cannot be cleared into the state
`assertIsoDate` rejects. «ادامه» is disabled until a date is chosen, closing defect 8. The
date defaults to today, and is shown in the summary and done panel, so it is a visible
default rather than a silent one.

### Busy dates

One extra fetch: the manager's existing `GET /api/lead-runs` already returns every run with
`driver_user_id`, `run_date`, `status`. `busyDatesByDriver(runs)` folds it into
`Map<driverId, Map<iso, status>>`. No new endpoint.

`JalaliDateInput` gains one optional prop, `isDisabled(iso) => boolean`, defaulting to
nothing disabled so its other call sites are unaffected. A blocked day renders dimmed with a
hairline strike and `aria-disabled`, and does not take the pick. A caption under the field
counts them.

- `planned` / `in_progress` — **hard blocked**. An active day cannot be double-booked.
- `done` — **pickable**, because overriding a completed day is an explicit requirement.

### Submit step — the confirm is the confirm

No fourth question. The submit screen already is a deliberate confirmation, so a `done` day
merely grows a warning line and the button becomes «جایگزینی و سپردن». `RunSummary` renders
the driver, the date and the stop count on both the submit screen and the done panel, so no
value is applied that was not shown (§8, silent defaults).

### Done panel — three phases

Derived, not stored: `donePhase({ saving, message })` → `saving | ok | bad`.

- **saving** — "در حال ثبت…". No success is claimed before the write lands.
- **ok** — the summary, «۵ ثانیه دیگر بسته می‌شود», and two actions: **همین حالا** (close) and
  **سپردن مسیر دیگر** (reset to step 1, keeping the date as a visible default). Auto-closes
  after 5s.
- **bad** — the error and **تلاش دوباره**, which re-POSTs; the flow is already `saved`, so
  this is just calling `assign()` again. **No auto-close on failure.**

`assign()` always produces a message, including on its early return, so `bad` is reachable.

The 5s return is a local `DONE_AUTO_CLOSE_MS` in `AssignDone`, not `OUTBOX_HOLD_MS`: that
constant is how long a *queued* mutation is held back before it is sent, which is a
different thing from how long a finished sheet stays on screen. The two share a value
because the doc fixes one undo/return window app-wide (§1), not because they are one thing.

### Server — where the data is actually protected

UI-only blocking would leave the discard path open to a direct POST, so the rule is enforced
in `createOrReuseLeadRun`, which gains `override?: boolean`:

| collision | override | result |
|---|---|---|
| none | — | insert (unchanged) |
| `planned` / `in_progress` | either | **409**, always |
| `done` | no | **409** «این روز قبلاً تکمیل شده» |
| `done` | yes | `setRunStops` on that run, status back to `planned`, `finished_at` cleared, `reused: true` |

`UNIQUE (driver_user_id, run_date)` means a driver can hold only one run per day, so an
override replaces rather than inserts. `setRunStops` already deletes and re-inserts, so the
primitive exists. The UI sends `override: true` only after the user has seen the warning.

This also closes defect 9: the reuse branch now either refuses or actually writes.

## Components

| Unit | Job | Depends on |
|---|---|---|
| `lib/leadRunAssign.ts` | pure: `busyDatesByDriver`, `donePhase`, `summaryOf` | `lib/jalali`, `lib/format` |
| `components/leads/assign/DriverPicker.tsx` | the people grid | `meridian/Avatar` |
| `components/leads/assign/RunSummary.tsx` | who / what day / how many | — |
| `components/leads/assign/AssignDone.tsx` | the three-phase done panel | `RunSummary` |
| `LeadRunPlannerTabFlow.tsx` | flow state, the two fetches, the POST | the three above |

The host keeps the three-step renders it already has. Nothing new is asked of `TapFlow`, and
`lib/crm/flows/leadRun.ts` is unchanged — the confirm is the existing submit step.

## Testing

This repository has no component tests: no `@testing-library`, no `.test.tsx`, and
`LocationTapFlow.test.ts` tests the flow machine rather than the component. That is not being
changed. Everything testable is therefore pure and lives in `lib/leadRunAssign.ts`:

- `busyDatesByDriver` folds runs, ignores other drivers, keeps status per date
- `donePhase` maps saving/message to the three phases, including the stuck case
- `summaryOf` renders the Shamsi date and Persian digits, and the empty-driver case

`tests/api/lead-runs.test.ts` gains the server rules. Its existing case — *"refuses a second
run for the same driver and day"* — asserts `200` + `reused: true` and becomes a `409`. The
test's intent (exactly one run per driver-day) is preserved; only the mechanism changes from
silent reuse to explicit refusal. New cases cover the hard block and the `done`-day override,
including that the override actually replaces the stops.
