# `/leads` becomes manager-only, and `/driver` becomes "My Day"

**Date:** 2026-09-29
**Status:** approved, awaiting implementation plan
**Scope:** spec 1 of 2 (the routes/delivery/orders consolidation is a separate spec)

---

## 1. The problem

`isManager` is defined as `!isVanRole(role)` (`app/api/me/route.ts:16`). So `/leads` is
**not** split along a manager/driver line. It is split along *which hat is currently
active*, and one URL serves two entirely different applications.

| Reader | `/leads` renders | Data it fetches |
|---|---|---|
| `owner`, `group_manager` | the pin pool, 8 view modes, the map, saved lists, `RouteSection`, the «سپردن مسیر» hand-off | `/api/locations`, `/api/lead-lists` |
| `field_rep`, `delivery_driver` | `DriverRunView` — a next-stop banner and the rest of the day | `/api/lead-runs` |

Three consequences follow, all of them current bugs rather than preferences:

1. **A `phone_sales` rep is `isManager === true`.** They reach the manager-only surface
   at `leads/page.tsx:286-302`, including the hand-off-to-driver button, on a URL the
   proxy does not gate for them.
2. **A dual-hat person sees only one of their jobs.** `isManager` answers a single
   question, so a `field_rep` who also holds `delivery_driver` sees deliveries on
   `/driver` and prospect visits on `/leads`, and must navigate between two pages for
   one working day.
3. **The menu lies about the URL.** `appNav.ts:71` labels `/leads` «توقف‌های من» for a
   driver; `appNav.ts:100` labels the *same href* «پین‌های نقشه» for a rep lead. One
   destination, two names, depending on who is holding the keys.

`tests/proxy.test.ts:136-145` already documents this as "a dual-purpose page … Reachable
but empty is a weaker thing than refused." This spec closes that hole rather than
documenting it further.

## 2. What we are building

Two front doors, each with one job:

- **`/leads` — the office.** Manager-only. The pin pool and nothing else. No role
  branch in the page body.
- **`/driver` — "My Day".** Every van role. Both kinds of work they hold, in one page.

A driver keeps `/today` as a second door for the briefing (which carries the
failed-delivery `retry` panel that `/driver` has no equivalent for). The hat switcher
stays on `/today`, because its real job is changing hat to reach the office world — not
choosing which run to look at.

## 3. Design

### 3.1 `/leads` — remove the branch, do not copy it

Delete the driver branch at `leads/page.tsx:278-281` and the now-unused
`useDriverRun` / `DriverRunView` imports. `DriverRunView` **moves** to `/driver`.

Moving rather than copying is deliberate. A copy leaves two sources of truth for "my
stops," which is the exact failure `lib/roles.ts` documents when `db.ts` held a
hand-copied duplicate of the role union that then drifted.

`useLeads` keeps its `isManager` return. It still decides whether to load the manager's
pool, and the page is manager-only now, so the branch collapses to always-true.

### 3.2 The gate — one place, in the proxy

Remove `pathname === "/leads"` from the `isDriverBriefing` allowlist in `proxy.ts:196`.
The final `isVan` gate (`proxy.ts:207`) then catches a van role reaching `/leads` and
redirects to `/driver`.

Nothing new is written. The existing two-tier gate already expresses this, and adding a
second `/leads` check would be the drift the file's own header comment warns about.

`/api/leads/locations` and `/api/lead-runs` stay allowlisted — a driver still records a
visit at the door, now from `/driver`.

### 3.3 `/driver` — "My Day", two sections

Currently the page renders one thing: `readDriverRuns` → `delivery_runs`. It becomes two
stacked sections:

| Section | Heading | Source | Component |
|---|---|---|---|
| 1 | تحویل‌ها | `readDriverRuns(db, session.user.id)` | `DriverRun` (unchanged) |
| 2 | بازدیدها و سرنخ‌ها | `readTodaysLeadRun(db, session.user.id, session.organizationId, today)` | `DriverRunView` (moved) |
| — | commission card | `driverStatementFor(...)` | unchanged, delivery-only |

**Both sections render for every van role, unconditionally.** No `hasRole()` check, no
"hide if empty." A driver who holds one hat still sees the second section, and its empty
state explains itself. This was chosen over conditional rendering because a section that
*disappears* is indistinguishable from a section that *is empty* — and a driver must
never conclude "I have no deliveries" when the deliveries section simply did not render.
The empty-state copy already exists at `driver/page.tsx:100-104`.

The commission card stays gated on `commission.kg > 0` as it is today. It is money, not
work, and it belongs to the delivery job only.

**Ordering:** deliveries above visits. A delivery stop is revenue-bearing and time-bound
(cold chain, weather caps); a prospect visit is not. Same reasoning as
`DriverRunView`'s own doc comment: the thing that must be read before getting out of the
van goes above the fold.

### 3.4 Server-render the visit run, hand it in

`DriverRunView` currently client-fetches via `useDriverRun()` → `GET /api/lead-runs`.
On `/driver` that would mean a skeleton flash, and the delivery section above it would
already be painted — so the page would visibly fill in twice.

`readTodaysLeadRun` already exists in `lib/repo/leadRuns.ts` and is already the authority
(`/api/lead-runs` calls it). The server page calls it directly and passes the result as
a new optional `initialRun` prop, used as `useState`'s initial value.

`useDriverRun` keeps its `load()` and still re-fetches after a reorder or a recorded
visit. The server render is the **first paint**, not a cache — `DriverRunView` must not
be trusted to stay fresh, and it isn't.

