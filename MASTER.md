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

**کارگاه — a warm workshop, not an instrument panel.**

The MVP called this "a precise, information-dense operations console that reads as
instrument panel." That was built and shipped and is exactly what got rejected: three
successive redesigns handed back the same dark-navy-and-cyan console, because every one
of them was executed faithfully against the sentence above. A redesign that does not
replace the thesis cannot happen. This is the replacement.

The sales section is a **workshop bench**, not a cockpit. Warm off-white ground, white
surfaces lifted by real shadow, generous radii, and a terracotta accent — warm where
every other operations tool in the category is cold blue-grey. Numbers stay tabular and
figures stay honest; what changes is that the app stops performing seriousness at the
reader and starts being comfortable to stand in front of for eight hours.

**Light is the default and the identity.** This inverts the MVP. The people who use
`/sales` are standing in a shop in daylight with a phone, or at a desk; a near-black
screen is worst exactly where the work happens. Dark is a first-class equal — same
tokens, own palette, own contrast budget, its own gradient mixes — and it is what the
app looks like at night. The map keeps its own dark identity and is out of scope here.

Three devices carry the personality, and they are the reason this reads as designed
rather than themed:

1. **Documents live in pockets.** An order is not a row; it is a card with its receipt
   and invoice tucked behind it, their colour glowing through a frosted face. Hover and
   they fan out.
2. **Cards have bays cut out of them.** A rounded rectangle is *subtracted* from a card's
   corner and the avatars of the people involved sit in the space it opens.
3. **Everything arrives.** Sections enter in a staggered sequence; a chart draws its own
   line and drops its points one at a time.

## Interaction thesis `CHANGED`

Warm and physical. Surfaces lift toward the pointer on a soft spring rather than
snapping; a dragged card tilts and casts a real shadow; a state change is announced by
the island rather than by a colour quietly changing under the reader.

Two rules keep it from becoming a toy. **Choreography over animation** — twenty elements
entering in sequence reads as expensive, a hundred springing independently reads as
cheap. And **the stagger is capped**: past ten items a sequence stops reading as rhythm
and starts reading as lag, so item eleven onward shares item ten's delay.

Everything degrades cleanly under `prefers-reduced-motion`: the entrance becomes an
immediate paint, not a slow one.

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

## Color `CHANGED`

Same semantic roles in both themes; different values. Status meaning never moves.
Every figure below is computed, not eyeballed — see `scripts/check-contrast.mjs`.

### Light (default)

| Token | Hex | vs `--bg` | vs `--surface` | Role |
|---|---|---|---|---|
| `--bg` | `#F4F0E9` | — | — | Warm ground. Never pure white, never cool grey. |
| `--surface` | `#FFFFFF` | — | — | Cards lift *off* the ground |
| `--surface-2` | `#FDFBF8` | — | — | Inset rows, quiet fills |
| `--surface-sunk` | `#EFE9E0` | — | — | Tab trough, progress track |
| `--border` | `#EAE2D7` | — | — | Hairlines |
| `--border-strong` | `#DED4C6` | — | — | Emphasized borders |
| `--text` | `#231C16` | 14.80 | 16.81 | Primary text |
| `--text-muted` | `#776C60` | 4.51 | 5.12 | Secondary text |
| `--text-faint` | `#91887C` | 3.07 | 3.49 | **Non-text only** — see below |
| `--accent` | `#C0532B` | 4.10 | 4.65 | Terracotta. **Fills only** |
| `--accent-text` | `#B44E28` | 4.55 | 5.17 | Accent *as text* — links, amounts due |
| `--accent-ink` | `#FFFFFF` | 4.65 on accent | — | Text on an accent fill |
| `--good` | `#4F6B4A` | 5.23 | 5.94 | تحویل‌شده / پرداخت‌شده |
| `--warn` | `#7A5409` | 5.96 | 6.78 | تأییدشده / بخشی |
| `--crit` | `#A11B3F` | 6.74 | 7.65 | بدهی بحرانی / لغوشده |
| `--info` | `#2E6382` | 5.74 | 6.52 | در مسیر |
| `--tint-plum` | `#6B4FA0` | 5.69 | 6.46 | Avatar tint only — carries no status |

