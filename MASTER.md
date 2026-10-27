# MASTER — RouteFlow Design System

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

The app is split by **shell**, not by subject. `app/(shell)/` wears the header, the nav
pill and the page-overview card; `app/(bare)/` wears the palette and nothing else.

| Group | Routes | What it is |
|---|---|---|
| **Shell** — CRM / ERP (primary) | `/sales/*`, `/leads`, `/report` | Order-to-cash, leads, stock, purchasing, commission. Dense records, boards, tables, charts. |
| **Shell** — spatial | `/map`, `/facilities`, `/gallery`, `/planner` | The same records, placed. `/map` is the only true canvas and is pinned dark; the other three are record pages that follow the skin. |
| **Shell** — settings | `/settings/*` | Low-traffic, plain, but part of the app. |
| **Bare** | `/driver`, `/login`, `/offline`, `/today` | One thumb in a moving vehicle, or a login card. Same palette, type and radii; **no chrome at all**. |

`/` is a redirect router that renders nothing, so it sits outside both groups.

The map is no longer "the uncontested hero." It is the spatial *view* of records that
also have board, table and schedule views. Design the record first; the map renders it.

## Visual thesis `CHANGED`

**مریدین — a cool, quiet workbench, lit from the north.**

The MVP called this "a precise, information-dense operations console that reads as
instrument panel." That was built and shipped and is exactly what got rejected: three
successive redesigns handed back the same dark-navy-and-cyan console, because every one
of them was executed faithfully against the sentence above. A redesign that does not
replace the thesis cannot happen. This is the replacement.

The sales section is a **workbench**, not a cockpit. A cool blue-grey ground, white
surfaces lifted by real shadow, generous radii, and an **ocean** accent — calm and
exact where every other operations tool in the category shouts. Numbers stay tabular
and figures stay honest; what changes is that the app stops performing seriousness at
the reader and starts being comfortable to stand in front of for eight hours. The light
is daylight from the north — even, cool, never the warm slant of late afternoon.

> **What changed 2026-09.** This thesis shipped warm — a cream ground (`#F4F0E9`) and a
> terracotta accent. It was re-temperatured to cold: cool ground (`#F1F3F6`), ocean the
> default accent. The devices, the light-default, and the anti-cockpit stance are
> unchanged — the rejected thesis was a *dark* console, and this stays light.

**Light is the default and the identity.** This inverts the MVP. The people who use
`/sales` are standing in a shop in daylight with a phone, or at a desk; a near-black
screen is worst exactly where the work happens. Dark is a first-class equal — same
tokens, own palette, own contrast budget, its own gradient mixes — and it is what the
app looks like at night. The map **canvas** keeps its own dark identity whatever skin is
chosen — two thousand lines of map chrome are tuned for a near-black ground — but the
header above it and the design tokens are unified across it. That is one attribute,
`[data-surface="map"]`, on one route.

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

Cool and physical. Surfaces lift toward the pointer on a soft spring rather than
snapping; a dragged card tilts and casts a real shadow; a state change is announced by
the island rather than by a colour quietly changing under the reader.

Two rules keep it from becoming a toy. **Choreography over animation** — twenty elements
entering in sequence reads as expensive, a hundred springing independently reads as
cheap. And **the stagger is capped**: past ten items a sequence stops reading as rhythm
and starts reading as lag, so item eleven onward shares item ten's delay.

Everything degrades cleanly under `prefers-reduced-motion`: the entrance becomes an
immediate paint, not a slow one.

**Two motion layers, one set of values.** The entrance choreography (RevealRoute,
RouteFade) is pure CSS and stays that way — it is deterministic, fires on every
navigation, and needs no JavaScript to be correct. Interactive motion added since
(the nav popover, the help panel) uses `framer-motion`, with `lib/motion.ts` restating
the curves and durations above in its units so nothing hand-rolls a value. A change to
the tables above is a change in both places. The two layers now also share a duration:
`--dur-panel` (400ms) is read by the framer panels as `DUR.panel` and by the CSS chrome
as a custom property, which is what makes the nav's popover and its sliding bar feel
like one motion system rather than two that happen to share a header.

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
- **The map follows its basemap, not the skin.** The two used to be the same thing. With
  a basemap catalogue holding both near-black and cream styles they are not: each basemap
  declares a `ground` (`dark`/`light`), and that — not `data-theme` — decides the district
  strokes (`MAP_INK`), the zone rings, the corridor band, the cluster bubbles and the
  names overlay. Choosing a cream basemap on the dark skin lightens the map's ink and
  leaves the surrounding UI alone. Status hues (`--good`/`--warn`/`--crit`) never move:
  they mean the same thing on `/report`, and only their opacity is tuned per ground.

