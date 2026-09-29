# Orders and the day: consolidating the sales surfaces

**Date:** 2026-09-29
**Status:** approved in dialogue, awaiting implementation plan
**Scope:** spec 2 of 2. **Must be reconciled with** `2026-09-29-leads-manager-only-driver-my-day-design.md` — see §8.

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
on §7's open question.

## 5. What this removes from the menu

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

## 6. Redirects and every reference that must be repointed

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

## 7. Open question for the implementation plan

`RunTimeline` shows runs in progress and recently finished — a third question (not "what
happened on the 14th", not "assign these orders") from the month ahead. The plan should
decide whether it becomes a third tab on the day host or stays inside the `runs` tab.
This spec puts it in the `runs` tab, which is the conservative choice, and flags it
rather than deciding it here.

## 9. Testing

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

## 10. Out of scope

- **`/sales/routing` stays its own page.** It is a batch optimizer (§2), not a view.
- **`/planner` is untouched.** It optimizes `visit_plans` for customers and districts,
  which is a different question from the delivery day. A future spec may fold it into the
  day host as a fourth view; naming that here prevents it being assumed done.
- **No API, schema, or migration change.** Every endpoint stays exactly where it is; this
  is a routing and rendering consolidation only.
- **`RunTimeline`'s tab placement** — see §7.

## 11. Risk

**Low-to-medium.** No DB migration, no API change, no route removal (four routes become
redirects). The genuine risks are all about *links*, not code:

1. A hardcoded `href` into a merged route, in a file that isn't a page. `briefing.ts:192`
   is exactly this and is already inventoried in §6.
2. A `loading.tsx` orphaned by its route's move, producing a 404 on a slow connection.
   Delete them with the routes.
3. `PAGE_META` losing a route that still resolves, which `pageMeta.test.ts` catches but
   only if the suite is run.

The plan should run the **full** `vitest` suite, not just the new tests, because the
existing nav/pageMeta/proxy invariants are what stand between a clean merge and a
plausible-looking one that is quietly broken.

## 8. Compatibility with spec 1

