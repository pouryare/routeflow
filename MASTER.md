# MASTER — RouteFlow Design System

Canonical source of truth. Every color, font, spacing, radius, elevation and motion
value in the app comes from this file. No magic numbers in components.

> **2026-09-08.** This document's *rules* were superseded by direct user instruction —
> the notched, skeuomorphic, cool+black substrate described below is not derived from
> anything that came before it, and is not open to argument from an earlier version of
> this file. It is kept up to date as a description of the app's actual design system,
> not as a source of constraints competing with new instructions. See
> `docs/superpowers/specs/2026-09-08-notched-skeuomorphic-substrate-design.md` and
> `docs/superpowers/plans/2026-09-08-notched-skeuomorphic-substrate.md`.

**Status markers.** `SHIPPED` in the app now · `TARGET` agreed, not yet built ·
`CHANGED` replaces the previous (کارگاه/warm-workshop) rule.

---

## Product shape

Read this before making a layout decision — it settles most of them.

| Surface | Routes | What it is |
|---|---|---|
| **CRM / ERP** (primary) | `/sales/*`, `/leads`, `/analytics`, `/report` | Order-to-cash, leads, stock, purchasing, commission. Dense records, boards, tables, charts. |
| **Field** | `/driver`, `/planner` | One thumb, in a moving vehicle. Big targets, minimal chrome. |
| **Map** | `/`, `/facilities`, `/gallery` | Spatial view of the same records. |
| **Admin** | `/admin/*`, `/login` | Low-traffic, plain. |

The substrate below reaches every route in this table **except the map's own tile
canvas** — the map's basemap declares its own ground (dark/light) and is out of scope for
this palette; the map's surrounding chrome (sidebar, panels, controls) is in scope like
everywhere else.

## Visual thesis `CHANGED`

**Machined — cut metal and white paper, not a warm workshop.**

The previous thesis was «کارگاه — a warm workshop»: cream ground, terracotta accent,
warmth as the differentiator. It is retired. The new ground is a cool neutral grey and
the surfaces on it are pure white cards that look **milled** — physically cut, lit from
above, with a bright inner edge where the cut catches the light and a soft shadow
underneath where it lifts off the ground. Primary actions are solid near-black pills.
Colour appears almost nowhere in the chrome; it is reserved for data and status, which is
what makes the data read.

**Light is the default and the identity.** No `data-theme` (and no stored preference)
means light. Dark is a first-class equal — same tokens, own palette, own contrast budget
— reachable by an explicit choice or by `auto` following the OS live. The map keeps its
own dark identity and is out of scope here.

Four devices carry the personality:

1. **Cards are notched.** A rounded rectangle is *subtracted* from a card's edge, leaving
   a stepped profile with a concave inner corner. Icons, avatar clusters and
   sub-navigation are seated in the bay that removal opens. See **Notch system** below.
2. **Surfaces are physical.** A bright 1px inner edge along the top, a layered soft
   shadow beneath, a fine directional grain across the face, and (where wired up) a
   specular highlight that tracks the pointer and a perspective tilt toward the cursor.
3. **Documents live in pockets.** An order is not a row; it is a card with its receipt
   and delivery note tucked behind it, peeking at rest and fanning out on hover. **This
   pattern is load-bearing brand identity and must never be diluted or removed** — see
   **Pocket patterns** below for its three live forms.
4. **Kit primitives are physical, not flat.** Pills everywhere (buttons, tabs, inputs,
   sliders), circular icon buttons, milled-edge highlights on interactive surfaces.

## Interaction thesis `CHANGED`

Physical and quiet by default, with tilt/glow reserved for surfaces that earn it.
Delegated pointer tracking, never per-card React state: one listener per container writes
`--mx`/`--my` custom properties onto whichever single element is under the pointer, so a
40-card board costs exactly one listener and one element's style write per frame,
regardless of board size.

- **Tilt + glow are desktop-only** (`hover: hover` and `pointer: fine`) and reserved for
  surfaces deliberately wired up via `TiltCard`/`GlowSurface` — not a blanket effect
  applied to every element automatically. `/driver` never opts in.
- **`prefers-reduced-motion` disables all of it** — both the CSS media query and the hook
  itself gate on it. This is an accessibility floor, not a house-style preference, and
  survives any future taste change.
- **RTL-correct by construction.** `--tilt-dir` flips `rotateY`'s sign so a card leans
  toward the cursor, never away from it, regardless of writing direction.

---

## Theme architecture `SHIPPED`

One token system, one API. Components never branch on theme — they consume
`var(--surface)`, `var(--text-muted)`, `var(--primary)` and get the right answer in
every state.

```css
:root { /* light — the default and the identity */ }
:root[data-theme="dark"] { /* dark — every token redefined, none inherited */ }
```

Rules:

- **Light is the default.** Bare `:root` is light. `:root[data-theme="dark"]` is dark.
- **Three stored states, not two:** `auto` (follows `prefers-color-scheme` live via
  `matchMedia`), `light`, `dark`. `auto` is the default when nothing is stored.
- **`/driver` never auto-follows.** A moving vehicle must not change theme because the OS
  flipped under the driver's thumb — it pins to the last explicit choice, defaulting dark
  if none exists. Every other route follows `auto` live.