## Color `CHANGED` — HeroUI token names

Same semantic roles in both themes; different values. Status meaning never moves.
Every figure below is computed, not eyeballed — see `scripts/check-contrast.mjs`.

**The token names are HeroUI's (2026-10-24, `docs/roadmap.md` 10.1).** Inside `.meridian` the
values are written under HeroUI's names — `--background`, `--foreground`, `--surface`,
`--surface-secondary`, `--surface-tertiary`, `--muted`, `--accent-foreground`, `--success`,
`--warning`, `--danger` and their `-soft` fills — so HeroUI's own parts and ours read one
palette. The older names in the second column are `var()` aliases of them, defined once in
the "HeroUI tokens, and the older names as aliases" block of `app/globals.css`; they exist so
rules written before HeroUI keep resolving. **New rules use the HeroUI name.** That block also
restates HeroUI's calculated tokens (hover, soft and focus mixes, `--default`, `--field-*`,
`--overlay`, `--separator`, `--surface-shadow`) from this palette, because HeroUI declares them
on `:root`, where they would mix the default violet-grey rather than the chosen theme.

The map (outside `.meridian`) still reads its own `:root` palette under the older names.

### Light (default)

| Token | Hex | vs `--bg` | vs `--surface` | Role |
|---|---|---|---|---|
| `--background` (`--bg`) | `#F1F3F6` | — | — | Cool ground. Never pure white, never warm. |
| `--surface` (`--card`) | `#FFFFFF` | — | — | Cards lift *off* the ground |
| `--surface-secondary` (`--surface-2`, `--card-2`) | `#F8FAFC` | — | — | Inset rows, quiet fills |
| `--surface-tertiary` (`--surface-sunk`, `--sunk`) — also `--default` | `#E8ECF1` | — | — | Tab trough, progress track |
| `--border` (`--line`) — also `--separator` | `#E0E5EC` | — | — | Hairlines |
| `--border-strong` | `#CDD4DE` | — | — | Emphasized borders |
| `--foreground` (`--text`, `--ink`) | `#1A1F26` | 14.90 | 16.56 | Primary text |
| `--muted` (`--text-muted`) | `#5C6672` | 5.25 | 5.84 | Secondary text |
| `--text-faint` | `#656E7B` | 4.63 | 5.16 | Readable; close to `--text-muted` by design (was `#828A98`, 3.1:1, which failed for the 150+ labels that used it) |
| `--accent` | `#0077BC` | 4.33 | 4.81 | Ocean. **Fills only** |
| `--accent-text` | `#006EAE` | 4.92 | 5.47 | Accent *as text* — links, amounts due |
| `--accent-foreground` (`--accent-ink`) | `#FFFFFF` | 4.81 on accent | — | Text on an accent fill |
| `--success` (`--good`) | `#4F6B4A` | 5.34 | 5.94 | تحویل‌شده / پرداخت‌شده |
| `--warning` (`--warn`) | `#7A5409` | 6.09 | 6.78 | تأییدشده / بخشی |
| `--danger` (`--crit`) | `#A11B3F` | 6.88 | 7.65 | بدهی بحرانی / لغوشده |
| `--info` | `#2E6382` | 5.86 | 6.52 | در مسیر |
| `--tint-plum` | `#6B4FA0` | 5.81 | 6.46 | Avatar tint only — carries no status |

### Dark

| Token | Hex | vs `--bg` | vs `--surface` | Note |
|---|---|---|---|---|
| `--background` (`--bg`) | `#0F1214` | — | — | Cool near-black, **not** the map's blue-black |
| `--surface` (`--card`) | `#171B20` | — | — | |
| `--surface-secondary` (`--surface-2`, `--card-2`) | `#1D2228` | — | — | |
| `--surface-tertiary` (`--surface-sunk`, `--sunk`) — also `--default` | `#232A31` | — | — | |
| `--border` (`--line`) — also `--separator` | `#28323A` | — | — | |
| `--border-strong` | `#37414A` | — | — | |
| `--foreground` (`--text`, `--ink`) | `#EDF1F5` | 16.56 | 15.21 | |
| `--muted` (`--text-muted`) | `#8B98A5` | 6.39 | 5.86 | |
| `--text-faint` | `#828C97` | 5.50 | 5.05 | Clears text here; light's cannot |
| `--accent` | `#3BA6F5` | 7.13 | 6.54 | Lifted — light's ocean is muddy on black |
| `--accent-text` | `#46A6EF` | 7.13 | 6.54 | Near-same value; dark needs no split |
| `--accent-foreground` (`--accent-ink`) | `#030E19` | 7.36 on accent | — | **Near-black, not white** |
| `--success` (`--good`) | `#93C289` | 9.24 | 8.48 | |
| `--warning` (`--warn`) | `#E0A64A` | 8.70 | 7.99 | |
| `--danger` (`--crit`) | `#F2789B` | 7.10 | 6.52 | |
| `--info` | `#83B9DC` | 8.90 | 8.17 | |
| `--tint-plum` | `#B79EEA` | 8.14 | 7.47 | |

