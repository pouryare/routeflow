# Remediation & Design Language — design

- **Date:** 2026-09-10
- **Status:** approved in chat, awaiting spec review
- **Predecessor:** `2026-09-09-app-shell-and-foundations-design.md` (slice A+B, shipped,
  deployed to `:3003` on 2026-09-09)
- **Scope:** a 29-item defect report from the user, plus the deferred slice-C global
  services, plus four adjacent gaps found while scanning for the first two.

---

## Why this exists

The app shell slice shipped with 1,930 passing tests, a clean build, `tsc` clean, and a
500-pair contrast gate at 100%. The user then opened it and found **29 defects in one
sitting** — a nav menu that opens on the wrong side, dates in the wrong calendar, English
strings in fields named `_fa`, seven pages missing their navigation, a search box that
does nothing, and a drag-and-drop board that does not drag.

**Not one of them was visible to the test suite.** That is the finding this whole document
is organised around. The suite tests *logic* — repository functions, state machines,
scoping, pure helpers — and every one of these 29 is *rendered output*. We had no way to
observe the thing the user actually looks at.

So the spine of this programme is: **every fix ships with the ratchet that makes its whole
class impossible.** `tests/no-emoji-icons.test.ts` is the model — after 138 emoji were
removed, a test now fails the build if a single pictographic character reappears outside a
comment. A fix without a ratchet is a fix that comes back.

---

## Programme shape

Seven slices. This is too large for one implementation plan; each slice gets its own plan
and its own commit series. The ordering is not arbitrary — later slices depend on
primitives that earlier ones establish.

| Slice | Name | Items | Depends on |
|---|---|---|---|
| **H** | Correctness | 2, 3, 5, 8, 11, 12, 19, 21, 24, 28 | — |
| **I** | Header & search | 1, 13, 9, 29 (search half) | H |
| **J** | Layout & skeletons | 4, 6, 15, 17, 20 | H |
| **K** | Data display | 7, 10, 14, 16 | H, J |
| **L** | Map | 26, 27, 29 (chrome half) | I, K |
| **M** | Workflows & IA | 18, 22, 23, 25 | J |
| **N** | Global services | error pages, Login-As, monitoring, empty states, Jalali calendar | I |

**H first and alone.** It is the only slice that fixes things that are actively *wrong*
rather than merely unpolished, and two of its items — the calendar and the missing nav —
are user-facing correctness failures, not aesthetics. Nothing else should be in flight
while it lands.

---

## Shared decisions

### D1 — Adaptation policy: take the forms, not the code

The user supplied twelve `shadcn.io` block references. Every one of them uses **Recharts**,
**hardcoded `emerald`/`red`/`amber`**, and **LTR layout**. This app renders charts as
**server-side static SVG** through `lib/chartScale` + `lib/chartPalette`, on a validated
OKLCH palette gated by 500 contrast pairs across 10 accent themes × 2 skins, in RTL.

Copying those components in would:

1. ship Recharts to pages that currently send **zero** chart JavaScript;
2. hardcode colours that bypass `npm run check:contrast` — the exact gate that exists to
   catch this;
3. **reverse every chart**, because `barLayout` deliberately settles RTL direction in one
   place so a trend never reads backwards.

**Decision:** each referenced block is a *specification for a component we build on our own
primitives and tokens*. The user gets the design they chose; it stays theme-aware,
RTL-correct, and server-rendered.

This is not a hedge. A diverging bar chart is a *form* — a baseline with magnitude either
side. That form is what was chosen; Recharts is an implementation detail that happens to
be attached to it.

### D2 — Verification: two ratchets, because one is not enough

The 29 defects split cleanly by how they could have been caught:

| Detectable in source | Only detectable when rendered |
|---|---|
| 3 (English in `_fa`), 5/12 (accent-bar CSS), 19/21 (Gregorian date fns), 24 (missing `PageHeader`), 28 (pre-rename mark), 9 (inert search) | 2 (RTL mirroring), 4/6/13/15 (proportion), 11/17 (overflow), 20 (skeleton shape), 22 (drag) |

Static ratchets would have caught roughly half. The rest need a browser — and **Playwright
is already a devDependency**, used today only by `scripts/gen-basemap-thumbs.mjs`.

**Decision: both, scoped tightly.**