### Dark

| Token | Hex | vs `--bg` | vs `--surface` | Note |
|---|---|---|---|---|
| `--bg` | `#141110` | — | — | Warm near-black, **not** the map's blue-black |
| `--surface` | `#1E1A17` | — | — | |
| `--surface-2` | `#242019` | — | — | |
| `--surface-sunk` | `#2B241E` | — | — | |
| `--border` | `#312A22` | — | — | |
| `--border-strong` | `#3E352B` | — | — | |
| `--text` | `#F3EEE7` | 16.28 | 14.97 | |
| `--text-muted` | `#9B8F81` | 5.94 | 5.46 | |
| `--text-faint` | `#8A8278` | 4.96 | 4.56 | Clears text here; light's cannot |
| `--accent` | `#E8734A` | 6.25 | 5.75 | Lifted — light's brick vanishes on black |
| `--accent-text` | `#E8734A` | 6.25 | 5.75 | Same value; dark needs no split |
| `--accent-ink` | `#241009` | 6.06 on accent | — | **Near-black, not white** |
| `--good` | `#93C289` | 9.23 | 8.49 | |
| `--warn` | `#E0A64A` | 8.70 | 8.00 | |
| `--crit` | `#F2789B` | 7.10 | 6.53 | |
| `--info` | `#83B9DC` | 8.89 | 8.18 | |
| `--tint-plum` | `#B79EEA` | 8.14 | 7.48 | |

Four findings from computing this table rather than trusting the prototype:

- **`--text-faint` cannot be a text colour in light.** The prototype's `#B3A899` sits at
  2.06:1. Solved to 4.5 it becomes `#736C62`, which is indistinguishable from
  `--text-muted` — the two roles collapse. So light's faint is demoted to a **non-text**
  token (out-of-month day numbers, placeholder glyphs, decorative separators) and answers
  to 3:1. Anything a reader must actually read uses `--text-muted`.
- **The accent needs a text variant in light and not in dark.** `#C0532B` is a fine fill
  (white on it clears 4.65) but only 4.10 as text on the warm ground. `--accent-text`
  darkens it until it passes. Dark's `#E8734A` clears both, so there the two tokens hold
  the same value — the split exists in the API, not in the palette.
- **`--accent-ink` does not invert.** White on light's brick is 4.65; white on dark's
  lifted terracotta is **3.01 and fails**. Dark's button ink is near-black `#241009`
  (6.06). This is the same trap the MVP hit with cyan, in the opposite direction.
- **Critical had to move off red.** With a terracotta accent, an orange-red `--crit`
  (`#B3261E`) sits ΔE 17 from it — near-indistinguishable, and worse under protanopia.
  `--crit` is now a crimson (`#A11B3F`, ΔE 35; dark `#F2789B`, ΔE 41), separated by
  **hue**, not merely by lightness.

Rules that hold in both themes:

- **A color means one thing.** `--accent` is interaction and never status; status colors
  are never borrowed for chrome; `--tint-plum` and its siblings are avatar identity and
  are neither.
- **Color is never the only signal.** The Persian status word sits beside every dot, and
  the pipeline column a card sits in says its status independently of any colour.
- **Status fills** (dots, pills) are non-text and answer to 3:1 against the surface they
  sit on, verified per pair — a soft-tinted pill's text answers to 4.5 against the pill,
  not against the page.

## Elevation `CHANGED`

One API, two implementations — the MVP's structure survives; its values do not.