Four findings from computing this table rather than trusting the prototype:

- **`--text-faint` is now text-safe in light (2026-10).** It was `#828A98`, 3.1:1 and documented
  as non-text only, yet 150+ readable labels used it and failed. It is now `#656E7B` (4.63 on
  the ground). The price is that faint and `--text-muted` sit close together; muted stays the
  darker of the pair. Axe on the live pages is the arbiter, not this table.
- **The accent still needs a text variant in light and not in dark.** `#0077BC` is a
  fine fill (white on it clears 4.81) but only ~4.33 as text on the cool ground.
  `--accent-text` (`#006EAE`) darkens it until it passes. Dark's `#3BA6F5` clears both
  as text and fill, so there the split exists in the API, not in the palette.
- **`--accent-ink` does not invert.** White on light's ocean clears 4.81; white on
  dark's lifted `#3BA6F5` fails. Dark's button ink is near-black `#030E19` (7.36). Same
  trap the MVP hit with cyan, opposite direction.
- **`--crit` returned toward true red.** Against the warm terracotta it had to be a
  crimson (hue-separated from an orange-red accent). With an **ocean** accent the ΔE to
  a red `--crit` is large by hue alone, so the crimson is kept for continuity rather
  than necessity — `#A11B3F` light, `#F2789B` dark, both well clear of the blue accent
  under every simulated colour-vision deficiency.

Rules that hold in both themes:

- **A color means one thing.** `--accent` is interaction and never status; status colors
  are never borrowed for chrome; `--tint-plum` and its siblings are avatar identity and
  are neither.
- **Color is never the only signal.** The Persian status word sits beside every dot, and
  the pipeline column a card sits in says its status independently of any colour.
- **Status fills** (dots, pills) are non-text and answer to 3:1 against the surface they
  sit on, verified per pair — a soft-tinted pill's text answers to 4.5 against the pill,
  not against the page.

### Accent themes `SHIPPED`

The accent is **chosen by the reader**, from ten themes. The ocean (اقیانوسی) above is
the default; خاکی (the old warm terracotta) stays in the set, pinned to its shipped
hexes; the rest are solved, not picked by eye. `themes[0]` in
`scripts/gen-accent-themes.mjs` is the default — reorder to change it.

| | |
|---|---|
| Themes | اقیانوسی (default), خاکی, طلایی, زیتونی, زمردی, فیروزه‌ای, نیلی, بنفش, تمشکی, گرافیت |
| Stored as | `coverage-accent` in localStorage, applied as `data-accent` on `<html>` before first paint |
| Generated by | `scripts/gen-accent-themes.mjs` → a marked block in `app/globals.css` and `lib/accentThemes.ts` |
| Verified by | `npm run check:contrast` — 500 pairs, every theme, every skin |

Rules:

- **A theme chooses a hue and nothing else.** Every other value — the ink on the fill, the
  accent as text on two grounds, the soft pill under that text, the wash, the map ink — is
  searched for in OKLCH against the real grounds until it clears its gate. That is what
  keeps ten themes looking like one system instead of ten.
- **Status colors are never themed.** Green means visited, amber means needs coverage, red
  means keep out, and those three are shared with `/report` and `/analytics`. When an
  accent hue lands on a status color the **accent** moves, by at most 18°, never the
  status color. تمشکی is at hue 336 rather than its true 8 for exactly this reason: hue 8
  is `--crit`, and a brand color that is also the danger color is not a theme, it is a bug.
  مسی was asked for and does not exist — `--warn` sits between خاکی and طلایی, so every
  copper hue is within 0.048 of the terracotta it would sit next to in the picker.