- **Every token is redefined in the dark block.** None inherit. A token defined only in
  one block is a bug that shows up as an invisible element in the other.
- **`data-theme` is always written explicitly**, for both resolved values — several rules
  (`.elevate-*`, `.theme-toggle__*`, `.tiles-quiet`) key on `[data-theme="light"]` being
  *present*, not merely on the absence of `data-theme="dark"`.
- **`data-skin` mirrors `data-theme`**, written from the same place — the accent-theme
  generator's map-relevant dark variants (see below) still key on `data-skin="dark"` and
  have not been migrated; this keeps the two from drifting apart rather than fighting a
  second migration inside this one.
- **The toggle is a two-state sun/moon switch today** (`components/ThemeToggle.tsx`) —
  always resolves `auto` to a concrete value for display and writes an explicit choice on
  click, never `auto`. A three-state auto/light/dark control is deferred to the shell
  sub-project.
- **The map follows its basemap, not the skin** — unchanged from before this redesign.
  Each basemap declares a `ground` (`dark`/`light`) that decides district strokes, zone
  rings and cluster bubbles independent of `data-theme`.
- **`lib/design/resolveTheme`** is the one pure function this all runs through:
  `resolveTheme(stored, prefersLight, isDriverRoute) → "light" | "dark"`. Unit-tested,
  not re-derived per call site.

## Color `CHANGED`

Same semantic roles in both themes; different values. Status meaning never moves.
Every figure below is computed by `scripts/check-contrast.mjs`, not eyeballed.

### Light (default)

| Token | Hex | vs `--bg` | vs `--surface` | Role |
|---|---|---|---|---|
| `--bg` | `#ECEDEF` | — | — | Cool neutral ground. Never warm, never pure white. |
| `--surface` | `#FFFFFF` | — | — | Cards lift *off* the ground |
| `--surface-2` | `#F7F8F9` | — | — | Inset rows, quiet fills |
| `--surface-sunk` | `#E3E5E8` | — | — | Tab trough, progress track |
| `--border` | `#E2E4E8` | — | — | Hairlines |
| `--border-strong` | `#D2D6DC` | — | — | Emphasized borders |
| `--text` | `#16181D` | 15.16 | 17.76 | Primary text |
| `--text-muted` | `#5F6672` | ≥4.5 | ≥4.5 | Secondary text |
| `--text-faint` | `#7E8490` | 3.21 | 3.76 | **Non-text only** |
| `--primary` | `#101216` | — | — | Solid pill fill. The one loud chrome colour. |
| `--primary-ink` | `#FFFFFF` | 18.75 on primary | — | Text on a `--primary` fill |
| `--accent` | `#3D6FD9` | — | — | Data/links **only** — never a chrome fill |
| `--accent-text` | `#2F5FC4` | ≥4.5 | ≥4.5 | Accent *as text* |
| `--accent-ink` | `#FFFFFF` | — | — | Text on an `--accent` fill |
| `--good` | `#1F6B45` | ≥4.5 | ≥4.5 | تحویل‌شده / پرداخت‌شده |
| `--warn` | `#8A5A00` | ≥4.5 | ≥4.5 | تأییدشده / بخشی |
| `--crit` | `#A81D3A` | ≥4.5 | ≥4.5 | بدهی بحرانی / لغوشده |
| `--info` | `#2A5F80` | ≥4.5 | ≥4.5 | در مسیر |
| `--tint-plum` | `#6B4FA0` | ≥4.5 | ≥4.5 | Avatar tint only — carries no status |

### Dark

| Token | Hex | Note |
|---|---|---|
| `--bg` | `#101215` | Cool near-black, not the old warm-black |
| `--surface` | `#191C21` | |
| `--surface-2` | `#1F232A` | |
| `--surface-sunk` | `#0C0E11` | |
| `--border` | `#262B33` | |
| `--border-strong` | `#343A44` | |
| `--text` | `#E8EAEE` | |
| `--text-muted` | `#9BA3AF` | |
| `--text-faint` | `#6B7280` | Non-text only |
| `--primary` | `#F2F4F7` | Inverted — a light pill on a dark ground |
| `--primary-ink` | `#101216` | |
| `--accent` | `#6D96EC` | Data/links only, dark too |
| `--accent-text` | `#8FB0F2` | |
| `--accent-ink` | `#0B1220` | |
| `--good` | `#4BB07C` | |
| `--warn` | `#D9A23B` | |
| `--crit` | `#E8607F` | |
| `--info` | `#6BA8CE` | |
| `--tint-plum` | `#B79EEA` | Unchanged from light |

Rules that hold in both themes:

