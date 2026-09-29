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
4. **`/leads` is also unreachable-by-gate, and that is separate.** `leads/page.tsx` is
   `"use client"` and its layout holds only the page header — there is **no
   `isVanRole` check, no `requireRole`, and no session read anywhere in the route**
   (verified: zero matches). So §3.2 is the *only* thing that ever refused this page to
   anyone. Removing the van allowlist entry is therefore not a narrowing — it is the first
   time this route is gated on role at all, and the gate has to be right the first time.

`tests/proxy.test.ts:136-145` already documents this as "a dual-purpose page … Reachable
but empty is a weaker thing than refused." This spec closes that hole rather than
documenting it further.

### 1.1 A fourth bug, found while writing this: the driver's page has no position

`MyPositionProvider` is mounted **only** in `app/(shell)/layout.tsx:27`. `/driver` lives in
`app/(bare)`, which mounts nothing but the design-system scope (`(bare)/layout.tsx:19-21`).

So `useMyPosition()` on `/driver` returns the context **default** from
`components/MyPositionProvider.tsx:30-35` — `{ position: null, status: "idle", retry: () => {} }`.

**This already ships.** `components/driver/VerifyVisits.tsx:7,20` calls `useMyPosition()`
and is already rendered on `/driver` (`driver/page.tsx:70`). `VerifyVisits.tsx:40` passes
`pos = null` into the visit flow, so a driver recording a visit today has no position to
attach to it.

Worse than a crash, because it is not one: `useContext` on an unprovided context returns
the default, so nothing throws and no test goes red. §3.3 would put a **map** and a
**next-stop distance** on that same page, both of which read `position` — so the driver
would get a next-stop banner with no distance and a map with no blue dot, and every signal
would say the app is fine.

This is why §3.5 exists. It is a prerequisite, not a consequence: without it, §3.3 ships a
page that renders perfectly and lies.

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

**The hook moves out of the route folder, and this is load-bearing.** Today seven files
import from `@/app/(shell)/leads/hooks/` — including `DriverRunView.tsx:6` and
`NextStopBanner.tsx:6`. A `components/` file importing from a route directory already
points the wrong way; making an `app/(bare)` page depend on `app/(shell)` internals
inverts it entirely, and Next treats route folders as boundaries.

So `useDriverRun.ts` moves to a location both groups can import — `lib/useDriverRun.ts`
alongside the other shared hooks, or colocated at `components/driver/useDriverRun.ts`. The
plan picks one; the requirement is that **no `app/(bare)` file imports from
`app/(shell)`, and none of the seven importers is left behind.**

`useLeads` keeps its `isManager` return, but §3.1's "collapses to always-true" needs
stating precisely: `useLeads.ts:139` reads `if (isManager === false) { setLoading(false);
return; }` — a guard that stops a driver fetching manager data. On a manager-only page
that guard is dead but harmless. **The plan should decide whether `useSession()` stays** or
is removed along with it. Keeping it costs one `/api/me` fetch per load for an answer
that no longer varies; removing it touches 6 return-value lines. Either is defensible;
leaving it undecided is not.

### 3.2 The gate — one place, in the proxy

Remove `pathname === "/leads"` from the `isDriverBriefing` allowlist at **`proxy.ts:204`**
(the line is 204, not 196 — the allowlist grew when the notifications paths were added).
The final `isVan` gate (`proxy.ts:207`) then catches a van role reaching `/leads` and
redirects to `/driver`.

Nothing new is written. The existing two-tier gate already expresses this, and adding a
second `/leads` check would be the drift the file's own header comment warns about.

`/api/leads/locations` and `/api/lead-runs` stay allowlisted — a driver still records a
visit at the door, now from `/driver`.

**The same gate also has to close the top of the list, not just the bottom.** §1.1(4)
establishes that this route has never been gated. Today `phone_sales` reaches the pool and
the «سپردن مسیر» hand-off, because `isManager` is `!isVanRole` and the proxy's
`isDriverBriefing` allowlist only describes who a *van role* may reach — it says nothing
about a *rep* who should not.

`appNav.ts:100` already draws the line: `/leads` is `ready: isRepLead(r)`. **The proxy must
match it, or the nav is a suggestion rather than a gate.** So §3.2 becomes two rules:

- a van role reaching `/leads` → `deny("/driver")` (the existing `isVan` gate, once the
  allowlist entry is gone);
- a role that is not a rep-lead reaching `/leads` → `deny("/crm")`, which is where a
  `phone_sales` rep's own leads actually live.

`/crm` is the right redirect rather than `/sales` because `crm/page.tsx:26` already
redirects a van role to `/driver` and opens on *today's follow-ups* for everyone else —
it is the nearest correct home for a rep's leads, and `/api/crm/businesses` admits
`CRM_ROLES` (verified), which includes `phone_sales`.

The nav and the gate now agree in both directions, which is what
`tests/proxy.test.ts:115-145` already asserts for the driver menu and currently cannot
assert for this path.

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


