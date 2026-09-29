# Orders and the day: consolidating the sales surfaces

**Date:** 2026-09-29
**Status:** approved in dialogue, awaiting implementation plan
**Scope:** spec 2 of 3. **Must be reconciled with** `2026-09-29-leads-manager-only-driver-my-day-design.md`
— see §9. A third spec, `2026-09-29-one-lead-one-place-design.md`, runs *after* this one.

---

## 1. What the data says

Three pages are the same query.

| Page | Call | Limit |
|---|---|---|
| `/sales/orders` — سفارش‌ها | `readOrders(db, orderFilter(session), { limit: 100 })` | 100 |
| `/sales/board` — تابلوی سفارش‌ها | `readOrders(db, scope, { limit: 60 })` | 60 |
| `/sales/journey` — پیگیری سفارش | `readOrders(db, scope, { limit: 60 })` | 60 |

One table, one reader function, three menu items — listed adjacently in the same nav group
(`appNav.ts:106-108`).

**The tab strip already exists.** `PageHeader.tsx:50-56` renders the nav group's ready
tabs in the page header, so a manager opening `/sales/orders` already *sees* a tab row.
These pages already look like tabs; they are three routes pretending to be one page. This
spec makes the markup match what the header promises.

## 2. The four "route optimizers" are two verbs

| Page | Verb | Component | Endpoint |
|---|---|---|---|
| `/sales/schedule` | **see** the month | `ScheduleBoard` | server read |
| `/sales/runs` | **assign** work to vans | `RunPlanner`, `AssignmentBoard`, `RunTimeline` | `POST /api/sales/runs` |
| `/sales/routing` | **optimize** a day's sequencing | `RoutingPlanner` | `/api/sales/routing/plan` + `/commit` |
| `/planner` | **optimize** a visit day | `PlannerRouteMap` | `visit_plans` |

`RoutingPlanner`'s interface gives it away: `eta_min`, `duration_min`, `distance_km`,
`cold_chain_capped`, `effective_max_stops`, `source: "vroom" | "greedy"`. It is a
**batch optimizer** — a tool you invoke before a day, not a destination you browse.
Route4me and Onfleet both treat "optimize" as an action, not a tab. **It stays its own
page.**

`/sales/schedule` is the opposite: `schedule/page.tsx:41-78` queries **two** tables
(`delivery_runs` *and* `visit_plans`) and merges them into one calendar. Its own comment
(`:20`) says deciding "whether the day's plan means routes, visits, or both is a product
decision" — the page already answered *both*. It is the natural spine for the merge.

## 3. Wave 1 — Orders: one page, three views

`/sales/orders` keeps its URL and becomes the tab host. `/sales/board` and
`/sales/journey` become tabs on it, selected by a query param.

| Tab | `?view=` | Renders today |
|---|---|---|
| فهرست | (default) | `OrdersPockets` |
| تابلو | `board` | `OrderPipeline` |
| پیگیری | `journey` | `OrderSpine` + `OrderFunnel` |

`journey/page.tsx:36` already ships a `?view=` switch with the comment *"The mode lives
in the URL (`?view=all`) so it survives a reload and can be linked."* The mechanism is
proven; the param just moves to the shared host.

**All three tabs read the same `readOrders` result, loaded once on the server.** The
limits converge on 100 (`orders` is the only one that was not silently truncating to 60).

`/sales/board` and `/sales/journey` `redirect("/sales/orders?view=…")`. Deep links and
bookmarks survive; the old URLs keep working.

### 3.1 `/sales/deliveries` moves to the order detail page

`deliveries` is keyed by **`order_id` + `seq`** (`lib/db.ts:1308-1316`) — it is the
history of attempts on *one* order: status, `planned_arrival` vs `actual_arrival`, fail
and delay reasons, receiver, signature, photo, GPS. And `sales/orders/[id]/page.tsx`
contains **zero** references to it. That is a gap, not a page.

So the attempt history becomes a section on `/sales/orders/[id]`, showing every attempt
for that order with its reason codes.

**The cross-order exception queue does not move** — it already exists, as the `retry`
panel on the `/today` briefing (`briefing-repo.test.ts:91-93` asserts it). Splitting it
this way is the point: *one order's history* belongs on the order; *what needs attention
today* belongs on the day. `/sales/deliveries` redirects to `/sales/orders`.

## 4. Wave 2 — The day: schedule + runs, one page, two views

`/sales/schedule` keeps its URL and becomes the tab host.

| Tab | `?view=` | Renders today |
|---|---|---|
| برنامه | (default) | `ScheduleBoard` (month grid) |
| سفرها | `runs` | `RunPlanner` + `AssignmentBoard` + `RunTimeline` |

The month calendar is already the spine. `/sales/runs` redirects to
`/sales/schedule?view=runs`.

**`RunTimeline` shows *past* runs** (`runs/page.tsx:128` filters `status !== "done"` for
the timeline but the board above it lists the recent 30). It is a third kind of question
from the month ahead. It renders in the `runs` tab; whether it earns its own tab depends
on §8's open question.