| Token | Meaning | Light | Dark |
|---|---|---|---|
| `--sh-1` | Resting card, list row | `0 1px 2px rgba(62,44,28,.05), 0 4px 14px -6px rgba(62,44,28,.10)` | `0 1px 2px rgba(0,0,0,.5), 0 4px 14px -6px rgba(0,0,0,.6)` |
| `--sh-2` | Hover lift, dropdown | `0 2px 5px rgba(62,44,28,.06), 0 14px 34px -12px rgba(62,44,28,.17)` | `0 2px 5px rgba(0,0,0,.55), 0 14px 34px -12px rgba(0,0,0,.7)` |
| `--sh-3` | Modal, island, bottom sheet | `0 4px 10px rgba(62,44,28,.07), 0 28px 60px -18px rgba(62,44,28,.28)` | `0 4px 10px rgba(0,0,0,.6), 0 28px 60px -18px rgba(0,0,0,.8)` |
| `--sh-lift` | Fanned document, drag ghost | `0 10px 22px -8px rgba(62,44,28,.24), 0 30px 60px -24px rgba(62,44,28,.30)` | as `--sh-3` |

Two changes of substance:

- **Light shadows are tinted warm** (`rgba(62,44,28,…)`), matching the ground's hue.
  A neutral-black shadow on a warm ground reads as dirt.
- **Borders are no longer part of elevation.** The MVP's `--elev-1` was a 1px ring; here
  a resting card carries shadow only, and `--border` is reserved for genuine dividers.
  A card that has both a hairline and a shadow reads as two competing edges.

**A clipped shape takes `filter: drop-shadow(...)`, not `box-shadow`.** The carved bay
card (below) is cut with `clip-path`, and a box-shadow is drawn on the border box, which
the clip then removes — the card loses its shadow entirely. `--card-drop` is the
drop-shadow form of `--sh-1` and exists for exactly this case.

## Typography `CHANGED`

Vazirmatn and JetBrains Mono are retired from `/sales`. Vazirmatn is the safe Persian
default and reads as such; the console voice it carried is the thing being replaced.

- **UI / Persian:** IBM Plex Sans Arabic (`--font-fa`). Every label, name, sentence.
  Humanist rather than geometric, and it has a genuine 300–700 range, which the density
  of a CRM row actually needs.
- **Data / Latin:** Plus Jakarta Sans (`--font-en`). Every number — amounts, weights,
  codes, counts, percentages — plus Latin eyebrows. Weights 400–800.
  **`font-variant-numeric: tabular-nums` is mandatory** on any number in a column or
  animating.

A note on why the data face is a *sans* and not a mono. Persian digits (`۰-۹`) are drawn
by the Arabic font, not the Latin one, so a Latin monospace never touched the figures it
was chosen for — it only ever styled the separators and the Latin labels beside them.
Tabular figures do the aligning; the mono was decoration.

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 0.6875rem / 11px | Eyebrow labels, badges |
| `--text-sm` | 0.8125rem / 13px | Meta rows, captions |
| `--text-base` | 0.9375rem / 15px | Default body/UI text |
| `--text-md` | 1.0625rem / 17px | Emphasized rows, card titles |
| `--text-lg` | 1.3125rem / 21px | Section headers |
| `--text-xl` | 1.5rem / 24px | Page title |
| `--text-2xl` | 2rem / 32px | KPI figure on a stat tile |
| `--text-3xl` | 2.875rem / 46px | The one headline number on a dashboard |

Display sizes are **`--font-en`, weight 700–800, tracking `-0.03em`**. This reverses the
MVP, which set them at weight 400 on the argument that "a large number gets loud through
size, not weight." On a warm ground with soft shadows a 400-weight 46px figure reads as
washed out rather than as restrained.

Line-height 1.8 for Persian body, 1.3 for figures. Body copy caps at ~65 characters.

## Spacing `SHIPPED`

Base 4px. `1` 4 · `2` 8 · `3` 12 · `4` 16 · `5` 20 · `6` 24 · `8` 32 · `12` 48.
Dense (`3`–`4`) inside sidebars, rows and tables; generous (`8`–`12`) between the major
regions of a CRM page. The map gets no forced padding — it fills.