- **The theme reaches the map, not just the chrome.** `--map-stroke-major`,
  `--map-stroke-minor`, `--map-boundary`, `--map-selected` and `--map-unknown` are part of
  every theme. `--map-unknown` matters most: it is the fill for 429 of 439 districts, so it
  is what the map mostly *is*, so it takes the theme's hue rather than sitting neutral.
- **Map ink follows the basemap's ground, not the skin.** Selected by
  `[data-ground="..."]`, because a cream basemap needs dark strokes on a dark skin.
- **The map reads these tokens through `getComputedStyle`, not `var()`.** Leaflet paints
  districts onto a canvas where `var()` does not resolve and a path would silently draw
  black. Ten themes × two skins × two grounds is forty palettes; duplicating them in
  TypeScript would guarantee drift, so there is one definition and it is read at the point
  of use — re-read whenever the accent, the skin or the ground changes.

## Elevation `CHANGED`

One API, two implementations — the MVP's structure survives; its values do not.

| Token | Meaning | Light | Dark |
|---|---|---|---|
| `--sh-1` | Resting card, list row | `0 1px 2px rgba(30,41,59,.05), 0 4px 14px -6px rgba(30,41,59,.10)` | `0 1px 2px rgba(0,0,0,.5), 0 4px 14px -6px rgba(0,0,0,.6)` |
| `--sh-2` | Hover lift, dropdown | `0 2px 5px rgba(30,41,59,.06), 0 14px 34px -12px rgba(30,41,59,.17)` | `0 2px 5px rgba(0,0,0,.55), 0 14px 34px -12px rgba(0,0,0,.7)` |
| `--sh-3` | Modal, island, bottom sheet | `0 4px 10px rgba(30,41,59,.07), 0 28px 60px -18px rgba(30,41,59,.28)` | `0 4px 10px rgba(0,0,0,.6), 0 28px 60px -18px rgba(0,0,0,.8)` |
| `--sh-lift` | Fanned document, drag ghost | `0 10px 22px -8px rgba(30,41,59,.24), 0 30px 60px -24px rgba(30,41,59,.30)` | as `--sh-3` |

Two changes of substance:

- **Light shadows are tinted cool** (`rgba(30,41,59,…)`), matching the ground's hue.
  A neutral-black shadow on the cool ground reads as grime; a cool-tinted one reads as
  depth.
- **Borders are no longer part of elevation.** The MVP's `--elev-1` was a 1px ring; here
  a resting card carries shadow only, and `--border` is reserved for genuine dividers.
  A card that has both a hairline and a shadow reads as two competing edges.

**HeroUI's shadows are these.** `--surface-shadow` is `--sh-1` and `--overlay-shadow` is
`--sh-3` inside `.meridian`, so a HeroUI card, popover or drawer lifts the same way ours do.

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

**One scale, two names.** The map's chrome was written against a second, tighter scale
(`--radius-sm/md/lg` at 4/6/10px) that predates this table. Two live scales is the reason
every surface reads as "a slightly different rounded rectangle" — the eye cannot name it,
which is exactly what sameness feels like. `--r-*` is the canonical scale and `--radius-*`
now **aliases** it inside `.meridian`, so a rule may use whichever name reads better at the
call site without the two drifting apart again. Both spellings resolve to the same numbers.

**HeroUI parts keep HeroUI's radius.** Its `--radius` (0.5rem) and `--field-radius` (12px,
the same as `--radius-md`) are left as shipped: buttons, chips and tabs are fully rounded
there too, and fields land on our `--radius-md`. Answer cards (`.tf-opt`), day chips and
keypad keys keep `--r-md` / `--r-lg`, because they are cards a thumb lands on, not pills.

**Corners are superellipses, at 1.5.** `corner-shape: superellipse(1.5)` is applied to every
surface above `--radius-sm` (chips and pills keep true circles — a squircle on a 999px radius is
invisible). A circular arc meets its neighbour at a visible corner discontinuity; the
superellipse has continuous curvature there, which is the difference between a rectangle
that was *rounded* and one that was *drawn*.

**The exponent is not a "how gentle" dial — it runs the other way.** Measured by rendering
corners in Chromium 151 and integrating the corner's area against a true circle:

| exponent | corner area | what it looks like |
|---|---|---|
| `0.6` | 0.878× | **concave — scoops the corner inward** |
| `1.0` | 1.000× | circular |
| **`1.5`** | **1.110×** | **a squircle; what we ship** |
| `2.0` | 1.181× | square-leaning |

