# MASTER — Coverage Map Design System

Canonical source of truth. Every color, font, spacing, radius, elevation and motion
value in the app comes from this file. No magic numbers in components.

**Status markers.** This file describes a system mid-migration, so every section that
is not yet fully shipped says so:
`SHIPPED` in the app now · `TARGET` agreed, not yet built · `CHANGED` replaces an MVP rule.

> **What changed from the MVP.** The first version of this file described a single-world
> dark map console. Two things about the product turned out differently: the CRM/ERP
> surfaces (orders, leads, runs, stock, commission) are the daily work, not the map, and
> the app is used both in a vehicle at night and at a desk in daylight. So the system now
> carries **two themes**, and its component vocabulary is built around **records, boards
> and schedules** first, with the map as one surface among several rather than the hero
> everything else defers to.

---

## Product shape

Read this before making a layout decision — it settles most of them.

| Surface | Routes | What it is |
|---|---|---|
| **CRM / ERP** (primary) | `/sales/*`, `/leads`, `/analytics`, `/report` | Order-to-cash, leads, stock, purchasing, commission. Dense records, boards, tables, charts. |
| **Field** | `/driver`, `/planner` | One thumb, in a moving vehicle. Big targets, minimal chrome. |
| **Map** | `/`, `/facilities`, `/gallery` | Spatial view of the same records. |
| **Admin** | `/admin/*`, `/login` | Low-traffic, plain. |

The map is no longer "the uncontested hero." It is the spatial *view* of records that
also have board, table and schedule views. Design the record first; the map renders it.

## Visual thesis `CHANGED`

A precise, information-dense operations console that reads as instrument panel rather
than consumer app. Thin borders, tabular numbers, status that glows in the dark and
prints crisply in the light. One accent for interaction, three for status, never
crossed. Persian text in Vazirmatn carries every label and name; a monospace face
carries every number, so a column of figures lines up and a customer code is never
mistaken for prose.

**Dual-world commitment.** Dark is the default and the identity — it is what the app
looks like in a vehicle at night, and the map, markers and glows are tuned for it.
Light is a first-class equal, not an afterthought inversion: it has its own palette,
its own elevation model, and its own contrast budget. A component is not done until it
has been looked at in both.

## Interaction thesis `SHIPPED`

Fast, precise transitions (120–300ms, one sharp ease-out, no bounce). Interactive
elements answer with a glow-intensify (dark) or shadow-lift (light) plus a 1.03 scale.
Customer markers carry a recurring radar-ping as their idle state so the map reads as
live. Everything degrades cleanly under `prefers-reduced-motion`.

---

## Theme architecture `SHIPPED`

Two themes, **one token API**. Components never branch on theme — they consume
`var(--surface)`, `var(--elev-2)`, `var(--text-muted)` and get the right answer in both
worlds. If a component needs an `if (theme === 'light')`, the token layer is missing
something; add the token instead.

```css
:root { /* dark — the default and the identity */ }
:root[data-theme="light"] { /* light — every token redefined, none inherited */ }
```

Rules:

- **Dark is the default.** No `data-theme` attribute means dark. `prefers-color-scheme`
  is consulted **only on first visit** to pick the initial value; after that the user's
  explicit choice is persisted and wins. A field app must not flip theme under someone
  at sunset because the OS did.
- **Every token is redefined in the light block.** None inherit. A token defined only in
  the dark block is a bug that shows up as an invisible element in light mode.
- **The toggle is a sun/moon switch in the header**, reachable from every screen. It is
  also mirrored in settings. The switch animates as a morph, not a swap: the sun's rays
  retract as the disc slides and a shadow bite crescents it into a moon, on
  `--spring-snap` / `--dur-base`. It carries `aria-pressed` and a text label for screen
  readers -- the icon alone does not say which mode you are about to enter.
- **The map is themed too** — light mode uses a light tile set, and `.tiles-inverted`
  (the CSS filter that darkens tiles) is dark-only.

## Color `SHIPPED`

Same semantic roles in both themes; different values. Status meaning never moves.

### Dark (default)

