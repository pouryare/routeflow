# Leads Location Tapflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-row status/select/scoring/convert controls on `/leads` with a single "شروع تاپ فلو" button that opens the CRM's TapFlow for one lead location, recording the driver's visit outcome, converting to a customer when appropriate, and handing off a follow-up task to the sales team when the lead is interested but needs a phone call.

**Architecture:** Reuse the existing `TapFlow` component + flow machine (`lib/crm/flows/machine.ts`) and `applyFlow` (`lib/repo/crm/write.ts`). Add a new flow config `driverVisit` (one per location), a new `driver_visit` entry on `FlowContext`, a new API route, and a new host component `LocationTapFlow` that mirrors `AfterCallFlow`. The `/leads` page drops the four inline controls per row in favour of one button.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind, TapFlow state machine, SQLite via `lib/repo/tasks.ts` (`createTask`) and `lib/repo/crm/write.ts` (`applyFlow`), Persian UI via existing vocab maps (`lib/crm/vocab.ts`, `lib/tasks/labels.ts`).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/crm/outcomes.ts` | Add visit outcome codes + Persian labels |
| `lib/crm/flows/types.ts` | Add `"driver_visit"` to `FlowContext.entry` |
| `lib/crm/flows/driverVisit.ts` (new) | The flow config: steps, options, branches |
| `lib/repo/crm/write.ts` | Extend `applyFlow` to handle `driver_visit` entry |
| `lib/repo/crm/migrate.ts` | Add `visit_outcome` column to `saved_locations` |
| `app/api/leads/locations/[id]/visit/route.ts` (new) | GET context + POST flow save |
| `components/leads/LocationTapFlow.tsx` (new) | Host wrapper: loads context, renders TapFlow, handles handoff to sales |
| `app/(shell)/leads/page.tsx` | Replace per-row controls with one "شروع تاپ فلو" button |
| `tests/leads-visit-flow.test.ts` (new) | Flow machine + repo tests |

---

## Task 1: Add visit outcome codes + `driver_visit` entry

- [ ] Add `VISITED`, `ACCESS_FAILED`, `READY_TO_BUY`, `NOT_INTERESTED`, `CLOSED`, `NO_OWNER`, `WRONG_ADDRESS`, `NEW_BUILDING` to `lib/crm/outcomes.ts` with Persian labels.
- [ ] Add `"driver_visit"` to `FlowContext.entry` in `lib/crm/flows/types.ts`.

## Task 2: Build the flow config `lib/crm/flows/driverVisit.ts`

- [ ] Steps: `navigate` → `what_happened` (موفق / ناموفق) →
  - **Success branch:** `detail_status` (آماده خرید / علاقه‌مند / بسته بود / صاحب‌ش نبود) → `convert_to_customer?` (بله / نه) → `rate` (5-star, maps to `rating_potential`/`rating_volume`/`rating_ease`).
  - **Failure branch:** `why` (بسته بود / صاحب‌ش نبود / آدرس اشتباه / ساخته جدید) → `reminder?` (بله + یک روز / نه) → `rate`.
  - **Partial-interest sub-branch:** when `detail_status` = "علاقه‌مند ولی نیاز به تماس", set `handoff: "talked_now"` so the host can spawn a sales task.
- [ ] Reuse `timeOptions`, `PICK`, `SKIP_STEP` from `./common`.

## Task 3: Extend `applyFlow` for `driver_visit`

- [ ] In `lib/repo/crm/write.ts`, handle `entry === "driver_visit"`:
  - Resolve the lead location row.
  - Map flow answers → `saved_locations` columns (`status`, `rating_potential`/`rating_volume`/`rating_ease`, `visit_outcome`).
  - When `acc.handoff` is set, call `createTask` with `kind: "call"`, `entity_type: "lead_location"`, `due_at` = tomorrow 10:00, `role_hint: "group_manager"`.

## Task 4: Migration

- [ ] Add `visit_outcome TEXT` column to `saved_locations` in `lib/repo/crm/migrate.ts` (guarded on `PRAGMA table_info`, like the rating columns in `lib/db.ts`).

## Task 5: API route

- [ ] Create `app/api/leads/locations/[id]/visit/route.ts`:
  - GET returns `{ ok, location, ctx }` where `ctx` is a minimal `FlowContext` with `entry: "driver_visit"`.
  - POST accepts `{ answers, client_uuid }` and calls `applyFlow`.

## Task 6: Component `components/leads/LocationTapFlow.tsx`

- [ ] Mirror `AfterCallFlow`'s pattern: fetch context on mount, own `FlowState`, call `TapFlow` with `config={driverVisitFlow}`.
- [ ] Render the `rate` step via `renderCustom` (use existing `StarRating`).
- [ ] On save show a `FlowDone`-style summary.
- [ ] When `acc.handoff` is set, render a "وکالت کار به فروشنده" button that POSTs to create the sales task.

## Task 7: Wire into `/leads` page

- [ ] In `app/(shell)/leads/page.tsx`, replace the per-row `<select>` (status), the "ometیازدهی" button, and the "تبدیل به مشتری" button with a single button: **"شروع تاپ فلو"** that opens `LocationTapFlow` for that row.
- [ ] Keep the existing delete + pin buttons.

## Task 8: Tests

- [ ] Write `tests/leads-visit-flow.test.ts`:
  - Flow machine transitions: success branch, failure branch, reminder branch, handoff flag.
  - Repo test: `applyFlow` with `driver_visit` writes `status`/ratings and creates a sales task when `handoff` is set.

## Task 9: Verify

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test -- leads-visit`.
- [ ] Manual `/leads` smoke test.
- [ ] Commit.