# Implementation Plan — Adaptive `/leads` (Manager + Driver)

## [Overview]

One page, two views. A manager keeps the prospect pool, import, day-split and route building; a
driver sees only their assigned route, a next-stop banner, and what happened at each stop.
`lead_runs` becomes the route-runs backbone.

Two business rules drive it:

1. **A lead becomes a customer when it buys.** A manager may still convert by hand.
2. **A driver reports; the office decides.** A driver records what happened at the door. The
   follow-up is derived, not chosen.

Your three real-world outcomes map onto a vocabulary the codebase already has, and each needs
one decision recorded and one task created:

| What happened | Recorded as | Derived follow-up | Who acts |
|---|---|---|---|
| Owner not there | `VISIT_NO_OWNER` | revisit, +1 day | driver, next round |
| Bought on the spot | `READY_TO_BUY` | **order** → customer | driver records, office fulfils |
| Doubts / timing / other supplier | `INTERESTED` | call, HIGH | phone sales |

`applyLeadVisit` (`lib/repo/crm/write.ts:240`) **already** writes `visit_outcome` and **already
creates two of these three tasks**: `reminder` for retries (line 288) and `call` for
`handoff_sales` (line 303). So most of this plan is connecting what exists.

### The design principle: reuse, don't reinvent

An earlier draft of this plan invented a `LeadDesire` state enum, a run table shape, and a
dedup step. Every one of those already exists in this codebase under a different name. This
version reuses them, which is smaller, and — more importantly — keeps the leads surface from
drifting away from the CRM that already owns the truth.

| Need | Reuse | Not |
|---|---|---|
| Lead state | `customers.lifecycle` + `recomputeState` | a new `LeadDesire` state |
| Run table shape | `delivery_runs` (`lib/db.ts:1148`) | a bespoke `lead_lists` extension |
| Offline retry safety | `ux_lva_client_uuid` (`lib/repo/crm/migrate.ts:91`) | a new idempotency scheme |
| Duplicate prevention | `findDuplicates` (`lib/repo/crm/dedupe.ts:26`) | a second dedup path |
| Outcome vocabulary | `OUTCOMES` (`lib/crm/outcomes.ts:30`) | new codes |

### The two real gaps

