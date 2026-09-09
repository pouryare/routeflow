# App Shell Unification & Design-System Foundations — Design

**Date:** 2026-09-09
**Status:** Approved for planning
**Slice:** 1 of 7 (combines categories A "UI/UX & Design System Consistency" and
B "Navigation, Header, & Layout Architecture" from the refactor brief). Categories
C–G (global services, map/GIS, CRM fixes, logistics, calendar/i18n/splash) are
separate specs and are explicitly out of scope here.

---

## Problem

The `kargah` design system and its shell (top chrome, travelling-pill nav, profile
menu, entrance motion) exist only under `/sales/*`. Every other surface —
`/map`, `/planner`, `/report`, `/leads`, `/analytics`, `/facilities`, `/gallery`,
`/settings` — renders outside that shell with ad-hoc chrome and no shared theme, so
they read as a different application. Within the shell there are further problems the
brief calls out:

- No icon library — ~13 files carry hand-rolled inline `<svg>`, styling drifts.
- Cards are inconsistent: some carry a top coloured accent border, hover behaviour
  varies card-to-card, and the "carved bay / notched corner" that `MASTER.md` names
  as the brand identity is specified (`TARGET`) but unbuilt.
- Numeric metrics render statically; `MASTER.md` Tier 3 motion ("data counts up")
  is unbuilt.
- No contextual help on cards/charts.
- The nav is a deliberate two-row travelling pill; the brief wants it collapsed to
  one row beside the brand with hover-activated group menus.
- The profile dropdown and secondary nav open on click; the brief wants hover.
- The notification bell is mounted at the root and floats at the bottom; the brief
  wants it in the header next to the profile.
- Every `/sales` page is `export const dynamic = "force-dynamic"` server-rendered,
  so a navigation blocks on the previous view until the next route's server render
  resolves — the "page transition freeze".

## Goals

1. One shared shell + theme across every surface **except `/driver`** (and
   `/login`, `/offline`). `/driver` keeps its bare phone-width identity.
2. `/map`, `/facilities`, `/gallery` join the shell but their **canvas and map
   panels stay dark** regardless of the viewer's light/dark skin.
3. One header row: brand · travelling pill (hover-opens group tabs) · global-search
   slot · notification bell · profile (hover). The pill keeps its animated thumb.
4. A whole-app set of primitives — `Icon`, `Card` (standardised, optional notch),
   `PageHeaderCard`, `Counter`, `CardHelp` — rolled out to **every card and icon in
   the app**, not just `/sales`.
5. Instant page transitions: the target layout + a high-fidelity per-page skeleton
   mount immediately on navigation; slow data streams in behind `<Suspense>`.
6. `MASTER.md` updated in lockstep so it stays the source of truth.

## Non-goals

- The command-palette global search itself (Slice C) — this slice only reserves the
  header slot and the `⌘K` / `Ctrl-K` hotkey.
- Themed 403/404/500 pages and Lottie error art (Slice C) — this slice only adds a
  baseline `not-found.tsx` / `error.tsx` under `(shell)`.
- `/facilities` → modal conversion (Slice D).
- Any map layer / GIS / Drive Mode / customer-modal work (Slice D).
- Any per-module CRM / logistics / calendar / i18n / avatar / splash work
  (Slices E–G).
- Rewriting the working pure-CSS `RevealRoute` / `RouteFade` entrance motion.

---

## Decisions (ratified during brainstorming)