- **`--accent` is data/links only, never a chrome fill.** `--primary` is the one token
  for a primary-action pill. This split did not exist before this redesign — every
  button previously filled with `--accent`; 19 genuine primary-action buttons across
  `components/sales/` and `app/sales/admin/` were repointed, one at a time, judging each
  by whether it was an action or a piece of data/status (chart legends, calendar event
  dots, badge counters, the range-slider fill all correctly stayed on `--accent`, since
  that is now `--accent`'s actual role, not because they are "decorative").
- **A color means one thing.** Status colors are never borrowed for chrome; `--tint-plum`
  and its siblings are avatar identity and are neither status nor interaction.
- **Color is never the only signal.** The Persian status word sits beside every dot.
- **`--text-faint` never carries text a reader must read** — 3:1 only, non-text
  (placeholders, decorative separators, disabled day numbers).

### Accent themes `CHANGED` — retired for kargah, kept for the map

The reader-chosen accent-theme feature (ten hues, `scripts/gen-accent-themes.mjs`) now
serves **the map only**. Kargah's `--accent`/`--primary` and family are fixed — the
generator no longer emits a `.kargah`-scoped half on any of its rules, and a small guard
block at the true end of `app/globals.css` (`:root .kargah` / `:root[data-theme="dark"]
.kargah`, re-asserting the 8 tokens the generator can still reach) keeps a chosen map
accent from leaking into kargah even though both now live at the same `:root` scope.
Verified empirically with Playwright against the compiled CSS, not by hand-reasoning
about specificity — see the Task 11 commit for the method.

## Elevation `CHANGED`

| Token | Meaning | Light | Dark |
|---|---|---|---|
| `--sh-1` | Resting card, list row | `0 1px 2px rgba(24,28,38,.05), 0 4px 14px -6px rgba(24,28,38,.10)` | `0 1px 2px rgba(0,0,0,.30), 0 4px 14px -6px rgba(0,0,0,.45)` |
| `--sh-2` | Hover lift, dropdown | `0 2px 5px rgba(24,28,38,.06), 0 14px 34px -12px rgba(24,28,38,.16)` | `0 2px 5px rgba(0,0,0,.35), 0 14px 34px -12px rgba(0,0,0,.55)` |
| `--sh-3` | Modal, island, bottom sheet | `0 4px 10px rgba(24,28,38,.07), 0 28px 60px -18px rgba(24,28,38,.26)` | `0 4px 10px rgba(0,0,0,.40), 0 28px 60px -18px rgba(0,0,0,.65)` |
| `--sh-lift` | Fanned document, drag ghost | `0 10px 22px -8px rgba(24,28,38,.22), 0 30px 60px -24px rgba(24,28,38,.28)` | `0 10px 22px -8px rgba(0,0,0,.50), 0 30px 60px -24px rgba(0,0,0,.60)` |
| `--edge-hi` | Milled top inner highlight | `inset 0 1px 0 rgba(255,255,255,.92)` | `inset 0 1px 0 rgba(255,255,255,.06)` |
| `--edge-lo` | Milled bottom inner shade | `inset 0 -1px 0 rgba(24,28,38,.05)` | `inset 0 -1px 0 rgba(0,0,0,.30)` |
| `--card-drop` | `filter: drop-shadow` form, for clipped/notched shapes | `drop-shadow(0 1px 2px rgba(24,28,38,.07)) drop-shadow(0 12px 26px rgba(24,28,38,.13))` | `drop-shadow(0 1px 2px rgba(0,0,0,.4)) drop-shadow(0 14px 30px rgba(0,0,0,.55))` |

- **Shadows are cool-tinted in light** (`rgba(24,28,38,…)`), matching the ground's hue —
  a neutral-black shadow reads correctly here, unlike the old warm ground where it read
  as dirt were it *not* tinted.
- **`--edge-hi` is what makes a flat white card read as physically cut.** Near-invisible
  in dark — a bright inner edge on a dark surface reads as a rendering fault, not as
  light, so dark leans on the drop shadow alone.
- **A notched/clipped shape takes `filter: drop-shadow(...)`, never `box-shadow`** — see
  Notch system below. `--card-drop` is the drop-shadow form and exists for exactly this.
- **Hardcoded shadow literals are a real, recurring bug class.** Token-based retinting
  (editing `--sh-*`) cannot fix a raw `rgba(62,44,28,…)` written directly into a rule
  instead of routed through a token — three were found this way during verification
  (`.doc`, `.pocketed__slip`, `:root-scrim`, `.sheet`) and fixed. When adding a new
  shadow, always reference `--sh-*`/`--card-drop`; never hand-type an rgba shadow.

## Notch system `SHIPPED`

The core visual identity, not a decorative flourish on one component.

- **Geometry:** `lib/design/notch.ts`'s `notchedCardPath(w, h, opts)` — a path computed
  from the card's *measured* size (a percentage-based mask would stretch the corner radii
  as the card grows). `side`/`edge`/`dir` are explicit, so any surface in either writing
  direction can carve the same shape: `side` resolves "start"/"end" the way CSS logical
  properties do (inline-start is left under `ltr`, right under `rtl`).
- **The border problem, solved:** `clip-path` removes both `box-shadow` and `border` from
  a clipped element. `NotchedCard` (`components/kargah/NotchedCard.tsx`) solves both with
  a stacked layer technique — an absolutely-positioned `.notch-edge` sibling carrying the
  *same* clip-path, coloured as the border+highlight, inset 1px via a second nested clip
  so only a thin ring shows.
- **The shadow problem, solved:** `filter: var(--card-drop)` on the *outer* wrapper —
  never `box-shadow` on the clipped element itself.
- **Avatars/shoulder content are SIBLINGS of the clipped element, never descendants** —
  `clip-path` clips descendants too, so content placed inside would be erased by the very
  bay meant to hold it. `.notch-shoulder` (opposite `.notch-avatars`) needed its own
  positioning wrapper; a bare fragment renders unstyled.