### 3.5 The position context — a prerequisite, not a detail

`DriverRunView.tsx:8` calls `useMyPosition()` and renders `LeadsMap`, which calls it again
(`LeadsMap.tsx:14`). `NextStopBanner` shows a distance derived from it
(`DriverRunView.tsx:41-44`).

**So the move in §3.3 does not work until the bare group has a position.** The fix is one
line in `app/(bare)/layout.tsx`:

```tsx
import { MyPositionProvider } from "@/components/MyPositionProvider";

export default function BareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="meridian">
      <MyPositionProvider>{children}</MyPositionProvider>
    </div>
  );
}
```

**This is safe against the repo's own guards.** `tests/shellGroups.test.ts:43-49` asserts
the bare layout (a) is not `export default async function` and (b) does not import
`next/headers`. A client component satisfies both — it makes no server call and awaits
nothing — and the layout stays synchronous. `tests/shellGroups.test.ts:23` forbids
`AppShell` in the bare layout, which this does not add.

The provider's own comment says it is "always on, mounted at the root, and every map and
list reads from it … One watch rather than one per consumer matters for a device that
spends the working day in a vehicle." That argument is *stronger* here than it was in the
shell: `(bare)` is where the vehicle screens live, and it is exactly where the watch was
missing. Mounting it here fixes `VerifyVisits` (§1.1) as a side effect.

**Rejected alternative: move `/driver` into `(shell)`.** It would get the provider for
free, but `(bare)/layout.tsx:9-11` states the group's purpose — "a phone held in a moving
vehicle … chrome is precisely the thing they must not have" — and `(shell)/layout.tsx:7-19`
documents that the shell exists for the desktop-shaped office app. Trading a design
decision for a plumbing problem is the wrong direction.

### 3.6 The hat switcher stays on `/today`

`components/today/RolePicker.tsx` renders only when `roles.length >= 2`, and posts to
`/api/me/role`, which re-signs the cookie so `proxy.ts` sees the new active role.

With both sections on `/driver`, a dual-hat person needs no picker to see their own work —
that was the point of showing both. The picker's remaining job is **changing hat to reach
the office world**, and `/today` is where that lives. `/driver` already links there at
`page.tsx:74` («مسیر امروز ›»).

Nothing changes about `RolePicker` or `/today` in this spec.

### 3.7 The menu drops to two tabs

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

### 3.8 The `role = 'driver'` bug, fixed here — but see spec 2 §8

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

**This fix lands on a page spec 2 removes.** `/sales/runs/page.tsx` is one of the four
routes spec 2 folds into `/sales/schedule?view=runs`. So the fix must be carried into
whichever file ends up owning the run planner, and spec 2 §8 records the handoff. The
alternative — fix it here, have spec 2 move a page containing the identical broken query —
is how the bug survives. **This is the one place the two specs touch the same file.**

## 4. Data flow