## 5. One copy fix that closes the vocabulary

Measured, the app's vocabulary is already disciplined: **سفر** for a run
(`delivery_runs`, `lead_runs`), **بازدید** for a planned visit (`visit_plans`), and
**مسیر** for the *optimized order* — a property of a سفر, not a third entity.
`/sales/routing`'s own overview already says so: *«خروجی این صفحه، «سفرهای تحویل» است»*.

**One page breaks it.** `lib/pageMeta.ts:24` describes `/planner` as *«مسیر پیشنهادی را
می‌توانید دستی جابه‌جا کنید»* — it calls an ordered sequence of **visits** a *مسیر*. By
the app's own rule that is a **بازدید** sequence, not a route.

**Fix:** `/planner`'s overview changes `مسیر پیشنهادی` → `ترتیب پیشنهادی بازدیدها`. One
string, in one file, and the vocabulary is then consistent across every page. No
structural change, no new test beyond the copy audit that already runs
(`scripts/audit-copy.mjs`, wired to `npm run audit-copy`).

**Why it belongs here rather than in its own spec:** it is a single string with no
behaviour behind it. Spec 2 is already the change that settles what the day is called
(tabs برنامه / سفرها), so the vocabulary is being touched anyway — and a one-line copy fix
does not warrant its own document, plan, and review cycle.

## 6. What this removes from the menu

| Before | After |
|---|---|
| `sales`: سفارش‌ها · تابلوی سفارش‌ها · پیگیری سفارش · کالاها · دریافت‌ها · چک‌ها · پورسانت | `sales`: سفارش‌ها · کالاها · دریافت‌ها · چک‌ها · پورسانت |
| `day`: امروز · کارهای من · برنامهٔ بازدید · برنامه‌ریز مسیر | `day`: امروز · کارهای من · برنامه‌ریز مسیر |
| `ops`: سفرهای تحویل · تحویل‌ها · مسیریابی · انبار و خرید · سری‌های ساخت | `ops`: برنامهٔ تحویل · مسیریابی · انبار و خرید · سری‌های ساخت |

`appNav.ts` loses four entries: `/sales/board`, `/sales/journey`, `/sales/runs`,
`/sales/deliveries`. It gains none.

**Two tab rows, on purpose.** After the merge the header still shows the nav group's
siblings (a way to leave this area) while the page shows its own views (a way to read
this data differently). That is the Shopify arrangement, and the two rows answer different
questions. They must be visually distinct — the implementation plan should use the
existing header pill style for the first and a page-level control for the second.

## 7. Redirects and every reference that must be repointed

Consolidation is worthless if it breaks a link. Full inventory, found by grepping for the
four hrefs:

| Site | Line | Repoint to |
|---|---|---|
| `lib/repo/briefing.ts:192` | `href: "/sales/board"` on a status row | `/sales/orders?view=board` |
| `journey/page.tsx:90,97,123` | its own `?view=one\|all` links | folded into the tab host |
| `board/page.tsx:55`, `runs/page.tsx:113`, `deliveries/page.tsx:37`, `journey/page.tsx:72` | `<PageHeader route=…>` | the host route |
| four `loading.tsx` files | `pageMetaFor("/sales/board")` etc. | the host's meta, or delete with the route |
| `lib/pageMeta.ts` | entries for the four routes | keep (redirects still resolve a title); add host titles |

**`lib/repo/briefing.ts:192` is the one that is easy to miss** — it is a server-side
data file, not a page, so it will not show up in a page-by-page review, and it is the
status row on the `/today` briefing that a manager taps all day.

`tests/pageMeta.test.ts` walks `app/(shell)` and fails on a route with no `PAGE_META`
entry *and* on an entry whose route has gone. So `lib/pageMeta.ts` must keep entries for
the four redirecting routes, and the four `loading.tsx` files must be removed with their
routes rather than left orphaned.

`proxy.ts` needs no change: it gates by prefix and `isBatchAdmin` already covers
`/sales/runs` and `/sales/deliveries` for the same roles. The redirect happens in the
page, after the gate, so a `phone_sales` user still gets bounced by the proxy rather than
landing on a tab host it may not see.

## 8. Open question for the implementation plan