- **`corner-shape` (the CSS property that would make concave corners a one-liner) is
  Chromium-only as of 2026 — not Baseline, no Safari/Firefox timeline.** `clip-path`
  remains the implementation; `corner-shape` is a future progressive enhancement only.
- **Recomputes on `ResizeObserver` and `document.fonts.ready`** — the card's height
  depends on Persian glyph metrics that move after the webfont lands.
- **Dropped entirely below the card's `minWidth`** — a notch wide enough to reach the far
  corner is not a bay, it is a shorter card, and the stepped edge stops reading.

## Typography `SHIPPED`

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

`font-variant-numeric: tabular-nums` is mandatory on any number in a column or animating.
Line-height 1.8 for Persian body. Unchanged from before this redesign — the type scale
was never warm/cool-coded and needed no retint.

## Spacing `SHIPPED`

Base 4px. `1` 4 · `2` 8 · `3` 12 · `4` 16 · `5` 20 · `6` 24 · `8` 32 · `12` 48.
Theme-independent — declared once in the light block; dark inherits it unchanged, since
`:root[data-theme="dark"]` is an *additional* rule matching the same element rather than
an isolated cascade scope, and undeclared properties simply fall through from `:root`.

## Radii `CHANGED`

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 9px | Badges, small chips |
| `--radius-md` | 12px | Dense rows, inputs, board cards |
| `--radius-lg` | 16px | Inner panels, list blocks |
| `--radius-xl` | 20px | Document cards, tiles |
| `--radius-2xl` | 28px | Cards, blocks, modals (bumped from 26px to match the video's larger card corners) |
| `--radius-pill` | 999px | Buttons, tabs, inputs, sliders, avatars — everything interactive |

**Every input, select, textarea-excepted, and button is a pill.** That single rule does
most of the visual work of matching the reference video.

## Motion `CHANGED`

### Curves and durations — unchanged, theme-independent

`--ease-out`, `--spring-snap`, `--spring-pop`, `--spring-drop`, `--dur-fast` through
`--dur-draw`, `--stagger-tight` through `--stagger-loose`, `--pulse-duration`,
`--pulse-stagger`, `--sweep-duration`, `--drift-duration` — all survive from before this
redesign unchanged, since none were ever warm/cool-coded. Declared once, theme-
independent, same reasoning as Spacing above.

### Tilt + glow `SHIPPED`

`lib/design/tilt.ts`'s `useTiltGlow` — one delegated `pointermove` listener per
container, writing `--mx`/`--my` to whichever `[data-tilt]`/`[data-glow]` descendant is
currently under the pointer. Never per-card React state.

- **`--tilt-max: 8deg`.** `rotateY`'s sign is `--tilt-dir` (`-1` default/rtl, `1` under
  `ltr`) so a card leans toward the cursor in either writing direction.
- **Glow is a radial gradient** on a `::after`, positioned from the same `--mx`/`--my`,
  `mix-blend-mode: plus-lighter`, tinted `var(--accent)` at low opacity.
- **Gated on `hover: hover` and `pointer: fine`** — no tilt/glow on touch, where there is
  no hover concept. **Gated on `prefers-reduced-motion`** at both the hook level (bails
  before attaching the listener) and the CSS level (`transform: none !important`).
- **`TiltCard`/`GlowSurface`** (`components/kargah/`) are the two consumer wrappers.
  Neither is wired into a real page yet — that lands with the shell/journey sub-project.

### Reduced motion

`prefers-reduced-motion: reduce` collapses everything: springs become instant, staggers
become simultaneous, ambient loops stop, tilt/glow disable entirely. This is an
accessibility floor and does not move with taste.

---

## Skeuomorphic system `SHIPPED`

The tactile surface language, alongside the notch system.

- **Milled edge** — `--edge-hi`/`--edge-lo` (see Elevation). Combine with `--sh-N` via
  `box-shadow`'s comma-separated list: `box-shadow: var(--edge-hi), var(--sh-2)`.
- **Directional noise** — `.noise-surface` utility class, a single inline SVG
  `feTurbulence` data-URI reused everywhere rather than per-surface (~400 bytes, no extra
  request). Sits on a `::before` at `z-index: -1` inside an isolated stacking context, 3.5%
  opacity, `mix-blend-mode: overlay` — verified via `check:contrast` to never affect text
  contrast. Already applied to `NotchedCard`'s `.notch-card`.
- **Glass** — `GlassFace` (`components/kargah/GlassFace.tsx`), `backdrop-filter:
  blur(16px) saturate(1.5)`, extracted from the pocket's frosted face. **Restricted to
  modal backdrops, the sticky header, and the pocket's own document face — never plain
  cards.** The reference video's cards are opaque white; "glass everywhere" was a
  misreading corrected during design. `backdrop-filter` is the single most expensive
  property in this system.
  - **`-webkit-backdrop-filter` must be written BEFORE the standard `backdrop-filter`,
    never after.** A documented, hard-won bug: reversed, a minifier treats the standard
    declaration as shadowed by the later prefixed one and drops it — leaving only the
    prefixed property, which Chromium rejects outright (not an alias there). The face
    then renders as flat translucent colour with no blur at all. Verify the order
    survives minification in the *compiled* output, not just source, before trusting it.

---

## Base components `SHIPPED`