```
van role opens /driver
  └─ (bare)/layout.tsx → MyPositionProvider          ← §3.5, supplies position to both sections
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

**A constraint that shapes this whole section.** `/driver` is an **async server
component** that calls `cookies()`. `vitest.config.mts` sets `environment: "node"`, and
**no test in `tests/` imports anything from `@/app/`** — there is no precedent for
rendering a page. So "assert both sections render" is not a test that can be written
against the page directly. It has to be written against something testable.

| File | Asserts | State |
|---|---|---|
| `tests/driver-my-day-sections.test.ts` | **new** — a **pure** section-decision function, given a session, returns both sections. Dual-hat with one active role → both. Single hat → both. Non-van → neither. | new |
| `tests/use-driver-run.test.ts` | **new** — `readTodaysLeadRun` returns the run for a driver who holds either van role, and `null` for one who holds neither | new |
| `tests/bare-layout-has-position.test.ts` | **new** — `app/(bare)/layout.tsx` mounts `MyPositionProvider`; source-text assertion, in the style of `tests/shellGroups.test.ts:19-24` | new |
| `tests/proxy.test.ts` | **edit** — `delivery_driver` → `/leads` is now a 307 to `/driver`, not 200 (line 99 inverts); `phone_sales` → `/leads` is now a 307 to `/crm` (new); the both-directions `PATHS` note at 136-145 is rewritten, since the page is no longer dual-purpose and is now genuinely gated | edit |
| `tests/appNav.test.ts` | **edit** — driver tabs are `["/driver", "/sales/academy"]` (line 185); the `pillModel` assertion at 192-198 loses the `/leads` row | edit |
| `tests/van-role-dropdown.test.ts` | **new** — the run-planner and commission queries return a real `delivery_driver`; would have failed before §3.8 | new |
| `tests/shellGroups.test.ts` | **must stay green** — this is what proves the §3.5 provider mount does not break the bare layout's guarantees | regression |
| `tests/leads-plain-objects.test.ts` | unchanged — the pool still returns plain objects | must stay green |
| `tests/briefing-repo.test.ts` | unchanged — `/today` untouched | must stay green |
| `tests/crm-driver-visits.test.ts` | unchanged — visit recording untouched | must stay green |

### 5.1 Two guards this spec earns for the whole repo

Both are one test file each, and both turn a bug class that had to be *found by reading*
into one that fails the build. They are not required by the driver work — they are
required by having discovered the class.

**`tests/no-silent-context-default.test.ts`** — §1.1's failure mode is that
`useContext` on an unprovided context returns a *valid-looking* default, so a missing
provider is indistinguishable from real data. Scan `components/**` for `createContext(` and
assert the default value cannot be mistaken for a real state (a `position: null` alongside
a `status: "idle"` that claims to be a real status; an empty array that reads as "no
results" rather than "not loaded"). A context whose default is a *throwing* function, or
whose hook asserts, is the pattern to migrate toward.

**`tests/no-role-string-literals.test.ts`** — §3.8's `WHERE role = 'driver'` survived a
rename because it is a raw string in a page. Scan `app/**` and `components/**` and fail
on `role = '`, `role === "` and ``role === ` `` outside the two files where a role string
legitimately lives: `lib/roles.ts` (the union) and `lib/db.ts` (the migrations that
rewrite old vocabulary). This would have caught both dropdowns on the day the rename
shipped, and it is the difference between documenting a hazard and preventing it.

### 5.2 A seam, so the dual-hat promise is testable

**The dual-hat test needs a seam to test through.** §3.3's decision — which sections a
session gets — currently lives as scattered `{isManager && …}` JSX. Extract it as a pure
function (`sectionsFor(session): Section[]`) and the highest-value assertion in this spec
becomes writable. That extraction is a **testability requirement of this spec**, not a
refactor: without it, the dual-hat regression is unverifiable and the spec's central
promise — that a person sees all their work regardless of which hat is active — ships on
nothing but a code review.

Component-level rendering *is* available if needed: several tests use
`// @vitest-environment jsdom` with `createRoot` (e.g. `tests/crm-basics-ux.test.ts:1,4`).
That covers `DriverRunView`'s own logic, but not the server page around it.

The seven files importing `@/app/(shell)/leads/hooks/` must all be repointed when the hook
moves (§3.1); `tsc` catches the misses, and the suite catches the rest.

## 6. How this lands — two commits, not one

**Commit A: the position fix (§3.5).** One line in `app/(bare)/layout.tsx`, plus
`tests/bare-layout-has-position.test.ts`. It is **independent of everything else here**:
no moved component, no new prop, no nav change, no proxy change. It fixes a live bug —
`VerifyVisits` already records visits with `pos = null` today — and it is safe against
`tests/shellGroups.test.ts` by construction.

It goes first, alone, because a bug that ships in production should not be queued behind a
refactor. If the rest of this spec is later re-scoped, deferred, or abandoned, **the fix
still stands on its own.** That is the entire argument for splitting it.

**Commit B: the rest** — the `/leads` branch removal, the hook relocation, the
`DriverRunView` move, `initialRun`, the two proxy rules, the nav change, and §3.8's
`role = 'driver'` fix.

Ordering is not merely tidy. Commit A is what makes Commit B's §3.3 move *correct*, so B
cannot be reviewed without A in the tree. And §3.8's fix must land in the same series as
spec 2, which is the one place the two specs collide (spec 2 §8.1).

## 7. Out of scope

- **`/today` is not folded into `/driver`.** The `retry` panel (failed deliveries) is
  real work with no home elsewhere. Adjacent cleanup, different spec.
- **The routes / delivery / orders consolidation.** Five separate route optimizers exist
  (`/sales/routing`, `/sales/runs`, `/planner`, `/leads`→`RouteSection`,
  `/sales/schedule`) plus `/sales/orders`, `/sales/board` and `/sales/journey` over one
  `readOrders`. That is spec 2.
- **`RouteSection`, `useLeads`, the eight pool views, `LeadListsBar`** — untouched.
  They stay on `/leads` and keep working.

## 8. Risk

**Low, once §3.5 is in place — and the risk ordering is the point.** §3.5 is not
optional: without it, §3.3 does not fail loudly, it fails *silently*, producing a driver
page with no position, no distance, and no error. A spec whose worst outcome is a crash is
safer than one whose worst outcome is a plausible lie.

Ranked:

1. **The position context (§3.5).** Mitigated by mounting the provider, and guarded by a
   new test plus `tests/shellGroups.test.ts` staying green.
2. **The hook relocation (§3.1).** Seven importers; `tsc` catches every miss. This is
   mechanical, not risky — but skipping it inverts a dependency direction, which is the
   kind of thing that is cheap to do now and expensive to unpick later.
3. **The proxy gate and nav list.** Both already asserted in `tests/proxy.test.ts` and
   `tests/appNav.test.ts`.
4. **The `role = 'driver'` fix (§3.8) landing on a page spec 2 removes.** The one place
   the specs collide. Sequencing spec 1 first makes it a non-issue.

No DB migration, no API change, no route removal, no schema change.