| Token | Hex | Contrast vs `--bg` | Role |
|---|---|---|---|
| `--bg` | `#0A0E14` | — | App canvas |
| `--surface` | `#121A24` | — | Sidebar, panels, cards |
| `--surface-raised` | `#182230` | — | Popups, modals, dropdowns |
| `--border` | `#1E2A38` | — | Hairlines, dividers |
| `--border-strong` | `#2A3A4C` | — | Emphasized borders |
| `--accent` | `#2DE0E6` | 11.90:1 | Interactive UI only |
| `--accent-dim` | `#1B8A8F` | — | Accent at rest on large fills |
| `--accent-ink` | `#04191C` | 11.13:1 on accent | Text on an `--accent` fill |
| `--sweep-opacity` | `0.12` | — | Ambient sweep alpha |
| `--text` | `#E7EEF5` | 16.53:1 | Primary text |
| `--text-muted` | `#8697A8` | 6.45:1 | Secondary text, labels |
| `--text-faint` | `#71808F` | 4.78:1 | Tertiary — timestamps |
| `--good` | `#3DDC84` | 10.84:1 | بازدید شده / فعال |
| `--warn` | `#F5A623` | 9.54:1 | نیاز به پوشش / سرنخ |
| `--crit` | `#F0475B` | 5.30:1 | اجازه ورود ندارم / بدهی بحرانی |
| `--neutral` | `#78889A` | 5.33:1 | نامشخص / غیرفعال |
| `--facility` | `#D6E6F5` | 15.19:1 | Our own sites |

### Light

| Token | Hex | Contrast vs `--bg` | Note |
|---|---|---|---|
| `--bg` | `#F1F4F7` | — | Cool-tinted, never pure `#FFFFFF` |
| `--surface` | `#FFFFFF` | — | Cards lift *off* the ground, not into it |
| `--surface-raised` | `#FFFFFF` | — | Separated from `--surface` by elevation, not tint |
| `--border` | `#DDE3EA` | — | |
| `--border-strong` | `#C2CCD6` | — | |
| `--accent` | `#0B7C82` | 4.51:1 | Same hue, darkened — cyan cannot pass on white |
| `--accent-dim` | `#6BC4C8` | — | |
| `--accent-ink` | `#FFFFFF` | 4.98:1 on accent | Not an inversion -- see below |
| `--sweep-opacity` | `0.05` | — | 0.12 over a pale canvas is a grey wedge |
| `--text` | `#0F1922` | 16.09:1 | Near-black, cool-tinted |
| `--text-muted` | `#56636F` | 5.58:1 | |
| `--text-faint` | `#616D79` | 4.79:1 | |
| `--good` | `#147D4B` | 4.68:1 | |
| `--warn` | `#8A5300` | 5.73:1 | Amber darkens to bronze; there is no light amber that passes |
| `--crit` | `#BE2637` | 5.40:1 | |
| `--neutral` | `#5F6C79` | 4.87:1 | |
| `--facility` | `#2B4A66` | 8.37:1 | Inverted — pale blue is invisible on white |

**All 18 text values clear 4.5:1 against their own canvas**, verified by computation, not
by eye. Two MVP values did not and have been raised: `--text-faint` (`#546271`, 3.10:1)
and `--neutral` (`#5B6B7C`, 3.54:1). Both were absent from the MVP contrast table.

Rules that hold in both themes:

- **A color means one thing.** `--accent` is interaction and never status; status colors
  are never borrowed for interactive chrome; `--facility` is infrastructure and is
  neither. Our own depots carry no coverage reading, so they may not wear a status color.
- **Color is never the only signal.** The Persian status word sits beside every dot.
- **Status fills** (dots, pills, marker bodies) are non-text and answer to the 3:1
  threshold, so light mode may keep a brighter fill than its text token — but a bright
  fill on white takes a 1px darkened ring to hold its edge.
- **Primary button text** comes from `--accent-ink`, never a literal. It is a token
  precisely because it does not invert cleanly: dark's bright cyan needs near-black ink,
  light's darkened teal needs white. This value was hardcoded as `#04191c` in 55 places
  across 34 files, every one of which broke the moment a second theme existed -- which is
  the clearest argument in this document for why the token layer is the whole system.

## Elevation `SHIPPED`

The MVP rule was "glow, never shadow — a dark console has no light source above." That
is right in dark and wrong in light, where a glow reads as a blur or a rendering
artifact rather than as lift. So elevation is now **one API with two implementations**.

| Token | Meaning | Dark | Light |
|---|---|---|---|
| `--elev-1` | Resting card, list row | `0 0 0 1px var(--border)` | + `0 1px 2px rgba(15,25,34,.06)` |
| `--elev-2` | Raised: popup, dropdown, drag ghost | `--border-strong` + `0 8px 24px -8px rgba(2,5,9,.9)` | `0 4px 12px rgba(15,25,34,.10)` |
| `--elev-3` | Modal, island, bottom sheet | `--border-strong` + `0 16px 48px -12px rgba(2,5,9,.95)` | `0 12px 32px rgba(15,25,34,.16)` |