- **`NotchedCard`** — see Notch system.
- **`TiltCard` / `GlowSurface`** — see Tilt + glow.
- **`GlassFace`** — see Skeuomorphic system.
- **`IconButton`** — circular, `--radius-pill`, `--edge-hi` + `--sh-1`.
- **`Field` / `Select` / `Textarea`** — pill inputs (textarea uses `--radius-lg`, a pill
  shape reads wrong on a multi-line box), `--edge-hi`, focus border → `--accent`.
- **`RangeSlider`** — genuinely interactive (draggable), generalizing
  `ProcessingModal`'s read-only fill meter. Same hard-stop two-color gradient fill syntax
  (`var(--accent) 0 X%, var(--surface-sunk) X% 100%)`), confirmed from the real
  implementation rather than invented. `direction: rtl` on the input so it fills from the
  right. `lib/design/rangeFill.ts`'s `fillPercent` is the pure math, shared with the
  original meter's role.
- **`SegmentedPill`** — generic sliding-pill segmented control, own `.seg-pill`/
  `.seg-thumb` class names (not `TabPill`'s `.seg`/`.thumb`, so the two coexist). Same
  transition-gating discipline as `TabPill`: the thumb is measured and placed at
  `width: 0` with no transition, THEN gets its transition enabled one animation frame
  later via a `.ready` class — omitting this animates the thumb flying in from nothing on
  first paint, a real bug the original `TabPill` comment already documents.
- **`ArcGauge`** — single-value SVG stroke-dasharray progress ring. Deliberately simpler
  than `DonutChart` (`lib/chartScale.ts`'s `donutArcs` is genuine multi-slice composition
  math, more than a single-value gauge needs).
- **`StatefulButton`** — idle → loading → success → idle. **Confirmed live in the
  reference video** on "Take for Processing" and "Add Case" — not speculative.
  `lib/design/statefulButton.ts`'s `nextButtonState` is the pure transition reducer.
- **`GooeyInput`** — SVG-filter (`feGaussianBlur` + `feColorMatrix`) search input,
  reimplemented from Aceternity's documented mechanism rather than pulled in as a
  dependency.
- **`AvatarStack`** (`components/AvatarStack.tsx`) — already had numeric badge support
  before this redesign touched it (`StackPerson.count?: number`, gated `count > 0`, not
  loose nullish-checking — a zero badge is worse than none, per its own comment). Left
  untouched; do not add a second, redundant badge field.
- **Status pill** — `--radius-sm`, mono `--text-xs` tracked, colored dot + 16% tinted
  fill, Persian word always present. Unchanged from before this redesign.
- **Skeleton** — matches the shape of what is loading. Never a spinner.

## Pocket patterns `SHIPPED` — the sacred device, in three live forms

**Never remove or dilute any of the three.** Verified intact task 2026-09-08 found the
spec's own first attempt at identifying "the" pocket pattern was wrong — there are three,
not one, and getting this wrong nearly meant protecting a dead component while missing a
live bug in the real one.

1. **`PocketCard`** (`components/kargah/PocketCard.tsx`, `.pocket`/`.docs`/`.doc`/
   `.face`/`.pill`) — LIVE, `/sales/orders` via `OrdersPockets.tsx`. An order card with
   its receipt and delivery note tucked behind it — the literal "two cards behind the
   main card." Own comment: *"the artifact's `.pocket`."*
2. **`Pocketed`** (`components/kargah/Pocketed.tsx`, `.pocketed`/`data-papers`/
   `.pocketed__slips`/`.pocketed__slip`/`.pocketed__face`) — LIVE, the board
   (`app/sales/board/page.tsx`) and order-pipeline (`app/sales/tasks/page.tsx`) pages.
   The deliberate generalization of #1: any card can sit in a pocket, `papers` 0–3 real
   attachments (never decoration), fan toggled per-consumer via `fan`. **This is the
   primitive future pocket extensions (product→batches, customer→orders+cheques,
   run→stops, saved-list→members) should build on.**
3. **`OrderPocketCard`** — DELETED 2026-09-08. Its `.pocket`/`.pocket__papers`/
   `.pocket__paper`/`.pocket__card` CSS was mistaken for "the" sacred pattern by this
   document's own first-draft spec. It had zero live imports anywhere in the app —
   confirmed dead, superseded by #1/#2, never deleted until now. Its bare `.pocket`
   selector collided with #1's once both lost their old `.kargah` scope wall in the same
   promotion pass; #1 happened to win by source-order luck, which is accidental safety,
   not verified safety. Deleting the dead pattern was the actual fix — not renaming
   either live one.

Governing rule for any future extension: **slip/paper count is real data — the record's
actual attachment count, capped at 3 — never decoration.** An empty pocket (0 papers) is
a legitimate, informative empty state, not a bug to hide.

## The shell `SHIPPED` — single navbar, left icon rail, bento grid

Spec 2026-09-08 §9a/§9b, built in the follow-on `shell/navbar-rail-bento` branch on top
of the substrate. Three independent pieces:

**`Navbar`** (`components/kargah/Navbar.tsx`) replaced the old two-row header (brand bar
+ `TabPill`'s group row + tab row) with one row: brand at inline-start (visual right
under RTL), the six sales groups centred, `ProfileMenu` at inline-end — all logical
properties, per decision 4. Each group pill click-toggles its own dropdown (same open/
outside-click/Esc pattern as `ProfileMenu`) — the spec's own instruction is hover-only,
which has no equivalent on touch and is not keyboard-operable alone, so a pure-CSS
`(hover: hover) and (pointer: fine)` enhancement is layered on top instead of replacing
click. **The dropdown panel must be unconditionally rendered and hidden by CSS default**
(`display: none`, revealed by `[data-open="true"]` or the hover/focus-within rule) —
conditionally *rendering* it on the same React state the click handler toggles was tried
first and is a real bug: a mouse hover opens it, then the click that follows immediately
toggles the same state closed, so hovering and clicking together closes what hover just
opened. Caught by a real Playwright click against the built page, not by reading the
JSX. `TabPill` (`components/kargah/TabPill.tsx`) shrank to render only the tab row —
`groups`/`shownGroups`/the `seg-groups` markup all moved into `Navbar`.

**`Rail`** (`components/kargah/Rail.tsx`) is the left icon column — **named `.iconrail`,
never bare `.rail`**: `ScheduleBoard.tsx` already renders `.rail` for its own
day-schedule panel, and the rail's own calendar icon links straight to that page: a bare
`.rail` here would have collided with it at equal specificity on first paint, exactly the
`.pocket` collision class documented above. It ships **five items, not the video's nine**
— back, calendar (`/sales/schedule`), map (`/map`), alerts (the existing
`NotificationBell` polling logic, extracted to `lib/useUnreadCount.ts` so both consumers
share one 60s poll instead of two drifting ones), and the three-state theme control
(`ThemeToggle3.tsx`, decision 3) at the foot. Share/export/star/add/data/send are NOT
wired: none has a real target anywhere in this app today, and shipping inert icons is
exactly the decoration the pocket's own governing rule above forbids. **The rail is
positioned with physical `left`, not `inset-inline-start`** — unlike the navbar, the spec
names this the "left icon rail" literally and repeatedly rather than by logical role;
`inset-inline-start` resolves to the visual RIGHT under RTL and would land the rail under
the navbar's own utility cluster. Also caught by the same Playwright check, not by
re-reading the spec's prose. Magnification-on-proximity is `useDockMagnify`
(`lib/design/dockMagnify.ts`) — same one-delegated-listener architecture as
`useTiltGlow`, writing `--dock-scale` from a single `pointermove` on the rail container.

**`Bento`/`BentoCell`** (`components/kargah/Bento.tsx`) is the general span-grid system —
`.bento` + `data-span="full|wide|half|narrow"`, 12 columns, phone stacks to one. Distinct
from `BentoStrip`/`BentoTile`/`BentoGauge` (`components/BentoStrip.tsx`, the fixed-shape
record-header widget on order pages) and `CustomerBento` (the customer-window widget) —
same word, three different, non-overlapping things; do not conflate them.
`lib/design/bentoSpan.ts`'s `bentoSpanForIndex(index, total)` picks a span for a
dynamic-length tile list (pairs wide+narrow, a lone/odd-leftover tile spans full) — its
one real consumer is `components/today/Briefing.tsx`'s `kargah` variant, which is the
`/sales/today` page the redesign brief itself named for "card widths... over-expanding."

## User avatars `SHIPPED`

The other genuine §9d gap (alongside the workflow-editor backend, still deferred below)
is closed: a user can have a real profile picture, not just initials-on-a-tone.

Reuses the `photos` table rather than a second storage path — `entity_type` widened to
also accept `'user'` (it already accepted `'district'`/`'customer'`/`'payment'` by the
time this landed; the two-value set an earlier design read of this table assumed was
already stale before this work even started, found by a failing test's real error
message, not by re-reading the file closely enough the first time). A partial UNIQUE
index (`idx_photos_user_singleton`) guarantees at most one avatar row per user — upload
replaces rather than accumulates, unlike a customer's photo gallery or a payment's
receipt, both of which are meant to grow.

**Self-service only**: `POST`/`DELETE /api/users/[id]/avatar` accept only the caller's
own id — no admin-uploads-for-others path, matching the workflow-template decision's
"no admin CRUD" minimalism (§15 decision 6). **Viewing is org-wide**, not group-scoped
like `canReachUser` in `lib/session.ts` — a shared task board needs to show a colleague's
face regardless of which group they're in; `lib/avatarAccess.ts`'s `canViewUserAvatar`
is the (tenant-safe) rule for that, deliberately looser than `canReachUser` and
deliberately its own small module rather than a reuse of the stricter one.

All the SQL for this lives in `lib/repo/avatars.ts`, not in the routes themselves —
`tests/repo-boundary.test.ts` enforces that new raw SQL may only live in `lib/repo/`,
which the first draft of the routes violated (caught by the full test suite, not by
anything task-scoped verification alone would have surfaced, since running only the new
test file in isolation never exercises that repo-wide check).

`Avatar.tsx` tries a real picture first (`/api/users/{id}/avatar/file`), falling through
to the initials chip on a 404/error — no prop signature change, so all ~dozen existing
call sites (ProfileMenu, AvatarStack, task rows, …) needed zero edits. `ProfileMenu`
gets upload/remove controls on the viewer's own avatar, mirroring `PhotoGallery.tsx`'s
established upload idiom (hidden `<input type=file>` under a label, upload-on-select).

**Not built, on purpose**: the spec's "assign realistic AI-generated avatars to demo
users" is a seed-script concern that needs real image assets nobody has produced — the
pipe is built, filling it with demo images is separate work.

## Complaint resolution workflow `SHIPPED`

The backend half of the repurposed workflow editor (2026-09-09 decision — see the
deferred list below for why `/sales/complaints`, not a new generic `/sales/tasks` board).

No new column on `tasks`: a spawned step is `entity_type='complaint'` /
`entity_id=<complaint id>`, the same polymorphic link photos/reminders/activity_log
already use. Two new tables only: `workflow_step_templates` (six fixed, seeded,
app-wide steps — بررسی اولیه / آزمایش و بررسی فنی / تماس با مشتری / تعویض یا جبران /
اطلاع‌رسانی نتیجه / تماس رضایت‌سنجی — no admin CRUD, spec §15 decision 6) and
`workflow_edges` (`from_task_id`, `to_task_id UNIQUE`) — the `UNIQUE` on `to_task_id`
makes "every step has at most one parent" a DB-level guarantee, not just app discipline,
since a freshly created task can never already have one.

**No `state` column on an edge.** The original spec's draft SQL had one
(`resolved`/`pending`); this implementation derives it instead from the target task's
own `status` at read time — a second stored copy of "is this task done" is a second
place it can drift out of sync, and `lib/repo/workflow.ts`'s `getComplaintSteps` already
returns the task rows the caller needs to compute solid/dashed itself.

**No new completion endpoint.** Marking a step done reuses the existing
`PATCH /api/tasks/[id]` (`completeTask` in `lib/repo/tasks.ts`) — it was already fully
generic (works for any `kind`/`entity_type`, no special-casing needed).

`lib/repo/workflow.ts`: `listStepTemplates()`, `getComplaintSteps(orgId, complaintId)`,
`linkStep(orgId, complaintId, templateKey, fromTaskId, createdByUserId)`. Routes:
`GET`/`POST /api/sales/complaints/[id]/steps` — GET open to owner/group_manager/
salesperson (read parity with the existing complaints list route), POST restricted to
owner/group_manager (write parity with `ComplaintsPanel.tsx`'s existing `canManage`
status-change gate).

Neither new table carries `organization_id` — both are in
`tests/tenancy-schema.test.ts`'s `exempt` set (`workflow_edges` reaches its tenant
through the tasks it connects, `workflow_step_templates` is not tenant data at all).