**(a) Static ratchets** — vitest, run in the existing suite. Cheap, fast, no browser. One
per class: no Gregorian date formatter imported into a rendered file; no `*_fa` field
carrying non-Persian text; no zero-inset hairline `::after` inside `.meridian`; every
`(shell)` route resolving a header *with* sibling tabs; no logical inset property fed a
`getBoundingClientRect` value.

**(b) A small geometric smoke suite** — Playwright, ~10 assertions across key pages.
**Explicitly not visual-regression screenshots**: those churn on every deliberate design
change, and this programme *is* a deliberate design change — they would cry wolf for six
weeks and then be disabled. Instead, geometric invariants that are true regardless of
styling:

- a popover's box lies within its trigger's horizontal span (**item 2**, forever);
- no element's `scrollWidth` exceeds its container's `clientWidth` (**items 11, 17**);
- `document.body.scrollWidth <= window.innerWidth` on every route (no horizontal scroll);
- a card dropped on another lane changes lane (**item 22**).

These stay true through a redesign. A screenshot does not.

### D3 — Token and direction discipline

Restated because four of the 29 come from breaking it:

- No hardcoded colour in a component. Ever. Tokens only, so the accent themes and both
  skins keep working and `check:contrast` stays meaningful.
- **Never mix logical and physical geometry.** `getBoundingClientRect()` returns physical
  pixels; `inset-inline-start` resolves to `right` in RTL. Item 2 is precisely this
  mistake and it produced a menu that opens under the wrong chip.
- Dates rendered to a user are **Jalali**. `faJalaliDate` / `faJalaliDateTime` already
  exist; `faDateTime` / `faDate` are Gregorian and must not reach a `.tsx` under `app/` or
  `components/`.

### D4 — One search, one overlay

`SearchSlot` currently owns `⌘K` and does nothing with it. It becomes a **full-screen
overlay** (`navbar-search-overlay`), not the expandable variant.

The expandable one works by pushing nav items aside — which is in direct conflict with
**item 1**, where we are fitting seven group chips onto one row. Every search would shunt
the menu sideways and jerk the travelling thumb.

The overlay also absorbs three separate things: **item 9** (search does not work),
**item 29** (map needs the same search), and the **command palette** deferred from slice C.
One component, one keybinding, both surfaces.

### D5 — Two modes, not four skins (item 7)

The user asked whether the four liked timelines could all be offered with a switcher.
`/sales/journey` is master-detail: a list of up to 60 orders, one focused order's lifecycle
from `readJourney`.

Four skins over one order's eight events is a settings panel nobody opens. But two of the
four answer genuinely different questions:

- **«این سفارش»** — where is *this* order, what happened to it → vertical-icon spine over
  the `order_events` log.
- **«همه سفارش‌ها»** — where do orders *stall* → funnel with drop-off across the 12-state
  machine.

Those differ in substance, so the switch earns its place. **`searchable` is not a view** —
it is a filter, and it belongs on the order list already on that page.

---

## Slice H — Correctness

| # | Root cause | Fix | Ratchet |
|---|---|---|---|
| **2** | `HoverPill.tsx:227` writes a physical `getBoundingClientRect().left` into `inset-inline-start`, which is `right` in RTL — the popover is placed its own distance from the **opposite** edge | physical `left` | static + geometric |
| **19/21** | `faDateTime`/`faDate` render **Gregorian** in Persian digits — 12 sites in 10 files, plus Gregorian `<input type="date">` on batches. A reader is ~621 years wrong. | swap to the existing `faJalaliDateTime`/`faJalaliDate`; Jalali picker (slice N) for the inputs | static |
| **3** | `actionCenter.ts:58` assigns the raw English alert `category` to a field named `sub_fa`, and `severity` (`"critical"`) to the bucket | Persian label maps | static |
| **5/12** | one rule, `globals.css:2476`, puts a 3px gradient `::after` on `.gcard`/`.prow`/`.ptile`/`.task` | delete the rule and its four tone variants (`.kbar` has zero uses) | static |
| **24** | 7 client pages cannot import the async server `PageHeader` and fell back to a tab-less `PageHeaderCard`: `facilities`, `gallery`, `leads`, `planner`, and the three `admin/*` | move `PageHeader` into each route's `layout.tsx` | static |
| **8** | `SyncStatus` renders `{online ? "آنلاین" : "آفلاین"}` unconditionally | render nothing when `online && !pending && !trouble` | — |
| **28** | `.side__mark` is a gradient tile reading «ن», left from the pre-rename theme | the header's `<svg>` wordmark | swept by 5's ratchet |
| **11** | text sits flush to its container edge | padding on the container, not margin on the text | geometric |