The dark values are a halo of near-black around a lighter surface. That is technically a
shadow, and the MVP's "no drop shadows, a dark console has no light source" rule was
pointing at something real but stated too broadly: what does not work on `#0A0E14` is a
shadow that implies *lighting from above*. A dark halo implies occlusion instead, which
is how a raised panel actually separates from a near-black ground. A neutral-white glow
was the alternative and looks like a rendering fault; an accent-tinted one would have
broken the rule that `--accent` means interaction and nothing else.

Shadows in light are **tinted to the canvas hue** — `rgba(15, 25, 34, …)`, never neutral
black — and every shadow in the app implies the same single light source, directly above.

The three *status* glow classes (`.elevate-good` / `-warn` / `-crit`) become a **2px
`border-inline-start` plus a 4% tinted fill** in light -- logical property, not
`border-left`, so the bar lands under the first word in an RTL row. "This row is critical"
must survive the theme change.

`.elevate-accent` is deliberately excluded from that treatment and becomes a **soft 3px
ring** instead. A bar down the leading edge is a status device, and accent is interaction:
it marks focus and the card you are working in. Giving it the bar put a teal stripe down
the edge of the login card, which read as a rendering fault rather than as emphasis.

## Typography `CHANGED`

- **UI / Persian:** Vazirmatn (`--font-vazirmatn`). Every label, name, sentence.
- **Data / telemetry:** JetBrains Mono (`--font-mono`). Every number — coordinates,
  amounts, customer codes, counts, compact dates. Weight 400 only.
  **`font-variant-numeric: tabular-nums` is mandatory** on any number that sits in a
  column or animates, so figures do not shift width as they change.

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 0.6875rem / 11px | Eyebrow labels, badges (mono, tracked) |
| `--text-sm` | 0.8125rem / 13px | Secondary UI text, filters |
| `--text-base` | 0.875rem / 14px | Default body/UI text |
| `--text-md` | 1rem / 16px | Popup titles, emphasized rows |
| `--text-lg` | 1.25rem / 20px | Section headers |
| `--text-xl` | 1.5rem / 24px | Page title |
| `--text-2xl` | 2rem / 32px | `TARGET` KPI figure on a stat tile |
| `--text-3xl` | 2.75rem / 44px | `TARGET` The single headline number on a dashboard |

The two display sizes are new and exist for one reason: a dashboard's primary figure
should be readable across a desk. They are **mono, weight 400, tracking `-0.02em`** —
a large number is the one place the console voice gets to be loud, and it stays loud
through size, not weight.

Line-height 1.5 for Persian body (Vazirmatn needs the room), 1.3 for mono data rows.
Body copy caps at ~65 characters. `text-wrap: balance` on headings, `pretty` on paragraphs.

## Spacing `SHIPPED`

Base 4px. `1` 4 · `2` 8 · `3` 12 · `4` 16 · `5` 20 · `6` 24 · `8` 32 · `12` 48.
Dense (`3`–`4`) inside sidebars, rows and tables; generous (`8`–`12`) between the major
regions of a CRM page. The map gets no forced padding — it fills.

## Radii `CHANGED`

The MVP used one tight scale (4 / 6 / 10) because "sharp reads console." That still
holds for dense controls, but a 420px-wide bento tile with a 6px radius reads as a table
cell, not a card. **Radius scales with surface size.**

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 4px | Pills, badges, status chips |
| `--radius-md` | 6px | Buttons, inputs, dense rows |
| `--radius-lg` | 10px | Panels, modals, side sheets |
| `--radius-xl` | 14px | `TARGET` Bento tiles, stat cards, board columns |
| `--radius-2xl` | 20px | `TARGET` Notification island, bottom detail strip |

Nothing is fully rounded except status pills and avatars. Inner elements always take a
smaller radius than the container holding them.

## Motion `CHANGED`

Motion is a headline feature of this app, not a garnish. The MVP banned spring easing
outright; that ban is lifted. But "more animation" is not the goal -- **choreography** is.
A hundred elements that each spring independently reads as a toy; twenty that enter in a
considered sequence reads as expensive. What follows is a tiered system: each tier says
which curve is correct and, more usefully, which is wrong.

### Curves