**The UI**: `ComplaintWorkflowModal.tsx`, opened from a new "مسیر رسیدگی" button on each
`/sales/complaints` row (reuses `.kargah-scrim`/`.modal` — `ProcessingModal.tsx` is the
reference, not a new modal chrome pattern). The drag gesture is
`AssignmentBoard.tsx`'s proven pointer-capture pattern adapted, not reinvented: a real
`<button>` wired with both `onPointerDown` (drag) and `onClick` (keyboard/tap fallback,
opening a target-picker instead), distinguished by a `dragging` ref so a completed drag
never also fires a click. Two pure, tested modules do the graph's math:
`lib/design/treeLayout.ts`'s `layoutTree` (row = depth, a parent's column centres over
its children's — deliberately simple, these graphs are a handful of nodes) and
`lib/design/connectorPath.ts`'s `bezierPath` (the vertical S-curve between two nodes,
spec §9c's "curved bezier edges"). Edge solid/dashed is read directly off the target
task's live `status` — no separate state to keep in sync, per the backend section above.

## Brand mark `SHIPPED`

Replaced the stale placeholder (`public/icon.svg`'s navy #0A0E14 square + cyan #2DE0E6
diamond, both colours dead since the substrate redesign) after two full rejected rounds
— see `docs/superpowers/plans/2026-09-09-brand-mark.md` for the concepts that didn't
make it and why. **The mark: a near-black rounded square containing a white route arc
with a live pulse riding it** (a solid dot inside a faint ring, positioned mid-path, not
at either endpoint) — the one element among all twelve concepts shown that actually
implied movement rather than a static path.