| # | Decision |
|---|----------|
| 1 | A and B ship as **one spec / one plan** — they touch the same files. |
| 2 | **Keep the travelling-pill aesthetic.** One row, beside the brand, hover opens the group's tabs as a popover. Do not replace it with a plain menubar. |
| 3 | **Every surface except `/driver`** gets the unified header/shell/theme. `/map` canvas keeps dark styling; header + tokens unify across it. This overrides `MASTER.md`'s current "the map is out of scope here" line. |
| 4 | **Primitives + whole-app rollout.** Build the primitives and convert every card and icon across the whole app in this slice. |
| 5 | Add **`lucide-react` + `framer-motion`.** `framer-motion` becomes the motion layer for new work going forward; existing pure-CSS entrance motion stays until independently touched. |
| 6 | **Per-page high-fidelity skeletons** — a hand-built `loading.tsx` per route segment mirroring that page's real layout, plus per-section `<Suspense>`. |
| 7 | The page-header card's notch holds the **active section's sibling tabs** as a persistent inline row (siblings always visible without hovering the header). |
| 8 | Structure: **root theming + methodical page-group rollout.** Move the `.kargah` scope to a near-root `(shell)` layout; `/driver` is the explicit opt-out; roll primitives out page-group by page-group, each step green. |

---

## Approaches considered

- **Root theming + methodical rollout (chosen).** Move the theme scope + `<AppShell>`
  to an `app/(shell)/` route-group layout so the whole app is themed by default;
  `app/(bare)/` holds `/driver`, `/login`, `/offline`. Then roll primitives out one
  page-group at a time with tests. Matches `MASTER.md`'s "records first, the map is
  one surface among several" and decision #3. Blast radius is a one-time directory
  move (cheap because imports are `@/`-absolute).
- **Shared `<AppShell>` component, sales stays the anchor (rejected).** Keep
  per-section layouts; each page opts into `<AppShell>`. Lower blast radius, but every
  future page must remember to opt in and theme drift stays possible — the exact
  failure mode we're fixing.
- **Parallel new shell, migrate then delete (rejected).** Build the new shell beside
  `Chrome`/`TabPill`, migrate, then delete the old. Safest rollback, but two shells
  coexist mid-migration — duplicated upkeep and a fresh drift surface.

---

## Section 1 — Shell & routing architecture

### Route groups

```
app/
  layout.tsx                 # unchanged role: <html>/<body>, theme/accent/font init
                             #   scripts, ServiceWorkerRegister, ToastProvider,
                             #   MyPositionProvider. NO NotificationBell here anymore.
  (shell)/
    layout.tsx               # <div className="kargah min-h-screen"> + <AppShell>
    not-found.tsx            # baseline, inside the shell (themed version = Slice C)
    error.tsx                # baseline route error boundary (themed version = Slice C)
    sales/…                  # moved from app/sales
    map/…                    # moved from app/map           (data-surface="map")
    facilities/…             # moved from app/facilities     (data-surface="map")
    gallery/…                # moved from app/gallery        (data-surface="map")
    planner/…                # moved from app/planner
    report/…                 # moved from app/report
    leads/…                  # moved from app/leads
    settings/…               # moved from app/settings
  (bare)/
    driver/…                 # moved from app/driver — bare, phone-width, unchanged
    login/…                  # moved from app/login
    offline/…                # moved from app/offline
    today/…                  # moved from app/today — driver-only briefing route
```

`app/analytics/` is not moved — it is replaced (see "/analytics merge" below).

Route groups do not change URLs. The moves are `git mv`; the app uses `@/…`
absolute imports almost everywhere, so import paths survive. The plan must sweep:

- hard-coded route **strings** (there should be none pointing at `/analytics`
  already — `lib/salesNav.ts` asserts this — but re-grep),
- `export const dynamic` / `export const metadata` / `generateMetadata` on moved
  pages (behaviour is unchanged by the move, but verify),
- `next.config.ts` redirects/rewrites, `proxy.ts`, and middleware matchers,
- test imports and Playwright path fixtures.

### Theme scope

Today `.kargah` is a class on a `<div>` in `app/sales/layout.tsx`, and every token
in `app/globals.css` is defined under `.kargah`. Move the class onto the wrapper
`<div>` in `app/(shell)/layout.tsx`. Token definitions in `globals.css` are
untouched. `(bare)` routes never carried `.kargah`, so nothing regresses; if any
bare page turns out to read a `.kargah` token, give that page an explicit local
value (documented as a bare-route exception).