| Token | Value | Character |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | The default. Fast out, soft landing, no overshoot. |
| `--spring-snap` | `cubic-bezier(0.34, 1.26, 0.64, 1)` | Slight overshoot. Small controls, toggles, chips. |
| `--spring-pop` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Clear overshoot. Shape morphs, sheets, entrances. |
| `--spring-drop` | `cubic-bezier(0.22, 1.61, 0.36, 1)` | Heavy settle. A dragged object landing. |

A cubic-bezier can only overshoot once. For a true multi-oscillation settle, use CSS
`linear()` -- supported in every browser this app targets -- and keep it to the two or
three places where the extra weight is actually felt.

### Durations

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120ms | Press/active feedback |
| `--dur-base` | 180ms | Hover, focus, small transitions |
| `--dur-slow` | 300ms | Panel/modal enter-exit |
| `--dur-morph` | 420ms | Island collapse - expand |
| `--dur-settle` | 320ms | Drag release, card landing |
| `--dur-draw` | 700ms | Chart line draw, number count-up |
| `--stagger-tight` | 20ms | Table rows |
| `--stagger-base` | 40ms | Board cards, list items |
| `--stagger-loose` | 60ms | Bento tiles, sidebar sections |
| `--pulse-duration` | 2400ms | Marker radar-ping loop |
| `--pulse-stagger` | 800ms | Delay between ping rings |
| `--sweep-duration` | 4000ms | Ambient radar sweep |
| `--drift-duration` | 12000ms | Gradient wash drift |

### Tier 1 -- Direct manipulation. Spring belongs here.

Anything the user physically moved, or that changes shape rather than position. Overshoot
is correct because real objects carry momentum, and its absence is what makes an
interface feel like a slideshow.

| What | Curve | Duration |
|---|---|---|
| Island collapse - expand | `--spring-pop` | `--dur-morph` |
| Drag lift (card leaves the column) | `--spring-snap` | `--dur-fast` |
| Drop settle (card lands) | `--spring-drop` | `--dur-settle` |
| Board column reflow after a drop | `--spring-snap` | 300ms |
| Bottom sheet / detail strip entry | `--spring-pop` | 380ms |
| Toggle knobs, including sun/moon | `--spring-snap` | `--dur-base` |
| Reorder / FLIP list moves | `--spring-snap` | 280ms |

### Tier 2 -- Choreography. Stagger, not spring.

This tier is where the impression of quality actually comes from. Elements never mount
all at once; they cascade, and the cascade has a direction that matches the reading
order -- in an RTL layout that is right to left, top to bottom.

| What | Treatment |
|---|---|
| Board cards entering a column | `--stagger-base`, `--ease-out` 260ms, 8px rise + fade |
| Bento tiles | `--stagger-loose`, `--ease-out` 300ms, 12px rise + fade |
| Sidebar sections | `--stagger-loose` (shipped), capped at 8 items |
| Table rows | `--stagger-tight`, capped at 12 rows, then the rest appear together |
| Modal card | `--ease-out`, scale 0.97 - 1 |
| Record - detail navigation | Shared-element: the card's title and status pill persist and travel into the detail header rather than the page cross-fading |

A stagger that runs past ~8 items stops reading as choreography and starts reading as
lag. Every stagger in this system is capped, and past the cap the remainder appears
together.

### Tier 3 -- Data. Never spring.

| What | Treatment |
|---|---|
| Number count-up | `--ease-out`, `--dur-draw`, `tabular-nums` mandatory |
| Chart line draw | `--ease-out`, `--dur-draw`, `stroke-dashoffset` |
| Bar grow | `--ease-out` 500ms + `--stagger-tight` |
| Donut sweep | `--ease-out` 800ms |
| Progress / gauge fill | `--ease-out` 500ms |
| Skeleton - content | 200ms cross-fade, no movement |

**Why spring is forbidden here, specifically.** An overshooting value is briefly *wrong*.
A bar that springs past its endpoint misreports the number for ~150ms, and a count-up
that overshoots shows a figure that was never true. In an app where the numbers are
money, stock and commission, that is not a stylistic objection.

### Tier 4 -- Ambient. Slow, looping, decorative.

Radar sweep (`--sweep-duration`, linear), marker ping (`--pulse-duration`), gradient wash
drift (`--drift-duration`), cursor-following spotlight on bento tiles (no easing --
it tracks the pointer directly). All are `pointer-events: none`, none block input, and
all stop entirely under `prefers-reduced-motion`.

### Where spring stays banned

Not style preferences -- each has a specific cost.