**Regression risk to state plainly:** removing the accent bar (5/12) touches `.task`, which
is the kanban card — the same component slice M is fixing for drag. H lands first and alone
partly for this reason.

---

## Slice I — Header & search

**Item 1 — one row.** The user's instruction to **remove the logo** is what makes this fit.
Measured budget at 13px display font, RTL Persian:

| Element | Width |
|---|---|
| 7 group chips (text + 36px padding each + gaps) | ~632px |
| search button · bell · avatar + gaps | ~145px |
| **total** | **~777px** |

Removing the 46px mark, the ~130px wordmark and the date drops the single-row breakpoint
from **~1180px to ~1024px**. Below that the menu wraps to its own row — a documented
breakpoint, not a defect. The Jalali date moves to the page-overview card, where it is more
useful than in a brand block.

**Item 13 — pill proportion.** `.seg` padding 5px + chip `padding-block` 8px yields a 36px
thumb behind a ~71px chip, which reads as a circle on short labels like «انبار». To
3px/5px: ~28px against the same width.

**Items 9, 29 — the overlay.** Per D4. Uses `framer-motion` (already a dependency).
Contents: recent (localStorage, per-viewer), grouped results across customers / orders /
pages, and `User Switcher` for Login-As (slice N).

---

## Slice J — Layout & skeletons

**Items 4, 6** are one defect: full-width single-column stacks holding narrow content. Both
become `repeat(auto-fit, minmax(…))` grids rather than hardcoded column counts, so they
reflow instead of needing another fix at the next breakpoint.

**Item 15** — «سفارش‌های بدون مسیر» and «مسیرهای باز» sit adjacent with different heading
treatments because each page hand-rolls its own. They share one section-header primitive.
This will recur elsewhere; the primitive is the fix, not the two instances.

**Item 17** — text escaping cards on `/sales/deliveries`. **Not yet diagnosed.** To be
found before it is specified.

**Item 20 — reframed.** The skeletons *do* shimmer (`globals.css:1429`). The complaint is
that the `grid` and `board` shapes render as a scatter of small blocks. The
`shadcn.io` skeleton category supplies a vocabulary matching our actual pages —
`Kanban Board`, `Map View`, `Map Sidebar`, `Dashboard Stats`, `Table With Pagination`,
`Timeline`, `App Shell`. The five generic shapes become page-shaped silhouettes: one header
bar and one large body mass per shape, not twelve tiles.

---

## Slice K — Data display

All built per D1 — our SVG primitives, our tokens, RTL.

| Item | Form | Source block |
|---|---|---|
| **7** | two modes per D5 | `stepper-vertical-icons` + `timeline-customer-journey` |
| **10** | KPI strip → connected bar with sparkline + delta; تحلیل عمیق gets a hero metric card; expandable detail cards | `stats-connected-kpi-bar-with-trends`, `stats-hero-metric-card` |
| **14** | rep activity heatmap — **and this is where the avatars belong** | `stats-activity-streak` |
| **16** | بار مسیرها as **lanes on a shared time axis**, not a tube | `timeline-multi-track` |

**Item 16 is the best find in this programme.** A route *is* a lane with events in time; the
"long tube" was a progress bar impersonating a schedule. The multi-track form is not a
prettier version of what is there — it is the correct shape for the data.

**Item 14 is a reframe worth flagging.** The user asked for avatars on `/sales/runs`. A
streak grid per rep answers *"who is actually working"* rather than merely labelling rows.
Avatars are added too, but the streak is the substance.

---

## Slice L — Map

Direction **A + C**, chosen by the user: **inspector when something is selected, viewport
worklist when nothing is.**

The sidebar has 8 sections. Only one — «لینک‌های سریع» — is the duplicated navigation the
user objected to; the other seven are genuinely map-native. So the problem is not that the
sidebar is wrong, it is that **the sidebar is a menu when it should be an instrument
panel.**

- **Nothing selected → viewport worklist.** What needs doing *in the area on screen*:
  dormant customers in frame, overdue reminders in frame, uncovered districts in frame.
  Panning and zooming rewrites it. This makes the map a work surface rather than a viewer.
- **Something selected → inspector.** The record fills the panel.
- **«لینک‌های سریع» is deleted.** It is the nav bar's job now.
- Layer/colour/heatmap/legend controls stay — they are "how is this drawn", which is the
  panel's other legitimate job.