### Map dark override

`/map`, `/facilities`, `/gallery` layouts set `data-surface="map"` on their content
wrapper. `globals.css` gains a block that pins the map **canvas and its floating
panels** to the dark palette values under `.kargah [data-surface="map"]`, so the
map reads dark even when the viewer's skin is light. The header, the
`PageHeaderCard`, and any non-map chrome on those routes follow the normal theme.

`MASTER.md` "Product shape" / "Visual thesis" edit: replace "The map keeps its own
dark identity and is out of scope here" with a statement that the map **canvas**
keeps its dark identity while the header and design tokens are unified across it.

### `AppShell`

`components/kargah/AppShell.tsx`:

```
<AppShell>
  <AppHeader />                       {/* Section 2 */}
  <RevealRoute />                     {/* unchanged pure-CSS entrance */}
  <RouteFade>{children}</RouteFade>   {/* unchanged */}
  <SyncStatus />                      {/* existing */}
  {/* NotificationCenter portal target */}
</AppShell>
```

Server component where possible; `AppHeader` and its interactive children are
client components. `Chrome`'s hide-on-scroll wrapper is retained, now wrapping the
single header row.

### NotificationBell relocation

- Remove `<NotificationBell />` from `app/layout.tsx`.
- `AppHeader` renders the bell trigger between the search slot and the profile.
- `NotificationCenter` (the panel/portal) is unchanged; it mounts from `AppShell`.
- `(bare)` routes: `/driver` keeps whatever notification affordance it has today
  (unchanged); no bell is added to bare routes.

### `/analytics` merge

`app/analytics/page.tsx` currently renders `CostToServePanel` + cost-to-serve
rows. `lib/salesNav.ts` already records that the dashboards collapsed to
`/sales/dashboard` and nothing links to the retired `/sales/analysis`.

- Move `CostToServePanel` (and its server data assembly) into `/sales/dashboard`
  as a section (behind its own `<Suspense>`).
- Replace `app/analytics/page.tsx` with a permanent redirect to
  `/sales/dashboard` (Next `redirect()` in a server component, or a
  `next.config.ts` `redirects()` entry — plan picks one; config redirect is
  preferred so the route segment can be deleted).
- `/report` stays a standalone page (it is a distinct print/CSV artifact); it
  simply joins `(shell)`.

---

## Section 2 — Header & navigation

### Layout

One sticky row, RTL (visual order runs right → left), inside the existing
`Chrome` hide-on-scroll wrapper:

```
right ─────────────────────────────────────────────────────────────────── left
[◆ RouteFlow            ] [ روزمن فروش تحویل مالی انبار مدیریت میدان ] ⟵flex⟶ [⌘K] [🔔] [avatar]
[  <jalali date, wide>  ]  └ travelling pill: animated thumb under active group ┘
```

- Brand mark + title unchanged. The jalali date sits beneath the title on wide
  viewports and collapses (to a title attribute) on narrow.
- On narrow viewports the pill scrolls horizontally (as the group row does today);
  the search slot collapses to an icon button.

### `HoverPill` (refactor of `components/kargah/TabPill.tsx`)

- The pill carries the **group labels only** (7 groups after the registry
  extension — see below). The animated `.thumb` sits under the active group. All of
  `slideThumb`, the `ResizeObserver`, and the `document.fonts.ready` re-measure are
  kept — this is the signature motion and the reason to keep the pill.
- **Hover a group → a popover** opens beneath it listing that group's tabs from the
  nav registry, with the current tab marked. Click a tab to navigate.