- **Buttons and links on hover.** They are precision targets. A control that overshoots
  its own bounds is momentarily harder to hit, and at a 1.03 scale over 180ms the
  overshoot is invisible anyway. Pure cost, no benefit.
- **Map markers and map controls.** Leaflet already applies its own inertia to pan and
  zoom. A second physics model layered on top does not compound, it fights -- markers
  appear to lag the map they are pinned to.
- **Driver mode, entirely.** `.driver-mode` is, in this codebase's own words, "the same
  app, sized for one thumb in a moving vehicle." Overshoot animation read inside a moving
  vehicle is a motion-sickness trigger, and the person is driving. Driver mode gets
  `--ease-out`, short durations, and no ambient loops.
- **Anything the user is waiting on.** A spinner, a saving state, a pending request. Added
  duration on a blocking transition is added latency, whatever the curve.

### Reduced motion

`prefers-reduced-motion: reduce` collapses all four tiers: springs become `--ease-out`,
staggers become simultaneous, ambient loops stop, morphs become cross-fades, count-ups
and chart draws render at their final value immediately. The app must remain fully usable
and must not lose any information that motion was carrying.

Still forbidden regardless of tier: animating `width`/`height`/`top`/`left` (transform and
opacity only -- the island morphs via `transform: scale` and a clip, never box
dimensions), and scroll-driven parallax.

---

## Base components `SHIPPED`

- **Button** — `--surface` bg, 1px `--border`, `--radius-md`. Primary: `--accent` fill
  with `#04191C` text (dark) / `#FFFFFF` text (light). Hover: border→accent, text→accent,
  scale 1.03, `--dur-base`. Active: scale 0.98, `--dur-fast`. Focus: 2px `--accent`
  outline at 2px offset. Disabled: 40% opacity, no pointer events.
- **Input / select** — `--surface` bg, 1px `--border`, `--radius-md`, mono for numerics.
  Focus: border→accent + glow (dark) / border→accent + ring (light).
- **Card** — `--surface`, `--elev-1`, `--radius-lg`, `padding: var(--space-4)`.
- **Status pill** — `--radius-sm`, mono `--text-xs` tracked, colored dot + 16% tinted
  fill, text in the full status color, Persian word always present.
- **Map marker** — 14px diamond, status fill, 2px `--bg` ring, status glow, idle ping.
- **Facility marker** — `--facility`, distinguished by silhouette before color:
  warehouse a filled hexagon (26×29, center-anchored, crate knocked out); home base a
  hollow house (24×26, base-anchored). Both static — the ping belongs to live readings,
  and a building is not one. Drawn above the cluster layer.
- **Skeleton** — matches the shape of what is loading. Never a spinner.

## CRM / ERP patterns `TARGET`

The vocabulary the redesign adds. Each exists to serve a specific record in the schema.

### Notification island `SHIPPED`
Built as `components/Island.tsx`; `ToastProvider` renders through it. A pill that lives
collapsed and expands to detail. Collapsed: 40px tall, `--radius-2xl`,
mono label + status dot. Expanded: up to 420px wide, same radius, `--elev-3`.
Morphs on `--spring-pop` / `--dur-morph`; content cross-fades at half duration, delayed by
a third of it, so the box is visibly travelling before the text lands.

The morph animates `width` and `height`, which the Motion section forbids in general. The
exemption is narrow and mechanical: the island is `position: fixed` so it has no siblings
to re-lay-out, and it carries `contain: layout paint size` so nothing outside its box can
be affected by what happens inside. The banned-in-general rule is about layout thrash, and
neither half of it reaches here. `transform: scale` was the alternative and is worse -- it
scales the text with the box, and counter-scaling it back visibly breaks the joins on a
connected Persian face through the whole transit. Replaces the toast stack, the geofence arrival prompt and the next-stop
bar with one primitive — they are the same object at different sizes. Under
`prefers-reduced-motion` it cross-fades between the two states with no morph.

### Bento detail strip `SHIPPED`
The record detail view: a horizontal strip of unequal tiles rather than a column of
fields. Identity tile (name, code, status) + 2–4 mini stat tiles (debt, last visit,
order count) + a media tile (`photos`) + one gauge. `--radius-2xl` on the strip,
`--radius-xl` on the tiles inside it. On phones it becomes the existing bottom sheet.