**Item 26 — "it looks like an iframe."** The `Inset` / `Floating` sidebar variants are the
likely direct answer; the map currently reads as a pane bolted into the shell rather than a
page wearing it.

The `shadcn.io` **Map** category turned out to contain this application almost verbatim —
`Sales Territories`, `Service Coverage`, `Delivery Zones`, `Dispatch Dashboard`,
`Driver Assignment`, `Fleet Tracker`, `Last Mile Delivery`, `Route Planner`,
`Warehouse Network`, `Store Locator`, `Traffic Heatmap`. `Dispatch Dashboard` and
`Fleet Tracker` are both "map + contextual inspector", which independently corroborates
A + C.

**Item 29** — map buttons and icons adopt the app's `Icon` vocabulary and button tokens;
map search becomes the D4 overlay.

---

## Slice M — Workflows & IA

**Item 22 — drag and drop.** Two distinct faults:

1. **Confirmed:** `Board.tsx:384` draws the ghost at a hardcoded `x + 14, y - 18` instead
   of recording where inside the card the grab happened. This is the user's "5 cm afar".
   Fix: capture `grabDx/grabDy` on `pointerdown`, render at `x - grabDx, y - grabDy`.
2. **Not diagnosed.** "Not working at all" is not explained by reading — `data-lane`,
   `pointer-events: none` on the ghost, and the pointer-capture logic all look correct.
   The `<Pocketed>` wrapper added in the last slice is the prime suspect. **To be debugged,
   not guessed at.**

**We do not adopt `@dnd-kit`.** It is not currently a dependency, and it would mean
rewriting two working boards to fix a four-line offset bug. Our `useCardDrag` is
pointer-event based, handles touch, and is already shared. Fix it.

**Item 18 — batches vs inventory. Answered: partly, and here is why not wholesale.** A
batch is a stock lot, so its *list* belongs with انبار. But batches carry a state machine
(quarantine → released → recalled) that stock does not, and recall is a *workflow*, not an
inventory view. The list becomes a section inside `/sales/stock`; the recall/release
actions keep a focused surface. Merging wholesale buries a safety-critical workflow inside
a stock table.

**Item 25 — merge `admin/representatives` and `reps`. Agreed.** One is "define a
representative", the other is "how are my reps performing" — one subject at two lifecycle
stages. The nav labels («تعریف نمایندگی» / «نمایندگان فروش») exist only because the pages
collided. One page, two modes. Source: `team-accordion-profiles`.

**Item 23 — `/sales/academy` redesign.** Source: the `onboarding` category. Academy is a
learning path, which is what onboarding blocks are shaped for.

---

## Slice N — Global services

Deferred from slice C, now cheap because the block vocabulary exists.

- **Themed error pages.** The app currently has **no `app/not-found.tsx` and no
  `app/error.tsx` at all.** Beyond 403/404/500, three blocks map to states this app
  *already has and does not surface*: **`Sync Conflict`** and **`Connection Lost`** (the
  outbox carries `conflict` and `failed` statuses today with nothing behind them) and
  **`Session Expired`**.
- **Login-As impersonation** — `command-menu-user-switcher`, inside the D4 overlay.
- **Monitoring** — a proper home for the sync indicator trimmed in item 8.
- **Empty states** — `EmptyState` has 9 call sites and no design behind it.
- **Jalali calendar primitives** — `jalaliMonthGrid`, `todayJalali` and `shiftMonth`
  already exist in `lib/jalali.ts`, so a Jalali date picker is assembly, not invention.
  This is what unblocks the `<input type="date">` half of items 19/21.

---

## Out of scope

- **Migrating `sales` to carry `organization_id`.** The cost-to-serve "match quality"
  figure has been dead since tenancy landed; `MatchQuality.measurable` now makes the panel
  say so rather than show a confident zero. Fixing it properly is a schema migration and a
  separate decision.
- **Visual-regression screenshots.** See D2.
- **`@dnd-kit`.** See slice M.
- Merging any further pages beyond item 25.

---

## Open questions

1. **Branch.** `app-shell-foundations` is deployed to production `:3003` and unmerged to
   `main`. Does this programme stack on it, or does that branch merge to `main` first?
   Recommendation: **merge it first** — production is already running it, so `main` is
   currently behind what is live, which is the wrong way round.
2. **Item 17** — needs diagnosis before its fix can be specified.
3. **Item 22, second fault** — needs debugging before its fix can be specified.