This block previously shipped `0.6` believing it was the mild end of the range. It was denting
every corner inward, and because browsers without `corner-shape` were drawing a plain arc anyway,
nobody could name the difference. If you tune this number, measure it — do not reason about the
sign.

`border-radius` remains the base and the property is gated behind `@supports`. Browsers without
`corner-shape` are not left on plain arcs: `components/meridian/SquircleFallback.tsx` draws the
same corner with a `clip-path` fitted to this exponent (`lib/squircle.ts`), so every user gets the
same shape. `?force=1` on any URL forces that fallback on, so it is inspectable in Chromium too.

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
| `--ease-glide` | `cubic-bezier(0.25, 0.8, 0.3, 1)` | Long travel, no overshoot. The auto-hiding chrome, which crosses 64px. |

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
| `--dur-panel` | 400ms | Nav popover, card help panel, auto-hiding chrome |
| `--stagger-tight` | 20ms | Table rows |
| `--stagger-base` | 40ms | Board cards, list items |
| `--stagger-loose` | 60ms | Bento tiles, sidebar sections |
| `--pulse-duration` | 2400ms | Marker radar-ping loop |
| `--pulse-stagger` | 800ms | Delay between ping rings |
| `--sweep-duration` | 4000ms | Ambient radar sweep |
| `--drift-duration` | 12000ms | Gradient wash drift |

**One duration, curve by distance.** The nav popover, the card help panel and the
auto-hiding chrome all travel for `--dur-panel`. They do *not* share a curve, because
overshoot is a function of travel rather than of the curve: `--spring-pop`'s ~13% peak
is a 1px overshoot on the panels' 10px rise and a 6px rebound on the chrome's 64px
slide. So the panels use `--spring-pop` and the chrome uses `--ease-glide`, and the
shared value is the duration only. A dismissal is the exception in the other
direction — the panel's *exit* is `--ease-out` at 200ms, because a dismissal that
overshoots reads as a panel that has not left yet. The chrome is the element that
makes the rule necessary: at `--ease-out` it covered 89% of its travel in the first
100ms, so a 320ms transition felt like a snap followed by dead time. Lengthening a
front-loaded curve fixes nothing; the curve was the problem.

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

**Scroll-driven entrances (Tier 2b) `NEW`.** Content that arrives by scrolling gets its
entrance from the scroll position itself, via `animation-timeline: view()`. The element
plays as it crosses the viewport rather than on a clock, so a card never finishes
animating before the reader has arrived to see it do so.

Two properties are deliberate, and both are the difference between this reading as
considered and reading as a toy:

- **The range is `entry`, and only `entry`.** The reveal completes as the element comes
  in and then holds its finished state for the rest of the scroll, in **both**
  directions. An earlier draft used `animation-range: entry 0% cover 30%`, on the
  reasoning that a bounded range would not reverse. It does: `cover` still spans the
  element's whole time in the viewport, so scrolling back up walked the timeline in
  reverse and the card un-revealed — measured at opacity 0.46 and 0 on the return to
  the top. `entry` with `animation-fill-mode: both` is what actually makes the
  finished state sticky, and that is the whole reason this effect can be trusted.
- **The stagger is positional, not timed.** `sibling-index()` derives each card's delay
  from where it sits among its siblings, so the cascade is correct at any list length and
  needs no per-item delay in the markup. Delays are additionally clamped
  (`min(sibling-index() * var(--stagger-base), 240ms)`) so a 30-row table cannot make its
  last row wait two seconds — see the cap note below.

**A note on the old cap, since it is now relaxed.** This section previously read: *"A
stagger that runs past ~8 items stops reading as choreography and starts reading as lag.
Every stagger in this system is capped, and past the cap the remainder appears together."*
That cap is **raised, not removed**, and the reason is specific rather than sentimental: a
stagger measured in *wall-clock time* compounds against the reader's patience, because the
last item's arrival is a fixed number of seconds after the first whether or not anyone is
still watching. A stagger derived from `sibling-index()` and clamped to 240ms cannot exceed
that ceiling at any list length, so the pathology the cap was invented to prevent is
prevented by construction. Long cascades are now allowed to *look* long without becoming
*slow*.