`RunTimeline` shows runs in progress and recently finished — a third question (not "what
happened on the 14th", not "assign these orders") from the month ahead. The plan should
decide whether it becomes a third tab on the day host or stays inside the `runs` tab.
This spec puts it in the `runs` tab, which is the conservative choice, and flags it
rather than deciding it here.

## 9. Compatibility with spec 1

**Compatible, with one ordering constraint and one shared file that a first pass missed.**

The three governing files — `lib/appNav.ts`, `proxy.ts`, `tests/appNav.test.ts` — are
touched by both specs, in different parts, and the nav edits are provably independent
because `appNav.ts:86` returns `DRIVER_TABS` via an early `if (isVanRole(r))`, before the
inline non-driver list that spec 2 edits.

| File | Spec 1 | Spec 2 | Conflict |
|---|---|---|---|
| `lib/appNav.ts` | removes `/leads` from `DRIVER_TABS` | removes 4 entries from the non-driver list | **None** — separate arrays, early return at `:86` |
| `proxy.ts` | removes `pathname === "/leads"` from `isDriverBriefing` | none | **None** |
| `tests/appNav.test.ts` | driver tabs → 2 | invariants re-run over a smaller set | **None** — assertions get *looser* |
| `tests/proxy.test.ts` | `/leads` for a van role inverts 200 → 307 | none | **None** |
| **`app/(shell)/sales/runs/page.tsx`** | **§3.8 fixes the `role = 'driver'` query at line 37** | **§4 deletes the page into a tab** | **Yes — the one real collision** |

### 8.1 The collision, stated plainly

Spec 1 §3.8 fixes a query that matches nobody:

```sql
WHERE role = 'driver' AND active = 1   -- no such role; db.ts:3220 renamed it
```

Spec 2 §4 removes this exact page, folding `RunPlanner` into `/sales/schedule?view=runs`.

**If spec 2 lands first, the fix is lost** — the broken query is carried into the new file
or, worse, retyped. **If spec 1 lands first, spec 2 inherits a corrected query** and must
preserve it when it moves the code.

So the ordering is not merely convenient (it also keeps two branches from editing
`tests/appNav.test.ts:185` at once), it is **load-bearing**. Spec 1 first, and spec 2's
plan must name the fixed query as an input it must not regress.

### 8.2 The shared invariant

Both specs narrow the menu — spec 1 removes a driver tab, spec 2 removes four manager
tabs. `PageHeader.tsx:40,54` derives the tab row from the same nav list and renders
nothing when `siblings.length <= 1`. After spec 2, `sales` holds 5 tabs and `ops` holds 4,
so both survive. **This is the invariant to re-check after each spec lands**, and the
reason the plan should run the full `vitest` suite rather than only the new tests.

### 8.3 What the two specs do *not* share

Worth stating so nobody assumes a connection that isn't there: spec 1's §3.5 (the position
context in `(bare)`) and spec 2's tab hosts are unrelated. Spec 1 touches the vehicle
screens; spec 2 touches the office screens. They share no component, no data, and no
route. The only seams between them are the nav list and the one file in §9.1.

## 10. Testing

| File | Asserts | State |
|---|---|---|
| `tests/orders-tabs.test.ts` | **new** — each `?view=` renders its own component; all three read the same `readOrders` result; the three old hrefs redirect to the right host+view | new |
| `tests/day-tabs.test.ts` | **new** — `?view=runs` renders `AssignmentBoard`; default renders the month grid; `/sales/runs` redirects | new |
| `tests/appNav.test.ts` (edit) | the four hrefs are gone; `sales` and `ops` still hold >1 tab so the header keeps its tab row | edit |
| `tests/pageMeta.test.ts` | **must stay green** — this is what forces `lib/pageMeta.ts` to keep the four redirecting entries | regression |
| `tests/briefing-repo.test.ts` | **must stay green** — asserts the `retry` panel; its `href: "/sales/board"` link is repointed to `?view=board` | regression |
| `tests/proxy.test.ts` | **must stay green** — `isBatchAdmin` still gates `/sales/runs` and `/sales/deliveries` for `phone_sales`, and the redirect happens after it | regression |
| `tests/order-delivery-history.test.ts` | **new** — the order detail page lists every attempt for that order, newest last, with its reason code | new |

**The redirect test is the one that matters.** A consolidation that silently 404s an old
bookmark is worse than no consolidation. All four old hrefs must be asserted to land on
the right host *and the right view* — `/sales/board` → `/sales/orders?view=board`, not
just `/sales/orders`.

## 11. Out of scope

- **`/sales/routing` stays its own page.** It is a batch optimizer (§2), not a view.
- **`/planner` is untouched.** It optimizes `visit_plans` for customers and districts,
  which is a different question from the delivery day. A future spec may fold it into the
  day host as a fourth view; naming that here prevents it being assumed done.
- **No API, schema, or migration change.** Every endpoint stays exactly where it is; this
  is a routing and rendering consolidation only.
- **`RunTimeline`'s tab placement** — see §8.

## 12. Risk

**Low-to-medium.** No DB migration, no API change, no route removal (four routes become
redirects). The genuine risks are all about *links*, not code:

1. A hardcoded `href` into a merged route, in a file that isn't a page. `briefing.ts:192`
   is exactly this and is already inventoried in §7.
2. A `loading.tsx` orphaned by its route's move, producing a 404 on a slow connection.
   Delete them with the routes.
3. `PAGE_META` losing a route that still resolves, which `pageMeta.test.ts` catches but
   only if the suite is run.

The plan should run the **full** `vitest` suite, not just the new tests, because the
existing nav/pageMeta/proxy invariants are what stand between a clean merge and a
plausible-looking one that is quietly broken.