Wired into every Next.js icon convention: `app/icon.svg` (auto-linked `<link
rel="icon">`), `app/apple-icon.png` 180×180 (auto-linked `<link rel="apple-touch-icon">`),
`app/favicon.ico` 16+32 (root-only `favicon` convention), and a maskable 512×512 PNG
(`public/icons/maskable-512.png`, rendered from a *separate* full-bleed SVG with the mark
scaled into the W3C safe zone — a maskable icon must not pre-round its own corners, the
OS applies its own mask) referenced from `manifest.ts`. `public/icon.svg` duplicates
`app/icon.svg`'s content on purpose: Next's own icon route serves at a query-stringed
URL, not the stable path a PWA manifest needs. `scripts/gen-icons.mjs` does the
rasterizing (via `sharp`, already a dependency) and hand-assembles the `.ico` container
directly — modern `.ico` embeds PNG data per entry, no third-party encoder needed.

## Kit primitives not yet wired to real pages

`TiltCard`, `GlowSurface`, the five pill form controls, `SegmentedPill`, `ArcGauge`,
`StatefulButton`, `GooeyInput` all exist, are tested where they have extractable pure
logic, and build cleanly — but none is imported by a real page yet. That was deliberate
at the time: the substrate sub-project's scope was the substrate and the kit, not the
shell that would consume it. The shell sub-project above is exactly that consumption —
`Navbar`, `Rail` and `Bento`/`BentoCell` are the wired examples of how a kit primitive
graduates from "exists" to "used": a real page imports it, a real click does something,
and (where the primitive has pure logic worth isolating, like `bentoSpanForIndex` or
`magnifyScale`) a test pins the shape of that logic down. The primitives listed above
still await the same treatment from whichever future page actually needs them —
`StatefulButton`/`GooeyInput` in particular are confirmed-from-video but have no current
call site.