**Support, and what happens without it.** `sibling-index()` (Baseline August 2026),
`animation-timeline: view()` (not Baseline — no Firefox yet) and `corner-shape` are all
progressively enhanced inside `@supports`, with the existing time-based entrance as the
fallback. Firefox keeps the shipped Tier 0/2 behaviour and loses only the scroll-driven
refinement. **This is the first `@supports` in the codebase and the pattern is now
expected: any modern visual property added here is gated, because a design that only
exists in one engine is a design that does not exist for a third of the people using it.**

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
  `--ease-out`, short durations, and no ambient loops. **One named exception:** the
  shell header's nav popover, which is reachable while driver mode is active (the class
  is set on `<html>` by `CoverageMap`, and `/map` is a shell page) but is chrome the
  driver reaches only by scrolling up off the map. The map itself — markers, controls,
  the bottom bar — keeps every rule on this list. The exception is the header popover by
  name, not "the shell", and it is not a precedent for overshooting anywhere else.
- **Anything the user is waiting on.** A spinner, a saving state, a pending request. Added
  duration on a blocking transition is added latency, whatever the curve.

### Reduced motion

`prefers-reduced-motion: reduce` collapses all four tiers: springs become `--ease-out`,
staggers become simultaneous, ambient loops stop, morphs become cross-fades, count-ups
and chart draws render at their final value immediately. The app must remain fully usable
and must not lose any information that motion was carrying.

**Scroll timelines need their own rule, and the global block cannot do it.** The existing
`animation-duration: 0.01ms !important` sweep works by shortening a *time*-based animation
to nothing. A `view()`-timeline animation has no duration to shorten — its progress comes
from scroll offset, so zeroing the duration changes nothing and the reveal keeps running for
exactly the readers it must not run for. Tier 2b is therefore disabled explicitly:
`animation-timeline: auto` plus `animation: none`, landing every element on its final state.
Any future scroll-driven work must add its own line here, or it will ship a
reduced-motion regression that the global sweep reports as green.