`DriverRunView`'s props become `{ initialRun?, onRecord, navAppId }`. The `useState`
initializer reads `initialRun ?? null`, which is safe because the server and first client
render agree.


### 3.5 The hat switcher stays on `/today`

`components/today/RolePicker.tsx` renders only when `roles.length >= 2`, and posts to
`/api/me/role`, which re-signs the cookie so `proxy.ts` sees the new active role.

With both sections on `/driver`, a dual-hat person needs no picker to see their own work —
that was the point of showing both. The picker's remaining job is **changing hat to reach
the office world**, and `/today` is where that lives. `/driver` already links there at
`page.tsx:74` («مسیر امروز ›»).

Nothing changes about `RolePicker` or `/today` in this spec.

### 3.6 The menu drops to two tabs

`lib/appNav.ts:69-73` — remove the `/leads` entry from `DRIVER_TABS`. A driver's menu
becomes:

| href | label | group |
|---|---|---|
| `/driver` | روز من | `day` |
| `/sales/academy` | آموزش | `day` |

`/leads` keeps its entry at `appNav.ts:100` for rep leads — unchanged, still «پین‌های
نقشه».

`tests/proxy.test.ts:115-122` asserts every ready driver tab passes the middleware. With
`/leads` removed from both the nav and the allowlist, the two files stay in agreement
without a new invariant.

### 3.7 The `role = 'driver'` bug, fixed here

Two manager pages query a role that **no longer exists**:

- `app/(shell)/sales/runs/page.tsx:37` — `WHERE role = 'driver' AND active = 1`
- `app/(shell)/sales/commission/page.tsx:72` — same

`lib/db.ts:3220` migrated it: `UPDATE users SET role = 'delivery_driver' WHERE role =
'driver'`. Both dropdowns therefore match **nobody** — the delivery-run planner's driver
list and the commission manager-overrides picker are both silently empty, and neither has
a test.

This is the failure mode `lib/roles.ts` documents ("a gate written as `role === 'driver'`
matches nobody the moment the role is renamed"), surviving because it is a raw string
literal in a page rather than a shared constant. It belongs in this spec because the spec
is about the two van roles, and the fix is the van-role set:

```sql
WHERE role IN (...) AND active = 1   -- the VAN_ROLES set
```

with the values inlined from `VAN_ROLES` so a future rename is caught, and a test
asserting the query returns a real `delivery_driver`.

## 4. Data flow

```
van role opens /driver
  └─ cookies() → getSessionFromCookies
       ├─ !isVanRole        → NotAVanNotice (platform_owner) | redirect /map
       └─ isVanRole
            ├─ readDriverRuns(db, user.id)           → delivery_runs → DriverRun
            ├─ readTodaysLeadRun(db, id, org, today) → lead_runs     → DriverRunView (initialRun)
            └─ driverStatementFor(db, user.id, period) → commission card
                 │
                 └─ DriverRunView re-fetches GET /api/lead-runs after a reorder
                    (requireRole: MANAGE_ROLES + both van roles) → readTodaysLeadRun
```

No new API route. No schema change. No migration.

## 5. Testing

| File | Asserts | State |
|---|---|---|
| `tests/driver-my-day.test.ts` | **new** — both sections render for a single-hat van role; a `field_rep` sees the visit section; a `delivery_driver` sees the delivery section; a **dual-hat session with one active role sees both** | new |
| `tests/proxy.test.ts` | **edit** — `delivery_driver` → `/leads` is now a 307 to `/driver`, not 200 (line 99 inverts); the both-directions `PATHS` note at 136-145 is rewritten, since the page is no longer dual-purpose | edit |
| `tests/appNav.test.ts` | **edit** — driver tabs are `["/driver", "/sales/academy"]` (line 185); the `pillModel` assertion at 192-198 loses the `/leads` row | edit |
| `tests/van-role-dropdown.test.ts` | **new** — the run-planner and commission queries return a real `delivery_driver`; would have failed before §3.7 | new |
| `tests/leads-plain-objects.test.ts` | unchanged — the pool still returns plain objects | must stay green |
| `tests/briefing-repo.test.ts` | unchanged — `/today` untouched | must stay green |
| `tests/crm-driver-visits.test.ts` | unchanged — visit recording untouched | must stay green |

The dual-hat test is the one that earns its keep. Since §3.3 renders both sections
unconditionally, the single-hat cases would all pass even if the page branched on the
ACTIVE role instead of showing everything — so the test deliberately builds a two-role
session with a single active role, and asserts the section belonging to the *inactive*
hat is present. That is the exact regression this design exists to prevent.

## 6. Out of scope

- **`/today` is not folded into `/driver`.** The `retry` panel (failed deliveries) is
  real work with no home elsewhere. Adjacent cleanup, different spec.
- **The routes / delivery / orders consolidation.** Five separate route optimizers exist
  (`/sales/routing`, `/sales/runs`, `/planner`, `/leads`→`RouteSection`,
  `/sales/schedule`) plus `/sales/orders`, `/sales/board` and `/sales/journey` over one
  `readOrders`. That is spec 2.
- **`RouteSection`, `useLeads`, the eight pool views, `LeadListsBar`** — untouched.
  They stay on `/leads` and keep working.

## 7. Risk

Low. No DB migration, no API change, no route removal, no schema change. The two edits
that could break other things are the proxy gate and the nav list, and both are already
asserted in `tests/proxy.test.ts` and `tests/appNav.test.ts`.

The genuine risk is a **behavioural** one: a driver who has never seen both sections may
read the empty one as a fault. The empty-state copy is therefore part of this spec, not a
follow-up — it must say *why* it is empty and *who fills it*.