### Assignment board `SHIPPED`
Built as `components/sales/AssignmentBoard.tsx`, against the existing
`POST /api/sales/runs/[id]/stops` -- new interaction, no new endpoint and no new
authorisation surface. Records as cards in status columns. **Drag a card onto a person or a run to assign it.**
The drag ghost takes `--elev-2` and 3° of tilt; valid targets lift and take an accent
ring; the drop opens a confirm sheet (record, assignee with avatar and role, target run,
amount, note) before anything is written. Nothing is assigned by drop alone — a
mis-drop must not silently reassign a delivery. Serves `orders` → `delivery_stops`; `lead_list_items` → `users` is not built yet.

Keyboard parity is not a fallback bolted on afterwards -- clicking a card and dragging it
open the *same* confirm sheet, the only difference being whether the run arrives
preselected. `touch-action: none` on the card is what makes the pointer-based drag work on
a phone at all; without it the browser claims the gesture for scrolling on the first
touchmove and the feature simply does not exist for the people using it in a vehicle.

The drag ghost is positioned with physical `top`/`left`, deliberately against this
codebase's logical-property convention: its transform is built from pointer `clientX`,
which is measured from the viewport's left edge regardless of direction, so anchoring it
to `inset-inline-start` put it off the right edge of an RTL screen -- in the DOM, invisible
on screen.

### Document-pocket card `SHIPPED`
A record card whose attached documents peek above its top edge — receipt, delivery note,
commission statement — each a small rotated preview with 12–16px showing. The card is
the pocket. A status-keyed color wash bleeds up through the surface behind the papers.
Serves `orders`, which already generate all three.

### Stat tile `SHIPPED`
KPI figure at `--text-2xl`/`--text-3xl` in mono, label beneath at `--text-xs`, optional
delta chip (arrow + percent, `--good`/`--crit`). Tiles may carry a **soft gradient wash**
keyed to their metric via `chartPalette` — a diffuse radial in the corner at low alpha,
never a hard 45° linear fade, and never the purple-to-blue AI gradient.

### Line chart `SHIPPED`
Smooth curves via `smoothLinePath`, and specifically **monotone cubic**
(Fritsch-Carlson) rather than Catmull-Rom or a plain spline. Those overshoot: given
10, 90, 90 they draw a curve that rises above 90 between the second and third point. On
this app's charts the y-axis is money and stock, so a curve bulging past the highest
reading is the plot claiming a figure that never happened. `tests/chartScale.test.ts`
evaluates the emitted beziers and asserts the curve never leaves the data's range. Hovering pins a floating pill above the
point — label, value, delta — with a vertical hairline down to the axis. Series colors
come from `chartPalette` only. Dotted grid, never solid.

### Schedule: run timeline `SHIPPED` · gantt + calendar `TARGET`
Two views over the same rows. **Gantt**: `delivery_runs` as rows, `delivery_stops` as
segments across the day; drag a segment sideways to re-time, onto another row to
reassign driver — the assignment board's interaction in time form. **Calendar**: month
grid of `visit_plans` and `reminders`, day cells carrying status dots. Both Jalali via
`lib/jalali.ts`; both RTL, which means time runs **right to left** — a gantt that grows
leftward is correct here and reviewers will flag it as a bug, so it is written down.

### Avatar stack `SHIPPED`
Assigned people as a row of 28px avatars straddling the top edge of the card they belong
to, overlapping by 8px, capped at 5 with a `+N` chip. Squircle, not circle. Each carries
a count badge when it has a load to report.

---

## Anti-patterns

- No purple/pink AI-gradient anything.
- No emoji as icon.
- No token defined in only one theme block.
- No component that branches on theme in JS.
- No glow used as elevation in light mode; no drop shadow in dark.
- No `--accent` carrying status, no status color carrying interaction.
- No color as the only signal.
- No spring easing in Tier 3 (data), on hover targets, on map layers, or in driver mode.
- No stagger that runs past its cap; no motion that survives `prefers-reduced-motion`.
- No animation on `width`/`height`/`top`/`left`.
- No map tile obscured by decoration — sweep and glows live in chrome and marker layers.
- No spinner where a skeleton fits.
- No three-equal-column feature row; no accordion where a list works.
- No proportional figures in a column of numbers.

## Not yet decided

- Whether `/report` print styles get a light-theme pass or keep their own sheet. Print is
  already the one place the MVP allowed a light world, and it may simply become light
  mode now.
- Icon set. The app currently has no consistent one; Lucide and Feather are the AI
  defaults and are excluded. Phosphor is the leading candidate.
- Whether the map's light tile set is a hosted style or a CSS filter on the dark one.
