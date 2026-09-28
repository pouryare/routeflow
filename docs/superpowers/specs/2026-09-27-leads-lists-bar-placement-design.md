# Lists bar: placement, un-nesting, and real actions

**Date:** 2026-09-27
**Status:** approved
**Surface:** `/leads` — `LeadListsBar`, `RouteSection`, `page.tsx`

## Why

Three things, all visible on one screen.

**The list bar is in the wrong place.** It sits above the pool of locations, far from the
route it feeds. The natural reading order is: plan the route, then reach for saved sets to
put in it.

**Boxes inside boxes.** `CollapsibleSection` already draws a complete card — background,
border, radius, shadow (`.meridian .sect`, globals.css:3341). Three places wrap it in a
second `<section className="…border border-border bg-surface-raised p-4">`, and
`RouteSection` compounds it: the day split is a `.sect` inside a wrapper inside the route
card, three deep.

**The bar has one action.** Load, rename, delete. A saved set cannot be added to the route,
split into days, or handed to a driver, all of which are the reasons a manager saves one.

## The un-nesting

The fix is the same in all three places: **delete the wrapper and let the `.sect` card be the
box.**

`RouteSection` returns a fragment rather than a box containing a box — the day-split card
and the route card as siblings, neither inside the other. It stays one component; splitting
it in two would only move the decision of which comes first to the page.

## Page order

```
همه مکان‌ها            the pool, the toggle, the hidden-count line
تقسیم خودکار بین روزها  its own card
مسیر فعلی              پیشنهادات روز + the route
فهرست‌ها               between the route and the map
(the map)
تنظیمات
```

### The copy this breaks

The empty route reads *از فهرست بالا هر مکانی را بزنید تا به مسیر اضافه شود*. That "فهرست"
means the pool of locations, which is still above, so it stays true — but a card titled
**فهرست‌ها** now sits directly below it, and in Persian the two are easy to read as the same
thing. Reworded to **از فهرست مکان‌ها بالا**, which is unambiguous and still within the
vocabulary guard's rules (فهرست, never لیست).

## The six actions

| # | Button | Effect | New code |
|---|---|---|---|
| 1 | بارگذاری در مسیر | the route becomes exactly this list | — (`openList`) |
| 2 | افزودن به مسیر | the list is appended to the route | `appendToRun` |
| 3 | تقسیم به روزها | the day-split runs on this list alone | `proposeDays(scope)` |
| 4 | سپردن به راننده | the assign sheet opens loaded with this list | an `assignScope` |
| 5 | تغییر نام | as now | — |
| 6 | حذف | as now, with confirm | — |

**#1 is destructive and says so.** It discards whatever is in the route. If the route has
stops, #1 asks first; if it is empty, it does not. #2 never asks, because it cannot lose
anything.

**#2 and an active list.** `updateRun` persists through the *active list* when one is set, so
appending while a list is active extends **that list's** membership. That is the route's
existing meaning rather than a new rule, so no guard is added — but the button's label says
which list is open, because a manager appending to "the route" should not discover they
edited a saved list.

**#3 replaces پیشنهادات روز rather than merging into it.** Merging would silently reorganise
days the manager was tuning by hand, and there is no way to undo that. Replacing is what
pressing **پیشنهاد بده** already does, so it is the established behaviour.

**#4 reuses the sheet.** It already accepts a list of location ids, so opening it with a
list's ids instead of the route's is a change at the call site. The page needs an
`assignScope` so `onAssigned` knows which of two different things it just handed over: the
route (clear the pool, reduce the proposal, record the receipt) or a list (**touch neither**).

**#3 is the one that adds capability.** `proposeDays` works on every available lead at once.
Scoping it to a saved set is what makes "مشتریان قدیمی" independently splittable later.

## Desktop and mobile

**Both:** tapping the row loads the list. Identical on the two layouts, so resizing the
window does not change what a row does.

**Desktop:** all six visible, wrapping onto a second line — the `flex flex-wrap` idiom the
route's own action row already uses.

**Mobile:** the row plus one **…** button, whose menu lists **all six**, so it stands on its
own even though load is also the row tap.

## Edge cases

- **A list whose leads were deleted.** The count shows what is still loadable; the server
  refuses the rest at save time with the existing 404.
- **A list holding leads already assigned to a driver.** Loading it into the route is
  allowed — you can see it — and each assigned lead keeps its driver chip. Assigning it later
  hits the 409, which is the rule, not a new one.
- **#3 on a one-lead list.** `daysNeeded` returns 1, and you get a single-stop day. Allowed.
- **#4 on an empty list.** Disabled, like the day split's save.

## Testing

No component tests in this repo, so the weight is on the pure parts:

- `appendToRun` — appends in order, drops ids already in the route, drops unassignable ids,
  never loses what was there
- `proposeDays(scope)` — draws only from the scope; an out-of-scope id cannot appear
- the existing `removeHandedOver` tests, which #4's success path must not disturb when the
  hand-over was of the route

Placement, un-nesting and the responsive split are layout, checked by types and by looking.

## Not included

No reordering, no copy/paste between lists, no list-level sharing, and no list remembering
which split produced it.