## Radii `CHANGED`

Scaled up across the board. The MVP's 4/6/10 said "sharp reads console"; this system is
not a console. Radius still scales with surface size — a 420px tile and a 32px chip
cannot share a value.

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 9px | Badges, small chips |
| `--radius-md` | 12px | Dense rows, inputs, board cards |
| `--radius-lg` | 16px | Inner panels, list blocks |
| `--radius-xl` | 20px | Document cards, tiles |
| `--radius-2xl` | 26px | Cards, blocks, modals, the bottom sheet |
| `--radius-pill` | 999px | Buttons, tabs, status pills, avatars |

Buttons and tabs are **fully rounded** — the single loudest signal that this is not the
old console. Inner elements always take a smaller radius than the container holding them.

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

### Tier 0 -- Entrance. The section arrives; it does not appear.

Opening a tab plays the section in. Cards rise 16px and fade, `--stagger-base` apart,
**capped at ten items** — item eleven onward shares item ten's delay. A chart draws its
line over `--dur-draw`, fades its fill and comparison series in behind it, then lands its
points one at a time.

Only `opacity` and `transform` animate. Nothing reflows.

**The reset is the hard part, and it is a trap worth writing down.** To replay an
entrance you must first put the element back to its start state. If the stagger delay is
still on the element at that moment, the reset inherits it — and *a zero-duration
transition that carries a delay still holds the old value for the length of that delay*.
The element does not reset; it waits, and by the time it would have, the entrance has
already been switched back on. Only the first item (delay 0) ever animates.

So the sequence is fixed: `transition: none` + clear the delay → force a style flush
(read a layout property) → restore the transition, set the delay, add the class. Getting
this wrong is silent — no error, just an entrance that mysteriously only plays for one
element.

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
Prototype: the کارگاه artifact (four screens, both themes, all interactions live).

### Document pocket card `TARGET` — replaces `OrderPocketCard`
An order rendered as a card with its documents tucked *behind* it: receipt, invoice,
route sheet. The face is frosted (`backdrop-filter: blur(16px) saturate(1.5)`) so the
documents' colour bleeds through as a soft wash. At rest they sit low, peeking ~30px.
On hover or focus they **fan apart and rise above the face** (`z-index`, not clipping),
tilting outward, and both become fully readable.

Two constraints, both learned the hard way:
- The documents move *down* at rest and rise to `y: 0` on hover, so they never leave the
  card's own box. Moving them up instead puts them outside it, where the section's
  `overflow: hidden` shaves the top row.
- Two 138px documents do not fit inside a ~270px card. The fan deliberately **overhangs
  the card's edges**; the raised `z-index` on the hovered pocket is what makes that legal.

### Carved bay card `TARGET`
A rounded rectangle **subtracted** from a card's top inline-start corner, leaving a
stepped edge with a rounded inner corner. The avatars of the people on the record sit in
the bay it opens. Cut with `clip-path: path()` computed from the card's measured size —
a mask sized in percentages stretches the corner radii as the card grows — recomputed on
`ResizeObserver`, and dropped entirely below 360px.

The avatars must live in a **sibling** of the carved element. `clip-path` and `mask` clip
descendants too, so avatars placed inside the card are erased by the very bay meant to
hold them.

### Travelling tab pill `TARGET`
One pill that slides and resizes to the selected tab, `--spring-pop`. It is positioned
before its transition is enabled, so it does not fly in from x=0 on first paint, and it
re-measures on `ResizeObserver` and on `document.fonts.ready`.

### Order pipeline `TARGET` — extends `AssignmentBoard`
Columns are **statuses** (پیش‌نویس / تأییدشده / در مسیر / تحویل‌شده), not people; the
assignee is a property shown on the card. Dragging moves the order between statuses.