- **Pointer-leave** closes the popover after a short delay with a safe hover
  corridor (so a diagonal move to the popover doesn't dismiss it).
- **Touch / no-hover:** tap a group opens the popover; tap a tab navigates; tap
  elsewhere closes.
- **Keyboard:** Tab to focus a group, `ArrowDown`/`Enter` opens, arrows move within
  the popover, `Esc` closes and restores focus to the group.
- The permanent second nav row is removed. Group tabs remain reachable without
  hover via the `PageHeaderCard` notch (Section 3), so nothing is buried.
- `framer-motion` drives the popover open/close (presets from `lib/motion.ts`),
  `AnimatePresence` for exit. Respects `prefers-reduced-motion` (instant).

### Nav registry — `lib/appNav.ts`

Supersede `lib/salesNav.ts` with `lib/appNav.ts`:

- `SalesGroupId` → `AppGroupId`; add one group `"field"` labelled «میدان و نقشه».
- New entries: `/map`, `/planner`, `/leads` under `"field"`; `/report` under
  `"money"`. `ready` / role gating unchanged in shape.
- `activeSalesGroup` → `activeGroup`; same longest-prefix-match logic.
- `salesTabs(session)` → `appTabs(session)`.
- `tests/salesNav.test.ts` → `tests/appNav.test.ts`, invariants extended:
  every `ready` tab lands in exactly one group; no two visible tabs share a label
  or `href`; nothing points at `/analytics` or `/sales/analysis`; the adopted
  routes are present and role-gated as specified.

Keep a one-line re-export shim `lib/salesNav.ts → lib/appNav.ts` only if a
grep shows external importers that are cheaper to leave than to update; otherwise
update all importers and delete `salesNav.ts`.

### Global search slot

- `AppHeader` renders an inert search affordance (icon + placeholder «جستجو…» +
  a `⌘K` hint) occupying the slot.
- A global `keydown` listener (`⌘K` on mac, `Ctrl-K` elsewhere) focuses/клicks the
  slot. In this slice it does nothing more than focus; Slice C mounts the palette.
- The listener lives in a small `components/kargah/SearchSlot.tsx` client
  component so Slice C can replace its body without touching `AppHeader`.

### `ProfileMenu` — click → hover

- Open on `pointerenter`; close on `pointerleave` after a ~200 ms delay with a
  hover corridor to the panel.
- `Esc` still closes; a click on the trigger still toggles (touch path).
- `aria-expanded` / `aria-haspopup` kept; focus management unchanged.
- Panel content unchanged (map link, notification settings link, skin/font/accent
  pickers). Note: the standalone map link inside the panel becomes redundant once
  `/map` is a nav destination — keep it for now, revisit in Slice D.

---

## Section 3 — Design-system primitives (whole-app rollout)

All live in `components/kargah/`, all values sourced from `MASTER.md` tokens.

### `Icon`

`components/kargah/Icon.tsx` — wrapper over `lucide-react`.

- API: `<Icon name="truck" size="md" className? />`. `size` ∈ `sm | md | lg` →
  `16 | 20 | 24` px (tokens). `strokeWidth` fixed to the `MASTER.md` value.
  Colour is always `currentColor` — no multi-tone, enforcing "flat monochrome".
- A migration pass replaces every inline `<svg>` icon and every emoji-as-icon
  across the app with `<Icon>`. Enumerate current inline-svg icon files
  (~13) in the plan.
- **Documented exceptions** (stay bespoke SVG): the brand route-mark in
  `app/(shell)/layout.tsx` / `AppHeader`, and the facility glyphs in
  `components/facilityIcon.ts` / `components/facilityArt.ts` (domain artwork, not
  UI icons).
- `MASTER.md` "Base components" gains an `Icon` entry naming `lucide-react` as the
  single icon source and listing the exceptions.

### `Card`

`components/kargah/Card.tsx` — the one card primitive.

- Removes the top coloured accent line wherever it appears. Plan audits for
  `border-top`, `border-t-*`, and `::before` accent bars across `globals.css` and
  component styles.
- **One hover behaviour for every card**: the lift + shadow the product card uses
  today, on the `MASTER.md` spring. All bespoke per-card hover rules are removed.
- `notch` prop: `"none" | "block-start" | "inline-start" | corner values`.
  Renders the carved-bay / inverted-radius cut via `clip-path` per `MASTER.md`'s
  "Carved bay card" `TARGET`. `notchSlot` renders content into the opened space
  (icon, `AvatarStack`, tabs).
- `CardHeader` sub-component exposes a `help` slot (see `CardHelp`).
- Promote `MASTER.md` "Carved bay card" `TARGET` → `SHIPPED` when this lands.

### `PageHeaderCard`

`components/kargah/PageHeaderCard.tsx` — the first card on every `(shell)` page.

- Props: `title: string`, `overview: ReactNode` (2–3 lines), `route: string`
  (used to look up the active group and its sibling tabs).
- Body: the overview text.
- Notch (`block-start`): the **active group's sibling tabs** as a persistent inline
  row, the current one marked `aria-current="page"`. Uses the same registry as
  `HoverPill`. This is the "sub-menu anchor in the notched border area" from the
  brief and the reason header hover is not the only path to sibling tabs.
- Copy registry `lib/pageMeta.ts`: `Record<routePattern, { title; overview }>` in
  Persian. A vitest asserts **every `(shell)` route segment has an entry** (walk
  the `app/(shell)` tree, compare to keys).
- `MASTER.md` "Base components" gains a `PageHeaderCard` entry; the "top card of
  every page" rule is written into the layout guidance.

### `Counter`

`components/kargah/Counter.tsx` — `framer-motion`.

- API: `<Counter to={1234} format={faNum} from={0} trigger="in-view" | "mount" />`.
- Uses `useInView` + `animate` on a `useMotionValue`; eased with a `lib/motion.ts`
  preset mirroring the `MASTER.md` Tier 3 curve.
- `prefers-reduced-motion`: render `format(to)` immediately, no animation.
- Formatting always goes through the passed formatter (`faNum` / `faFixed`) so
  digits stay Persian and tabular.
- Rollout: replace raw numeric renders in stat cards / dashboards / KPI strips
  across the app. Plan enumerates the metric sites.
- Promote `MASTER.md` "Gradient stat card" `TARGET` → `SHIPPED` where the stat
  card is converted alongside.

### `CardHelp`

`components/kargah/CardHelp.tsx`.

- An `(i)` `<Icon name="info">` button rendered in the `CardHeader` `help` slot.
- Click (not hover — this is a deliberate, readable action) opens a `framer-motion`
  popover with two parts: **what this shows** and **how to read it / what to do
  about it**.
- Content registry `lib/help/<area>.ts`, keyed by a stable `helpId` passed to the
  card. High-traffic charts/cards get real copy now; the long tail gets a typed
  `{ helpId, todo: true }` placeholder that renders a muted «راهنمای این بخش
  به‌زودی» and is enumerable for follow-up. A vitest lists all `todo: true` ids so
  the debt is visible.
- `MASTER.md` "Base components" gains a `CardHelp` entry.

### Motion layer

- Add `framer-motion`. `lib/motion.ts` exports the `MASTER.md` curves and durations
  as `Transition` / `Variants` presets (`spring`, `entrance`, `data`, `ambient`),
  so no component hand-rolls values — same "no magic numbers" rule as tokens.
- `RevealRoute` / `RouteFade` (pure CSS) are **unchanged**. New motion
  (`HoverPill` popover, `ProfileMenu`, `Counter`, `CardHelp`) uses the presets.
- `MASTER.md` "Motion" section updated: pure-CSS entrance and `framer-motion`
  coexist; the presets mirror the token values; `framer-motion` is the layer for
  new interactive motion.
- Bundle: `framer-motion` is imported normally in shell components; on the map
  routes any motion-heavy piece is `next/dynamic`-imported and the map canvas
  keeps CSS-only motion.

---

## Section 4 — Instant transitions & skeletons

- The header/shell already stay mounted across navigation (they live in
  `(shell)/layout.tsx`, not in pages), so only the page body needs to swap fast.
- **`loading.tsx` on every `(shell)` route segment.** Each is hand-built to mirror
  that page's real layout, composed from `components/Skeleton.tsx`
  (`SkeletonLine` / `SkeletonBlock` / `SkeletonRows` / `SkeletonThumbs`) plus new
  shape helpers as needed. Each `loading.tsx` renders the **real `PageHeaderCard`**
  (title, overview, sibling tabs are static and known instantly) above a skeleton
  body. Result: a navigation instantly shows the correct header, the correct nav
  state, the correct page title, and a correctly-shaped body placeholder.
- **`<Suspense>` around independently-fetched regions** inside pages so a fast
  region paints before a slow one (e.g. `/sales/dashboard` headline stats before
  the cost-to-serve table folded in from `/analytics`).
- Page-swap animation: keep `RouteFade`'s CSS crossfade. `loading.tsx` gives the
  instant swap; a `framer-motion` crossfade is optional polish, not required, and
  is not in scope unless it falls out cheaply.
- **Skeleton flash:** because pages are `force-dynamic`, a genuinely fast server
  render can show the skeleton for one frame. Mitigate with `<Suspense>`
  granularity (only the slow part gets a fallback) and, where needed, a short
  reveal delay on the skeleton. Plan calls out which pages need tuning.
- **Baseline error/again routes:** `(shell)/not-found.tsx` and
  `(shell)/error.tsx` so a bad direct navigation (`/sales/customer/12` and
  friends) resolves inside the shell instead of a raw Next 404. The **themed**
  403/404/500 with Lottie art is Slice C.

---

## Section 5 — Rollout order, testing, risks

### Rollout order (each step must ship green: `npm run build`, `npm test`, `npm run lint`)

1. **Deps + leaf primitives.** Add `lucide-react`, `framer-motion`. Build `Icon`,
   `Card` (+ `CardHeader`), `lib/motion.ts`. Extract `lib/appNav.ts` from
   `salesNav.ts` with the `"field"` group and adopted routes; move/extend tests.
   No visual change yet.
2. **Shell.** Create `app/(shell)/` and `app/(bare)/`; `git mv` the route dirs;
   build `AppShell`; move the `.kargah` scope; add `data-surface="map"` + the
   dark override; remove `NotificationBell` from the root and mount it in
   `AppShell`. Sales looks ~unchanged; adopted pages gain the shell.
3. **Header.** `AppHeader` + `HoverPill` (from `TabPill`) + `ProfileMenu` hover +
   `SearchSlot` (inert) + `⌘K` listener.
4. **`PageHeaderCard` + `lib/pageMeta.ts`.** Add to every `(shell)` page — the
   large sweep. vitest for pageMeta completeness.
5. **`Counter` + `CardHelp`.** Roll out across stat cards / metrics / chart cards
   app-wide; populate high-traffic help copy; leave typed TODO placeholders.
6. **`loading.tsx` per segment + `<Suspense>` boundaries.**
7. **Icon codemod sweep** (inline `<svg>` / emoji → `<Icon>`); **kill top accent
   lines**; **hover-parity audit** (every `Card` uses the one hover rule).
8. **`/analytics` merge + redirect + segment delete; `MASTER.md` reconciliation;
   `npm run check:contrast`.**

### Testing

- **vitest:** `appNav` invariants; `pageMeta` completeness (every `(shell)` segment
  has an entry); `CardHelp` registry (list `todo` ids); `Counter` / motion presets
  (reduced-motion returns final value); `Icon` name→component resolution.
- **Playwright:** hover a group → popover appears → click a tab navigates; profile
  opens on hover and closes on leave/Esc; keyboard path (focus, ArrowDown, Esc);
  `prefers-reduced-motion` disables counters and popover motion; `loading.tsx`
  renders on a throttled navigation and the header stays put; `/map` renders dark
  under a light skin; `/driver` renders with **no** shell; `/analytics` redirects
  to `/sales/dashboard`.
- **Contrast:** `scripts/check-contrast.mjs` for any token added by the map
  override.
- **Manual:** one visual pass per page-group after step 4 and step 7.

### Risks & mitigations

- **Directory move.** `@/…` imports survive; the risk is route strings, `dynamic` /
  `metadata` exports, `next.config.ts`, `proxy.ts`, middleware matchers, and test
  fixtures. Mitigation: explicit grep checklist in the plan; do the move as its own
  reviewed step with the build green before anything else changes.
- **Skeleton flash on fast `force-dynamic` renders.** Mitigation: `<Suspense>`
  granularity + short skeleton reveal delay on the pages that need it.
- **`framer-motion` bundle on the already-heavy map routes.** Mitigation: dynamic
  import motion-heavy pieces; map canvas motion stays CSS-only.
- **Whole-app card/icon sweep is the bulk of the effort.** Mitigation: page-group
  ordering (steps 4–7), each landing green with its own tests; the sweep is never
  one big commit.
- **`MASTER.md` is "source of truth, no magic numbers".** Every primitive pulls
  from tokens or `lib/motion.ts`; the `MASTER.md` edits land in the same step as
  the code they describe, not batched at the end (except the final reconciliation
  pass in step 8 for status-marker promotions).
- **`salesNav.ts` rename churn.** Mitigation: grep importers first; shim only if
  cheaper than updating them.

---

## Files touched (indicative, not exhaustive)

**New**
- `app/(shell)/layout.tsx`, `app/(shell)/not-found.tsx`, `app/(shell)/error.tsx`
- `app/(bare)/layout.tsx` (if any shared bare chrome is needed; else none)
- `components/kargah/AppShell.tsx`, `AppHeader.tsx`, `HoverPill.tsx`,
  `SearchSlot.tsx`, `Icon.tsx`, `Card.tsx`, `PageHeaderCard.tsx`, `Counter.tsx`,
  `CardHelp.tsx`
- `lib/appNav.ts`, `lib/pageMeta.ts`, `lib/motion.ts`, `lib/help/*.ts`
- `app/(shell)/**/loading.tsx` (one per segment)
- `tests/appNav.test.ts`, `tests/pageMeta.test.ts`, `tests/cardHelp.test.ts`,
  Playwright specs

**Moved**
- `app/{sales,map,facilities,gallery,planner,report,leads,settings}` →
  `app/(shell)/…`
- `app/{driver,login,offline,today}` → `app/(bare)/…`

**Modified**
- `app/layout.tsx` (drop `NotificationBell`)
- `app/globals.css` (theme scope note, `data-surface="map"` block, remove card
  accent lines, carved-bay styles)
- `components/kargah/TabPill.tsx` → `HoverPill.tsx` (refactor)
- `components/kargah/ProfileMenu.tsx` (hover)
- `components/kargah/Chrome.tsx` (wrap one row)
- `app/sales/layout.tsx` (thin to nothing / fold into `(shell)` layout;
  keep the driver/role redirects where they belong)
- `MASTER.md` (map, motion, Base components, "top card of every page" rule,
  status-marker promotions)
- every card/icon/metric call site across the app (steps 4–7)

**Deleted**
- `app/analytics/page.tsx` (→ redirect in `next.config.ts`, segment removed)
- `lib/salesNav.ts` (unless a shim is kept)

---

## Open questions for the plan

- Redirect for `/analytics`: `next.config.ts` `redirects()` (lets the segment be
  deleted) vs a server-component `redirect()` (keeps a stub). Plan decides;
  config redirect preferred.
- Whether `(bare)` needs its own `layout.tsx` at all. Default: no — the moved
  pages (`/driver`, `/login`, `/offline`, `/today`) already render their own
  minimal chrome; add a `(bare)/layout.tsx` only if a shared concern (e.g. a
  common `<meta>` or provider) turns up during the move.
- Exact new-group label — «میدان و نقشه» vs «ابزارها» — settle with a quick
  Persian copy check during step 1.