Still forbidden regardless of tier: animating `width`/`height`/`top`/`left` (transform and
opacity only -- the island morphs via `transform: scale` and a clip, never box
dimensions), and scroll-driven parallax. **Parallax stays banned; scroll-linked *entrances*
do not.** The distinction is whether the reader's scroll position is being *used* to move
something relative to the page (parallax — the page's motion is hijacked) or merely to
decide *when* an entrance plays (Tier 2b — the page still scrolls at the speed and distance
the reader asked for). One is a motion-sickness trigger; the other is an animation.

---

## Base components `SHIPPED` — HeroUI

The base parts are HeroUI 3 (`@heroui/react`, React Aria underneath), themed by the tokens
above. Each part's stylesheet is imported one by one at the top of `app/globals.css`; add a
part's sheet in the same change that first uses it. What we use, and where it lives:

| Need | HeroUI part | Our wrapper / note |
|---|---|---|
| Button, icon button | `Button` | 44 px floor, 52 px for `size="lg"` (rule in `globals.css`, held by `tests/heroui-setup.test.ts`) |
| Answer in a flow, picker or deck | `Button` / `ToggleButton` | `components/tapflow/Answer.tsx` (`AnswerButton`, `SkipButton`, `AnswerSearch`) |
| Search above a list | `SearchField` | `AnswerSearch`; 52 px, 16 px type |
| Text field | `TextField`, `Input`, `InputGroup` | |
| Sheet / overlay | `Drawer` | `components/mobile/BottomSheet.tsx`; never a hand-rolled modal |
| Toast with undo | `Toast` | |
| Day / date | `Calendar` (Shamsi) | `PersianCalendar` in `components/PersianDateField.tsx`; day chips first (`DayChips`, `ToggleButton`s) |
| Tabs that are pages | `Tabs` with links | `components/RouteTabs.tsx` |
| Status word | `Chip` | `StatusPill` |
| Avatar, skeleton, empty state, disclosure | `Avatar`, `Skeleton`, `EmptyState`, `Disclosure` | |
| Report table, pager | HeroUI's `table` / `pagination` classes | `AcctTable`, `Pager`: server pages with real links, so only the classes |
| Pocket card face and papers | `Card` (transparent and secondary) | `PocketCard`; our `.card` rule skips `.face` and `.doc`; the fan and the frosted face are ours |
| Checkbox, switch, alert, popover | as named | |
| (?) help beside a component | `Popover` | `components/meridian/HelpHint.tsx` (a Popover, not a Tooltip: tooltips never open on touch); `HelpRow` puts it on its own row |
| Saving button | `Spinner` | `BusyIcon` swaps the button's icon while it works |
| Progress | `ProgressBar` | `FlowProgress` (tap flows), `leadImport/ProgressBar` |
| Applied filter | `TagGroup` / `Tag` | `ActiveTags`: removable tags under the filter chips |
| Keyboard key | `Kbd` | shortcut help, search slot |
| Long list of answers | `ListBox` | `AnswerList` (in `Answer.tsx`); `SmartPicker` is the sheet select / combo box with search |
| Sortable client table | `Table` | `MarginTable` (reports stay server pages) |

Still ours, styled with the HeroUI token names: `Keypad`, `SwipeRow`, the phone bottom bar,
`FilterChips`, the signature cards below, the charts, and the map markers.

- **Map marker** — 14px diamond, status fill, 2px `--bg` ring, status glow, idle ping.
- **Facility marker** — `--facility`, distinguished by silhouette before color:
  warehouse a filled hexagon (26×29, center-anchored, crate knocked out); home base a
  hollow house (24×26, base-anchored). Both static — the ping belongs to live readings,
  and a building is not one. Drawn above the cluster layer.
- **Skeleton** — matches the shape of what is loading. A page never shows a spinner; the HeroUI `Spinner` appears only inside a button the person just tapped (`BusyIcon`).

## CRM / ERP patterns `SHIPPED`

The vocabulary the redesign adds. Each exists to serve a specific record in the schema.
Most are now built and in `components/meridian/` or `components/sales/`; a subsection
still marked `TARGET` is the spec ahead of its code.

### Document pocket card `SHIPPED` — `components/meridian/PocketCard.tsx` (+ `Pocketed`, `OrdersPockets`)
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

### Carved bay card `SHIPPED` — `components/meridian/CarvedCard.tsx`
A rounded rectangle **subtracted** from a card's top inline-start corner, leaving a
stepped edge with a rounded inner corner. The avatars of the people on the record sit in
the bay it opens. Cut with `clip-path: path()` computed from the card's measured size —
a mask sized in percentages stretches the corner radii as the card grows — recomputed on
`ResizeObserver`, and dropped entirely below 360px.

The avatars must live in a **sibling** of the carved element. `clip-path` and `mask` clip
descendants too, so avatars placed inside the card are erased by the very bay meant to
hold them.

### Travelling tab pill `SHIPPED` — `components/meridian/HoverPill.tsx`
One pill that slides and resizes to the selected group, `--spring-pop`. It is positioned
before its transition is enabled, so it does not fly in from x=0 on first paint, and it
re-measures on `ResizeObserver` and on `document.fonts.ready`.

It used to be **two** permanent rows: the groups, then the active group's tabs. It is now
one row of group chips beside the brand, and a group's tabs arrive in a popover on hover
— twenty-odd destinations for one row of chrome instead of two. The popover is
`position: fixed`, placed from the chip's measured rect, because the row is a horizontal
scroll container and would otherwise clip it.

Reachability without hover is deliberate and lives elsewhere: the page-overview card
carries the active group's siblings inline, so a touch or keyboard reader never needs the
popover to move between neighbours. On a touch screen the first tap opens the group
rather than jumping to its first tab.

### Order pipeline `SHIPPED` — `components/sales/OrderPipeline.tsx`
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

### Processing modal `SHIPPED` — `components/sales/ProcessingModal.tsx`
Opened by tapping a pipeline card. Creator (read-only), assignee as avatar chips, and a
**range slider for the amount collected** against the order total, with هیچ / نصف /
تسویهٔ کامل shortcuts. The filled part of the track is painted by hand as a linear
gradient — a range input offers no pseudo-element for it — and the input takes
`direction: rtl` so it fills from the right.

### Order journey `SHIPPED` — `/sales/journey`
Swimlanes for the order lifecycle: ثبت سفارش → تأیید و قیمت‌گذاری → بارگیری و مسیر →
تحویل و تسویه. Each lane holds task nodes with the responsible person's avatar and a tick
that toggles. Lanes are joined by a dotted connector that points along the reading
direction.

### Gradient stat card `SHIPPED` — `components/meridian/GradientStat.tsx`
The dashboard's headline figures on soft multi-stop mesh gradients, mixed **cool** so
they sit in the same room as the accent rather than arriving from a different palette.
Dark carries its own mixes — the light pastels glare on a dark ground.

### Spline chart `SHIPPED` — `components/meridian/SalesSpark.tsx`
Catmull-Rom through the points converted to cubic béziers, an area fill under the current
series, the comparison series as a dotted line, and a tooltip that follows the nearest
point. In RTL **the oldest day sits on the right**.

### Notification island `RETIRED`
Toasts are HeroUI's `Toast` now, and the island's styles were removed with the other dead
rules in phase 6 of the HeroUI move. The `width`/`height` exemption under Motion no longer
has a user.

### Bento detail strip `SHIPPED`
Unchanged in structure; re-skinned. On phones it is the bottom sheet, which is now also
the customer detail view opened by tapping a pocket card.

### Route board `SHIPPED` — `components/sales/OrderRouteBoard.tsx`
It was described here as replaced by **Order pipeline**, which was wrong: both exist on the same
`sales/schedule?view=runs` surface. It has since been rewritten rather than patched — the old
`AssignmentBoard` is deleted and this replaces it, so there is one board instead of two.

The drag is no longer hand-rolled: it calls `components/board/useCardDrag`, the engine
`/leads` already uses, so the travel threshold and the mid-drag reflow handling are shared rather
than duplicated. Lanes are driver-**day** pairs. `LeadsMap` supplies the map, fed the same array
the cards render from, and `lib/repo/dayPlan.commitDaySplit` is what makes **«پیشنهاد بده»**
write: it creates the runs a proposal needs and loads every lane in one transaction, so a
30-order split cannot half-apply. See
`docs/superpowers/specs/2026-10-03-mixed-route-day-planning-design.md`.

## Icons `SHIPPED` — one library, reached one way

**Lucide, and only Lucide.** Every glyph comes from `lucide-react` through
`components/meridian/icon-map.ts` and is rendered by `components/meridian/Icon`. This file
once left the choice open and named Phosphor as the candidate, while the app had
already shipped Lucide everywhere. The reason it is kept is worth recording, because
the open question was not merely stale:

**Lucide is stroke-only and monochrome.** Every glyph is an outline that inherits
`currentColor` and takes its colour from CSS. That is exactly the rule this file already
states for icons, so Lucide complies with the system rather than negotiating with it.
Phosphor — the alternative considered — is defined by its duotone and fill weights, which
would either have broken the monochrome rule in several places, or meant using only its thin
outline set, which is what Lucide already is. Settled, and not to be reopened by a later
redesign.

**The rules.**

- **Never import `lucide-react` in a feature file.** Add a name to `ICONS` in
  `icon-map.ts`, render it with `<Icon>`. A direct import is how stroke width and pixel size
  drift back in, which is the entire reason the wrapper exists.
- **Every action button carries an icon.** Icon first, then the label, reading
  right-to-left in this RTL app.
- **Icon + label on anything whose meaning is not obvious from the glyph.** Add, delete,
  edit, print, export, filter — these get both.
- **Icon-only only where a label genuinely will not fit**, and never without an accessible
  name: `<Icon name="trash" label="حذف" />`. An icon-only button with no `label` is invisible
  to a screen reader.
- **Size is a token, never raw pixels.** `sm` / `md` / `lg` from `IconSize`.
- **`filled` is a state, not a colour knob.** It marks an on/off glyph (a rated star, a
  pinned marker). The icon stays one ink either way.
- **No emoji as an icon, ever.** An emoji is a coloured picture from a font you do not
  control: it renders in the vendor's palette (Apple's bell is amber, Noto's is brown),
  ignores `color`, ignores stroke weight, and changes shape between the reader's phone and
  their desktop. One emoji in a panel is enough to make an otherwise monochrome interface
  look assembled from parts.

`tests/icon-rule.test.ts` enforces the first and last of these mechanically and fails on a
stale `MASTER.md`, so a glyph added straight to a feature file fails the suite the day it
lands.

## Anti-patterns

- No purple/pink AI-gradient anything. (Warm mesh gradients are specified above and are
  not this: they are warm, low-contrast, and carry a figure.)
- No emoji as icon.
- No token defined in only one theme block.
- No component that branches on theme in JS.
- No `--accent` carrying status, no status color carrying interaction.
- No color as the only signal.
- **Prefer `--text-muted` for anything a reader must read**; `--text-faint` clears 4.5:1 now but only just. Status colours as text come from `--good/--warn/--crit` (or `STATUS_TEXT`), never the map's fill hex.
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
Decided since: the map's tile sets are hosted styles, not CSS filters. «رادار» is CARTO
Dark Matter drawn as vector through MapLibre — the pre-redesign basemap itself rather than
an inversion of a light one, which is what made every filtered attempt look wrong. A CSS
tone survives only as the no-WebGL fallback. See `lib/mapLayers.ts`.