**The `READY_TO_BUY` path is a dead end.** `leadVisitFlow` sets `outcome: "READY_TO_BUY"` and
jumps to a `convert` step asking the driver «تبدیل به مشتری؟» — wrong under both rules (the
driver cannot decide commercially; conversion should follow the order). Worse, the answer is
**discarded**: `convert_location` is set but read nowhere (`write.ts:235` defers to "the
caller", and the only caller ignores it). A driver is asked a question whose answer vanishes.

**A lead cannot buy.** `POST /api/sales/orders` requires an existing `customers.id`
(`app/api/sales/orders/route.ts:59`); a lead lives in `saved_locations`. There is no lead→order
path at all. Conversion-by-purchase is missing, not broken.

## [Types]

### Single source of truth for lead state

`saved_locations.visit_outcome` is **one fact about one visit**. `customers.lifecycle` is
**where the lead stands**. They are different things and this plan keeps them separate:

```ts
// Fact about the most recent visit. Already exists: saved_locations.visit_outcome.
// Only ever written by applyLeadVisit. Never treated as state.
export type VisitOutcome = typeof OUTCOMES[number];

// Where the lead stands. Already exists: customers.lifecycle, CHECK IN
// ('lead','qualified','sampled','active','dormant','lost','blocked').
// NEVER written directly -- recomputeState derives it from the activity log
// (lib/repo/crm/state.ts:8 -> lifecycleFor(sales_stage, lifecycle)).
```

**Consequence:** there is no `LeadDesire` state enum. The driver UI needs friendly labels, so it
gets a *display* mapping only — pure, derived, no persistence:

```ts
// lib/leadDesire.ts -- presentation only. The driver sees a word; the office sees the code.
export function desireLabel(outcome: VisitOutcome | null): string;
export function nextActionFor(outcome: VisitOutcome | null):
  | { kind: "revisit"; dueInDays: number }
  | { kind: "call"; priority: "HIGH" }
  | { kind: "order" }
  | null;
```

`nextActionFor` is where rule 2 is enforced: the driver cannot promote a lead to "needs a sales
call" because no such option exists. They report; the mapping decides.

### New — run assignment

Modelled directly on `delivery_runs` (`lib/db.ts:1148`), including the constraint that makes it
work:

```sql
CREATE TABLE IF NOT EXISTS lead_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_user_id INTEGER NOT NULL REFERENCES users(id),
  group_id INTEGER REFERENCES groups(id),
  run_date TEXT NOT NULL,                    -- ISO 'YYYY-MM-DD', validated on write
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','in_progress','done')),
  planned_by INTEGER NOT NULL REFERENCES users(id),
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (driver_user_id, run_date)          -- one run per driver per day
);
CREATE INDEX IF NOT EXISTS idx_lead_runs_driver ON lead_runs(driver_user_id, run_date);
```

`UNIQUE (driver_user_id, run_date)` is the constraint the earlier draft was missing. Without it
a manager can create two lead runs for one driver on one day and the driver sees an arbitrary
one. `routing.ts:327` is the select-then-reuse upsert to copy.

Stops keep using the existing `lead_list_items` ordered membership — it already is an ordered
list with `sort_order` and a cascade that keeps it clean.

```ts
export interface DriverStop {
  locationId: number; name: string; address: string | null;
  lat: number; lng: number; sortOrder: number;
  visitOutcome: VisitOutcome | null;   // fact
  label: string;                       // display mapping
  nextAction: LeadNextAction;          // derived
  visitedAt: string | null;
  handedOff: boolean;                  // task created -> no longer this driver's next stop
}
```

`handedOff` is derived from the open `tasks` row, not stored on the lead: a lead that generated
a call task has left the driver's list even though the driver never touched it again.

## [Files]

### New

| Path | Purpose |
|---|---|
| `lib/leadDesire.ts` | `desireLabel` + `nextActionFor`. Pure, no I/O. Where rule 2 is enforced and unit-tested. |
| `lib/repo/leadRuns.ts` | `upsertLeadRun` (select-then-reuse, per `routing.ts:327`), `readDriverRuns`, `assignableDrivers`, `setRunStatus`. |
| `lib/db.ts` → `promoteLeadToCustomer` | **Rule 1.** `saved_locations` → `customers`, dedup-guarded, idempotent, **no DELETE**. |
| `app/api/lead-runs/route.ts` | `GET` (driver: own run / manager: group's), `POST` (manager: assign). |
| `app/api/lead-runs/[id]/route.ts` | `PATCH` status / reassign; `GET` one run. |
| `components/leads/NextStopBanner.tsx` | Driver-only: next unvisited, un-handed-off stop. |

### Modified

| Path | Change |
|---|---|
| `proxy.ts` | Allowlist `/leads`, `/api/lead-runs` for `driver` (`isDriverBriefing`, line 173). Nothing is reachable without this. |
| `lib/appNav.ts` | `/leads` `ready` is `isRepLead(r)` (line 70) — a driver gets a disabled span. Include `driver`; add a driver branch in `appTabs` (line 58) so the shell stops advertising tabs proxy refuses. |
| `lib/db.ts` | `CREATE TABLE lead_runs`; add `customers.lead_location_id`. Both via the guarded migration pattern (`lib/db.ts:2654`), not the `CREATE TABLE` at line 938. |
| `lib/crm/flows/leadVisit.ts` | Delete the `convert` step (52-58). Route `READY_TO_BUY` to a new `sold` step capturing *what was ordered*. |
| `lib/repo/crm/write.ts` | Remove the dead `convert_location` branch (line 235). Add the `order` task beside the existing `reminder` (288) and `handoff_sales` (303) branches. |
| `app/api/leads/locations/[id]/visit/route.ts` | Already accepts `driver` (line 12). Restrict to locations on the caller's own run; return `label` + `nextAction`. |
| `app/api/sales/products/route.ts` | GET is `owner`/`group_manager`/`salesperson` (line 11) — a driver cannot record what was sold. Add `driver`. |
| `app/api/sales/orders/route.ts` | **Two changes.** (1) `CAN_SELL` is the same three roles (line 6) — a driver cannot place an order at all, so add `driver`. (2) Accept `lead_location_id`, calling `promoteLeadToCustomer` inside the order transaction and using the returned id. Approved: the `driver` role is both field rep and delivery driver. |
| `lib/driverCommissionLedger.ts` | Line 161 resolves unset and deliberately-zero rates to the same `0`. Carry the distinction into the statement row (spec §15.2). |
| `app/api/locations/[id]/convert/route.ts` | **Kept, per your decision.** Stop deleting the `saved_locations` row: `lead_list_items.location_id` is `ON DELETE CASCADE` (`lib/db.ts:952`), so the delete rips the lead out of every route — including the one the driver is standing on. |
| `app/(shell)/leads/hooks/useLeads.ts` | Branch `load()` — it `Promise.all`s two `owner`/`group_manager`-only endpoints, so a driver gets two 403s. |
| `app/(shell)/leads/page.tsx` | Driver branch; hide pool, import, search, day-split. Show outcome label + derived next action, no convert button. |
| `components/leads/RunPanel.tsx` | `onMove` / `onOptimise` / `onClear` manager-only. |

### Untouched, deliberately

- `lib/repo/crm/state.ts` — lifecycle is derived; `promoteLeadToCustomer` inserts the row and
  lets the activity log move it. It must not `UPDATE customers SET lifecycle`.
- `lib/repo/crm/conversion.ts` — `convertOnDelivery` is the post-order customer lifecycle.
- `lib/repo/crm/driverVisits.ts` — the `tasks` / `verify_visit` flow for existing customers.
- `app/(shell)/crm/page.tsx` — its `driver → /driver` redirect stays.
- `tests/tenancy-schema.test.ts` — `lead_list_items` is already exempt "through lead_lists".

## [Functions]

### New

- `desireLabel(outcome)` / `nextActionFor(outcome)` — pure.
- `upsertLeadRun(orgId, driverId, runDate, plannedBy, groupId)` — select-then-reuse, mirroring
  `routing.ts:327`.
- `readDriverRuns(session)` — `lead_runs` → `lead_list_items` → `saved_locations`, plus a LEFT
  JOIN on open `tasks` to derive `handedOff`.
- `promoteLeadToCustomer(db, locationId, session, nowIso): number` —
  1. `findDuplicates` on `{ name, lat, lng }`; on a **reachable** match, return that customer's
     id instead of inserting.
  2. On an **unreachable** match (redacted, `id: null`), **refuse** — a driver must not be
     linked to, or told about, a business outside their reach. Surface "call the office".
  3. Otherwise insert with the deterministic `LEAD-<id>` code, set `lead_location_id`, and
     **keep the pin**.
  4. Idempotent: a repeat call returns the existing id (`UNIQUE (organization_id,
     customer_code)` at `lib/db.ts:2819` plus the deterministic code).
- `assignableDrivers(session)` — mirrors the query at `app/(shell)/sales/commission/page.tsx:71`.

### Modified

- `applyLeadVisit` — add the `order` task branch for `READY_TO_BUY`; delete the dead
  `convert_location`.
- The manual convert route — same customer row, but **keeps the pin**.
- `load()` — branch on role.

### Removed

The `convert` step in `leadVisitFlow`; the `convert_location` `FlowSet` key
(`lib/crm/flows/types.ts`); its dead branch at `write.ts:235`.

## [Classes]

None. No classes in the touched surface.

## [Dependencies]

**No new packages.** `node:sqlite`, `react-leaflet`, `leaflet-routing-machine`, and the in-repo
`@/lib/geo`, `@/lib/navApps`, `@/lib/session`, `@/lib/crm/*`, `@/lib/jalali` helpers all exist.

## [Testing]

- `tests/lead-desire.test.ts` — **rule 2, pure:** every `VisitOutcome` maps to a label and to
  the intended next action. No database. This is where "the driver cannot choose the follow-up"
  is proven.
- `tests/api/lead-first-purchase.test.ts` — **rule 1:** an order with `lead_location_id` creates
  exactly one `customers` row; the `saved_locations` row **survives**; ordering twice does not
  duplicate; a cross-tenant lead is 404; a **redacted duplicate refuses** rather than linking.
- `tests/api/locations-convert-retains.test.ts` — the manual convert no longer deletes, and the
  pin stays in its `lead_list_items` membership.
- `tests/api/lead-visit-routing.test.ts` — `READY_TO_BUY` → `order` task; `INTERESTED` → `call`;
  `VISIT_NO_OWNER` → `reminder`; a request carrying `convert` is **rejected**, not ignored.
- `tests/api/lead-runs.test.ts` — **one run per driver per day** (the `UNIQUE` constraint);
  cross-driver 404; manager 403; `run_date` format rejected on write.
- `tests/api/lead-lists-driver.test.ts` — own runs only; cross-tenant id 404; unassigned driver
  gets `[]`; a handed-off lead is not offered as next stop.
- `tests/proxy.test.ts` / `tests/appNav.test.ts` (extend) — driver reaches `/leads`; owner nav
  unchanged.

## [Implementation Order]

### Phase 0 — Make the page reachable

1. `proxy.ts`: allowlist `/leads`, `/api/lead-runs`.
2. `lib/appNav.ts:70`: `driver` gets `/leads`; driver branch in `appTabs` (line 58). Both
   renderers — `AppHeader.tsx:40`, `PageHeader.tsx:38` — call it unfiltered.
3. Verify: `npx vitest run tests/proxy.test.ts tests/appNav.test.ts`.

### Phase 1 — Name the outcomes (pure, no I/O)

4. `lib/leadDesire.ts`: `desireLabel` + `nextActionFor`.
5. Verify: `tests/lead-desire.test.ts` — rule 2's whole vocabulary, proven without a database.

### Phase 2 — Close the `READY_TO_BUY` dead end

6. Delete the `convert` step; add a `sold` step capturing what was ordered.
7. `applyLeadVisit`: add the `order` task branch; drop the dead `convert_location`.
8. Open the two order gates to `driver`: `GET /api/sales/products` and `POST /api/sales/orders`.
   Neither admits a driver today, so an on-the-spot sale is not recordable by anyone.
   **No commission change accompanies this** — commission is for orders only, and because one
   person both sells and delivers, the existing per-kg accrual already pays them (spec §15).
9. Verify: `tests/api/lead-visit-routing.test.ts`.

### Phase 3 — Rule 1: conversion by first purchase

10. Schema: `lead_runs` (with the `UNIQUE`), `customers.lead_location_id`.
11. `promoteLeadToCustomer` — dedup-guarded, idempotent, no DELETE, `LEAD-<id>` preserved.
12. `POST /api/sales/orders` accepts `lead_location_id` and promotes in-transaction.
13. Manual convert route: stop deleting the pin.
14. Verify: `lead-first-purchase` + `locations-convert-retains`.

### Phase 4 — Runs and driver data access

15. `lib/repo/leadRuns.ts`; the two API routes; scope the visit route to the caller's own run.
16. Verify: `tests/api/lead-runs.test.ts` + `lead-lists-driver`.

### Phase 5 — Driver view

17. `useLeads` loader branch; `NextStopBanner`; `page.tsx` driver branch; `RunPanel` props.
18. Verify: manual manager and driver passes, then `npx vitest run`.

### Phase 6 — Manager assignment

19. `POST`/`PATCH` accept assignment; validate the assignee is an in-scope, active driver.
20. `run_date` validated as ISO at the Jalali picker boundary (`jalaliToIsoDate`,
    `lib/jalali.ts:204`).
21. Assignment dropdown fed by `assignableDrivers`.
22. Verify: full suite.

## [Risks]

| Risk | Severity | Mitigation |
|---|---|---|
| `proxy.ts` untouched → feature invisible | Critical | Phase 0 first, test-gated |
| Driver asked a convert question that is discarded | Critical | Phase 2 deletes it; test asserts rejection |
| A lead cannot receive an order at all | Critical | Phase 3 is a new capability, not a fix |
| Convert deletes the pin → cascades out of every route | Critical | Phase 3 step 13; retention test |
| Two runs for one driver on one day | High | `UNIQUE (driver_user_id, run_date)`, Phase 3 step 10 |
| Order path links a lead to an unreachable business | High | `promoteLeadToCustomer` refuses on a redacted match |
| Duplicate customers on offline retry | High | Deterministic `LEAD-<id>` + `UNIQUE (organization_id, customer_code)` |
| Lifecycle written directly, bypassing `recomputeState` | High | Phase 3 note: insert the row, let the log move it |
| Handoff not reflected in the driver's next stop | High | `handedOff` derived from the open task |
| Driver nav advertises tabs proxy denies | High | Phase 0 step 2 |
| `run_date` Jalali/Gregorian mismatch → invisible run | Medium | Validate ISO on write; convert at the picker |
| `plain()` omitted → null-prototype crash in a client component | Medium | `lib/db.ts:33`; every new response |
| Editing `CREATE TABLE` instead of the migration | Medium | Phase 3 step 10 |

## [Out of scope]

`/sales/routing` and delivery runs; the customers/tasks `verify_visit` flow; offline sync for the
driver app beyond the existing `clientUuid` retry guard; VROOM/weather for lead routes;
commission attribution for a driver-closed sale.

## [Resolved decisions]

Agreed 2026-09-25:

1. **A handed-off lead leaves the driver's run immediately.** `handedOff` is derived from the
   open `tasks` row, so a lead that generated a call task stops being that driver's next stop
   even though the driver never touched it again.
2. **`wants_call` does not advance `lifecycle`.** Only a real order moves
   `lead -> qualified -> active`; `lifecycleFor` derives it from the activity log, so an
   interested-but-not-bought lead stays `lead`.

## [Superseded prior decisions]

`docs/superpowers/specs/2026-09-18-adaptive-leads-page-design.md` locked **D4 = "Full
`leadVisitFlow` (navigate -> what_happened -> detail_status -> convert -> rate)"**. The `convert`
step asks the driver a commercial question whose answer is discarded (`convert_location` is
written and never read). This plan removes it; D4 needs amending when that spec is revisited.