Pointer events, never HTML5 drag-and-drop — the native API does not fire on touch, and
this board is used on a phone in a shop. Two rules the implementation must keep:
- **Capture on the card, not the container.** `setPointerCapture` retargets the whole
  gesture, click included; capturing on the board makes every tap report the board as its
  target, so a tap can never tell which card it hit.
- **Never `preventDefault()` on `pointerdown`** — it suppresses the compatibility mouse
  events, so the card's own click never fires. Guard selection with `user-select: none`
  on the board and `touch-action: none` on the card instead.

### Processing modal `TARGET`
Opened by tapping a pipeline card. Creator (read-only), assignee as avatar chips, and a
**range slider for the amount collected** against the order total, with هیچ / نصف /
تسویهٔ کامل shortcuts. The filled part of the track is painted by hand as a linear
gradient — a range input offers no pseudo-element for it — and the input takes
`direction: rtl` so it fills from the right.

### Order journey `TARGET`
Swimlanes for the order lifecycle: ثبت سفارش → تأیید و قیمت‌گذاری → بارگیری و مسیر →
تحویل و تسویه. Each lane holds task nodes with the responsible person's avatar and a tick
that toggles. Lanes are joined by a dotted connector that points along the reading
direction.

### Gradient stat card `TARGET`
The dashboard's headline figures on soft multi-stop mesh gradients, mixed **warm** so
they sit in the same room as the accent rather than arriving from a different palette.
Dark carries its own mixes — the light pastels glare on a dark ground.

### Spline chart `TARGET` — extends the chart kit
Catmull-Rom through the points converted to cubic béziers, an area fill under the current
series, the comparison series as a dotted line, and a tooltip that follows the nearest
point. In RTL **the oldest day sits on the right**.

### Notification island `SHIPPED`
Unchanged in behaviour; re-skinned. Still the one primitive behind toasts, the geofence
prompt and the next-stop bar. The `width`/`height` exemption documented under Motion
still applies and still has the same justification.

### Bento detail strip `SHIPPED`
Unchanged in structure; re-skinned. On phones it is the bottom sheet, which is now also
the customer detail view opened by tapping a pocket card.

### Assignment board `SHIPPED`
Superseded by **Order pipeline** above. Same endpoint, same authorisation surface.

## Anti-patterns

- No purple/pink AI-gradient anything. (Warm mesh gradients are specified above and are
  not this: they are warm, low-contrast, and carry a figure.)
- No emoji as icon.
- No token defined in only one theme block.
- No component that branches on theme in JS.
- No `--accent` carrying status, no status color carrying interaction.
- No color as the only signal.
- **No `--text-faint` on anything a reader must read** — it does not clear 4.5:1 in light.
- **No white text on the dark theme's accent fill** — it is 3.01:1. Use `--accent-ink`.
- **No `box-shadow` on a `clip-path`ed element** — use `--card-drop`.
- **No stagger delay left on an element while resetting its entrance** — see Tier 0.
- **No `setPointerCapture` on a drag container**, and no `preventDefault()` on
  `pointerdown` — both silently destroy the click.
- **No `inset-inline-start` for centring a fixed overlay.** Under RTL it is the *right*
  edge, so `translate(-50%)` walks the element off toward the left. Centred overlays use
  physical `left: 50%`.
- No spring easing in Tier 3 (data), on hover targets, on map layers, or in driver mode.
- No stagger that runs past its cap; no motion that survives `prefers-reduced-motion`.
- No animation on `width`/`height`/`top`/`left` outside the island's documented exemption.
- No spinner where a skeleton fits.
- No proportional figures in a column of numbers.

## Not yet decided

- Whether `/report` print styles get a light-theme pass or keep their own sheet. Print is
  already the one place the MVP allowed a light world, and it may simply become light
  mode now.
- Icon set. The app currently has no consistent one; Lucide and Feather are the AI
  defaults and are excluded. Phosphor is the leading candidate.
- Whether the map's light tile set is a hosted style or a CSS filter on the dark one.