## Anti-patterns

- No purple/pink AI-gradient anything.
- No emoji as icon.
- No token defined in only one theme block.
- No component that branches on theme in JS.
- No `--accent` carrying a chrome/button fill — that is `--primary`'s job. No status
  color carrying interaction.
- No color as the only signal.
- **No `--text-faint` on anything a reader must read** — it does not clear 4.5:1.
- **No `box-shadow` on a `clip-path`ed/notched element** — use `--card-drop`.
- **No hand-typed rgba shadow literal** — reference `--sh-*`/`--card-drop`/`--edge-hi`/
  `--edge-lo`. A literal survives token-based retinting untouched, which is exactly how
  three warm shadows survived this whole redesign undetected until Task 19's audit.
- **No `-webkit-backdrop-filter` written after the standard `backdrop-filter`** — see
  Skeuomorphic system.
- **No stagger delay left on an element while resetting its entrance.**
- **No `setPointerCapture` on a drag container**, and no `preventDefault()` on
  `pointerdown` — both silently destroy the click.
- **No `inset-inline-start` for centring a fixed overlay** — physical `left: 50%` instead.
- No spring/tilt/glow in `/driver`, on hover targets that are precision click targets
  (buttons/links still use a simple scale, no overshoot), on map layers, or on anything
  the user is waiting on (spinners, saving states).
- No stagger that runs past its cap; no motion that survives `prefers-reduced-motion`.
- No animation on `width`/`height`/`top`/`left` outside the notification island's
  documented exemption.
- No spinner where a skeleton fits; `StatefulButton` covers the button-specific case.
- No proportional figures in a column of numbers.
- **No renaming a CSS class without grepping for it as a runtime string first** — a
  `querySelectorAll`/reveal-on-navigate selector list is not caught by TypeScript, and a
  plain rename silently stops an animation rather than breaking the build. Found once
  already (`RevealRoute.tsx`'s `.cradlewrap` reference) during this redesign.
- **No mechanical class-rename regex anchored on a word boundary alone** — `\bkargah\b`
  (or any `\.NAME\b`-style pattern) matches `NAME` as a *prefix* of any longer class that
  happens to start with it and continue with a hyphen, since a hyphen is itself a word
  boundary. `.kargah-scrim` (a real class two live components render) was corrupted this
  way into the invalid selector `:root-scrim`, silently dropped by every browser rather
  than erroring — undetected through this entire redesign's build+test verification until
  the very last task, because neither `npm test` nor a route-list build summary surfaces
  a dropped CSS selector. Grep the *full* `npm run build` output for `warn`/`error`, not
  just its tail, after any bulk selector rewrite — and anchor a rename regex to the
  selector's true edges (`\.kargah(?![\w-])`, or better, an exact set of known selectors)
  rather than a bare word boundary.
- **No assuming a component is "the" instance of a pattern from its class name alone** —
  verify with `grep -rln` for actual imports before treating anything as either sacred or
  safe to delete. Two components sharing a bare class name (`.pocket`) is exactly how the
  dead-pattern collision in **Pocket patterns** above happened.

## Not yet decided / deferred to later sub-projects

- Icon set — `lucide-react` approved, now wired via the shell sub-project's `Rail`
  (`ChevronRight`/`CalendarDays`/`MapPin`/`Bell`) — still the only consumer; the rest of
  the app's icons (SVG inline, or emoji in places the anti-patterns below already flag)
  are unmigrated.
- Journey connector lines (curved bezier edges between task nodes,
  solid=resolved/dashed=pending) and the drag-to-link workflow editor UI — repurposed
  onto `/sales/complaints` rather than a new generic `/sales/tasks` board (2026-09-09
  decision, see "Complaint resolution workflow" below); the backend is done, this UI
  piece is the remaining part.
- Route migration + the `loading.tsx`/`<Suspense>`/`next/dynamic`/`Promise.all` speed
  work, for the routes not yet on this substrate.
- ~~The workflow-editor UI~~ — shipped, see "Complaint resolution workflow" above.
  §9c/§9d are now fully shipped: user avatars, the workflow backend, and the drag-to-link
  graph UI all exist. Deliberately NOT retrofitted onto `OrderJourney.tsx`, which keeps
  its explicit read-only invariant (ticks derived from real records, never manually
  toggled, so they can never disagree with the invoice).
- Global features: command palette, hotkeys, Login-As impersonation, themed error pages,
  contextual `(i)` help.
- Module polish: map/GIS cleanup, CRM workflow gaps, logistics (vertical timeline, Lottie
  empty states), calendar/weather, the Persian i18n sweep.
- ~~Brand mark, icon/favicon set~~ — shipped, see "Brand mark" above. Splash screen
  still open (no dedicated splash asset exists yet, only the PWA manifest icons).
