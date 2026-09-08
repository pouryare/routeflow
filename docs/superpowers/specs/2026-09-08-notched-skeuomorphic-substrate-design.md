# Notched Skeuomorphic Substrate + Physical Kit — Design

**Date:** 2026-09-08
**Scope:** Sub-projects 1 (substrate/token layer) and 2 (physical component kit) of the
theme overhaul. Later sub-projects are named in §14 and must remain unblocked.
**Status:** awaiting review. No code written.

---

## 1. Where this came from

Three inputs: a reference video (a SugarCRM concept shot), a written "Style" refactor
brief, and a "Speed Enhancement" brief. Plus six decisions the user settled directly.

### Settled decisions — do not relitigate

1. **Palette:** abandon the warm cream + terracotta «کارگاه» identity. Go cool + black
   like the video — cool neutral grey ground, pure white cards, near-black primary fills.
2. **Light is the default and the identity.** Dark becomes the night skin.
3. **Reach:** every route except the map's own tile canvas. The Leaflet/MapLibre canvas
   keeps its basemap-declared ground; the map's panels, sidebar and controls get the theme.
4. **Motion:** full 3D tilt + cursor-follow glow + glass. Only `/driver` is exempt.
5. **Notch + skeuomorphism are the core brand identity**, not decoration.
6. **The pocket is sacred** and extends to more record types.
7. **Accent themes are retired.** `gen-accent-themes.mjs` and the `AccentPicker` go away.
8. **`THEME_KEY` is migrated** to a RouteFlow-correct name. The app is not shipped, so
   there are no real stored preferences to preserve.
9. **Theme is auto by default, with a manual override.** Three states — `auto` (follows
   `prefers-color-scheme` live), `light`, `dark` — not the current "read the OS once, then
   freeze" behaviour. `/driver` is the exception (§7.3).
10. **The whole reference is in scope, not just tokens** — single navbar, left icon rail,
    bento grids, and the connector lines between boxes. Front *and* back end: the
    drag-and-drop workflow and profile pictures need real persistence, not mock data.

### Scope correction

The first draft of this document deferred the shell, the bento grid and the journey
connectors to later sub-projects. **That was wrong** — the user's emphasis is that the
reference is wanted whole. They are now in scope, as §§9a–9c, along with the backend work
in §9d that "front and backend" implies.

### MASTER.md's authority is revoked

The user's instruction was explicit: *"ignore the old docs rules. do exactly as prompt i
gave you."* `MASTER.md` is now a record of the past, to be rewritten (§12) — not a
constraint. Three of its rules are dead: the Lucide/Feather exclusion, "Dark is the
default", and the spring/hover-target bans outside `/driver`.

Two things survive, on engineering merit rather than authority:

- **`prefers-reduced-motion` must disable all motion.** Accessibility, not house style.
- **Text must meet WCAG contrast.** `scripts/check-contrast.mjs` verifies it.

---

## 2. The architectural discovery that shapes this plan

The app does not have one theme with two skins. It has **two parallel design systems**:

| Block | Line | What it is | Used by |
|---|---|---|---|
| `:root` | 8 | Old dark console. `--bg #0a0e14`, `--accent #2de0e6` cyan | map, `/today`, `/leads`, `/planner`, `/report`, `/analytics`, `/facilities`, `/gallery`, `/driver`, `/login` |
| `:root[data-theme="light"]` | 179 | Light console | same, when toggled |
| `.kargah` | 1501 | **Warm workshop, light-first.** Own radii, own shadows, own everything | `/sales/*`, `/settings/*` only |
| `:root[data-skin="dark"] .kargah` | 1649 | kargah's night skin | same |

`.kargah` already has what the video wants structurally:

```
--radius-sm: 9px   --radius-md: 12px  --radius-lg: 16px
--radius-xl: 20px  --radius-2xl: 26px --radius-pill: 999px
--sh-1 / --sh-2 / --sh-3 / --sh-lift    (layered soft shadows)
--card-drop                              (drop-shadow form, for clipped shapes)
```

Its radii are already in the video's range. Its shadows are already layered. What is
wrong is only the **temperature** — the shadows are `rgba(62,44,28,…)` warm brown, the
ground is cream, the accent is terracotta.

**Therefore the plan is not "write a new design system." It is:**

1. Repalette `.kargah`'s token block cool + black.
2. **Promote it from `.kargah` to `:root`** — this delivers "light is default" and
   "reach every route" in one move.
3. Delete the old console blocks (`:root` dark, `:root[data-theme="light"]`), keeping
   only the map-canvas ink tokens which are basemap-driven and out of scope.
4. Add the genuinely new layer: the notch system, the skeuomorphic surface devices, and
   the tilt/glow architecture.

This is dramatically cheaper and lower-risk than a from-scratch substrate, and it means
`/sales` and `/settings` — the two live production surfaces — change **values, not
structure**.

---

## 3. Thesis (replaces MASTER.md "Visual thesis")

> **Machined — cut metal and white paper, not a warm workshop.**
>
> The previous thesis was «کارگاه — a warm workshop»: cream ground, terracotta accent,
> warmth as the differentiator. It is replaced. The new ground is a cool neutral grey and
> the surfaces on it are pure white cards that look **milled** — physically cut, lit from
> above, with a bright inner edge where the cut catches the light and a soft shadow
> underneath where it lifts off the ground. Primary actions are solid near-black pills.
> Colour appears almost nowhere in the chrome; it is reserved for data and status, which
> is what makes the data read.
>
> Three devices carry the identity:
>
> 1. **Cards are notched.** A rounded rectangle is *subtracted* from a card's edge,
>    leaving a stepped profile with a concave inner corner. Icons, avatar clusters and
>    sub-navigation are seated in the bay that removal opens. This is the brand mark —
>    the notch appears on the logo, on page headers, on cards that carry an icon, and in
>    the segmented control's trough. Nothing else in this software category looks like it.
> 2. **Surfaces are physical.** A bright 1px inner edge along the top, a layered soft
>    shadow beneath, a fine directional grain across the face, and a specular highlight
>    that tracks the pointer. Cards tilt in perspective toward the cursor.
> 3. **Documents live in pockets.** An order is not a row; it is a card with its receipt
>    and invoice tucked behind it. At rest they peek; on hover they fan out and rise.
>    *(Unchanged and non-negotiable — see §9.)*

---

## 4. Token layer

### 4.1 Light — the default, in `:root`

Contrast figures below marked ✓ were computed by hand with the WCAG 2.1
relative-luminance formula. **Every figure must be re-verified by
`npm run check:contrast` before merge** — see §13.

```css
:root {
  /* ---- Ground & surfaces.
     Cool neutral, never warm, never pure white for the ground — the video's
     page is a soft grey that white cards lift off. */
  --bg:            #ECEDEF;  /* cool light grey page ground */
  --surface:       #FFFFFF;  /* cards */
  --surface-2:     #F7F8F9;  /* inset rows, quiet fills */
  --surface-sunk:  #E3E5E8;  /* tab trough, slider track, wells */
  --border:        #E2E4E8;  /* hairlines */
  --border-strong: #D2D6DC;  /* emphasised borders */

  /* ---- Ink */
  --text:       #16181D;  /* 17.76 vs surface ✓ · 15.17 vs bg ✓ */
  --text-muted: #5F6672;  /*  5.78 vs surface ✓ ·  4.94 vs bg ✓ */
  --text-faint: #8A909B;  /*  3.21 vs surface — NON-TEXT ONLY */

  /* ---- Primary action. The video's signature: a solid near-black pill. */
  --primary:     #101216;
  --primary-ink: #FFFFFF;  /* 18.75 on primary ✓ */

  /* ---- Accent. Demoted: data, links and selection only — never chrome.
     Cornflower, matching the video's slider fill. */
  --accent:      #3D6FD9;  /* fills */
  --accent-text: #2F5FC4;  /* 5.91 vs surface ✓ · 5.04 vs bg ✓ */
  --accent-ink:  #FFFFFF;

  /* ---- Status. Cool-shifted from the warm set. NEEDS SCRIPT VERIFICATION. */
  --good: #1F6B45;
  --warn: #8A5A00;
  --crit: #A81D3A;
  --info: #2A5F80;
}
```

### 4.2 Dark — the night skin, in `:root[data-theme="dark"]`

The polarity of the attribute **inverts**: today dark is the absence of `data-theme` and
light is `data-theme="light"`. That flips. See §13 for the migration hazard this creates.

```css
:root[data-theme="dark"] {
  --bg:            #101215;
  --surface:       #191C21;
  --surface-2:     #1F232A;
  --surface-sunk:  #0C0E11;
  --border:        #262B33;
  --border-strong: #343A44;

  --text:       #E8EAEE;
  --text-muted: #9BA3AF;
  --text-faint: #6B7280;   /* non-text only */

  /* Inverted: on a dark ground the "black pill" becomes a white pill. */
  --primary:     #F2F4F7;
  --primary-ink: #101216;

  --accent:      #6D96EC;
  --accent-text: #8FB0F2;
  --accent-ink:  #0B1220;

  --good: #4BB07C;
  --warn: #D9A23B;
  --crit: #E8607F;
  --info: #6BA8CE;
}
```

Every token defined in one block is defined in the other. This is kept not because
MASTER.md said so but because a token defined only in one block renders as an invisible
element in the other, which is a real class of bug the codebase has hit before.

### 4.3 Elevation — skeuomorphic, cool-tinted

The current stack is `rgba(62,44,28,…)` — warm brown, correct on cream, dirty on cool
grey. Retint to slate, and add the inset highlight that makes a surface read as milled:

```css
:root {
  /* Layered drops. Two stops each: a tight contact shadow plus a wide soft one. */
  --sh-1: 0 1px 2px rgba(24,28,38,.05),  0 4px 14px -6px  rgba(24,28,38,.10);
  --sh-2: 0 2px 5px rgba(24,28,38,.06),  0 14px 34px -12px rgba(24,28,38,.16);
  --sh-3: 0 4px 10px rgba(24,28,38,.07), 0 28px 60px -18px rgba(24,28,38,.26);
  --sh-lift: 0 10px 22px -8px rgba(24,28,38,.22), 0 30px 60px -24px rgba(24,28,38,.28);

  /* The milled edge. A white card on grey needs this or it reads as a flat rectangle. */
  --edge-hi:  inset 0 1px 0 rgba(255,255,255,.92);
  --edge-lo:  inset 0 -1px 0 rgba(24,28,38,.05);

  /* drop-shadow form — a clip-path'd (notched) element loses box-shadow entirely.
     Two stacked drop-shadows is the affordable ceiling; three visibly costs. */
  --card-drop: drop-shadow(0 1px 2px rgba(24,28,38,.07))
               drop-shadow(0 12px 26px rgba(24,28,38,.13));
}
```

In dark, `--edge-hi` drops to `rgba(255,255,255,.06)` — a bright white inner edge on a
dark surface reads as a rendering fault, not as light.

### 4.4 Radii

Already correct in `.kargah`; carried over with the top of the scale nudged to match the
video's larger cards.

```css
--radius-sm: 9px;  --radius-md: 12px;  --radius-lg: 16px;
--radius-xl: 20px; --radius-2xl: 28px; --radius-pill: 999px;
```

**Every input, select, button and tab is `--radius-pill`.** That single rule does most of
the visual work of matching the reference.

### 4.5 Theme resolution — auto, light, dark

Today `lib/theme.ts` reads the OS preference **once**, writes it down, and never consults
it again. Its comment defends this: a delivery app that flipped to light under a driver at
sunrise would be changing the interface of someone who is driving.

That reasoning is sound for `/driver` and wrong everywhere else. Decision 9 splits them:

| Stored value | Behaviour |
|---|---|
| `auto` *(default)* | follows `prefers-color-scheme` **live**, via a `matchMedia` change listener |
| `light` | pinned |
| `dark` | pinned |

`/driver` **ignores `auto`** and pins to the stored explicit value, or dark if none — a
moving vehicle is the one place a theme must not change by itself.

The blocking `THEME_INIT_SCRIPT` still runs before first paint, but now resolves `auto` at
paint time rather than freezing it. The control is the three-state toggle at the foot of
the left rail (§9a).

**Key migration:** `THEME_KEY` becomes `"routeflow-theme"`. The dual
`data-theme`/`data-skin` attribute pair collapses to a single `data-theme` once `.kargah`
is promoted to `:root` (§2). The app is not shipped, so no stored value needs preserving —
the old key is simply dropped.

### 4.6 Accent themes are retired

`scripts/gen-accent-themes.mjs` (36,966 bytes of generated permutations),
`lib/accentThemes.ts`, `lib/accent.ts`, `components/AccentPicker.tsx` and the
`ACCENT_INIT_SCRIPT` in the root layout all go. In a black-primary system the accent only
tints data and links; a user-chosen accent has almost nothing left to colour, and it was
costing a generator, an init script and a third `<html>` attribute.

This deletes one of the three blocking inline scripts in `app/layout.tsx`, which is a
small but real first-paint win.

---

## 5. The notch system — the brand identity

### 5.1 What already exists

`lib/design/carve.ts` computes an SVG path for a card with a rounded rectangle subtracted
from one top corner. `components/kargah/CarvedCard.tsx` applies it as `clip-path: path()`,
recomputes on `ResizeObserver` **and** on `document.fonts.ready` (Persian glyph metrics
change the box after the webfont lands), and drops the notch entirely below 360px.

The two hard problems are already solved there and the solutions are correct:

- **Shadow.** `clip-path` clips `box-shadow` away with everything else outside the shape.
  The fix is `filter: var(--card-drop)` — stacked `drop-shadow()`, which follows the
  clipped outline. Already in the codebase at [globals.css:1607](../../app/globals.css#L1607).
- **Stretching.** A percentage-sized mask stretches the corner radii as the card grows,
  so the path is computed from the **measured** pixel box instead.

**This is a good foundation. Generalise it; do not replace it.**

### 5.2 What must change

`carve.ts` is hardcoded to one shape in one place. Its own comment admits the RTL
shortcut: *"Coordinates are physical, and the bay is on the RIGHT because /sales is RTL
and inline-start resolves there."* Once the theme covers every route, that assumption
breaks — `/login` and the map panels are the same document direction, but a future LTR
locale or an explicitly-LTR subtree would notch the wrong corner.

Generalise to a token-driven system:

```ts
export type NotchSide = 'start' | 'end';
export type NotchEdge = 'top' | 'bottom';

export type CarveOpts = {
  side?: NotchSide;        // default 'start'
  edge?: NotchEdge;        // default 'top'
  dir?: 'rtl' | 'ltr';     // resolved by the caller from getComputedStyle
  notchWidth?: number;     // default 272
  notchHeight?: number;    // default 62
  radius?: number;         // outer, default 28  (was 26)
  innerRadius?: number;    // concave, default 20
  minWidth?: number;       // default 360
};
```

with matching CSS custom properties so a surface can declare its notch declaratively:

```css
--notch-w: 272px;  --notch-h: 62px;
--notch-r: 28px;   --notch-ir: 20px;   --notch-min: 360px;
```

### 5.3 The border problem — not yet solved in the codebase

A clipped shape loses its **border** as well as its shadow, and this design needs both a
hairline border and the `--edge-hi` inner highlight to follow the notched outline. The
existing `.cradlecard` sidesteps it by having no border at all.

**Recommended solution: a stacked-path pseudo-element.**

The notched element gets a `::before` at `inset: 0` carrying the *same* `clip-path`, a
background of the border colour, and a second nested clip inset by 1px. Cheaper and more
robust than the alternatives:

- `border-image` with a gradient — cannot follow a `path()` outline.
- An inline SVG `<path>` with `stroke` — accurate, but adds a DOM node and a second
  reflow-coupled measurement per card.
- `paint-worklet` (Houdini) — Firefox has never shipped it; not viable.

**Verified:** the CSS `corner-shape` property (`superellipse`/`squircle` values, which
would make concave corners a one-liner) is **Chromium-only as of mid-2026 — Chrome 139+,
not Baseline, no Safari or Firefox timeline**, per Smashing Magazine and MDN. It does not
collapse this section. Note it as a future progressive enhancement — `@supports
(corner-shape: bevel)` swapping to a simpler CSS-only shape on Chromium once support
broadens — but the clip-path/pseudo-element approach in §5.3 remains the implementation.

### 5.4 Where the notch goes

The brief says: *"particularly where icons are embedded — to establish it as a core visual
brand identity."*

| Surface | Notch carries |
|---|---|
| **PageHeaderCard** (every page) | the sub-navigation / tab anchor — the brief asks for this explicitly |
| Record cards | avatar cluster of the people on the record (today's `CarvedCard`) |
| Cards with a leading icon | the icon, seated in the bay |
| SegmentedPill trough | the sliding indicator's well |
| Modal header | the close button |
| Stat cards | the trend arrow / delta chip |
| The logo | the mark itself (§10) |

---

## 6. The skeuomorphic surface system

### 6.1 A correction from re-reading the reference frames

The video's **cards are opaque white, not glass.** `backdrop-filter` appears in only two
places: the modal's blurred backdrop, and the pocket's frosted document face. This matters
enormously for performance — "glass on every card" is not what the reference actually
does, and building it that way would be both slower and less faithful.

**Glass is therefore restricted to:** modal backdrops, the sticky header, the pocket's
frosted face, and the tab trough. Not cards.

### 6.2 Tilt and glow — the delegated architecture

The naive implementation is a `pointermove` handler with React state per card. At 40 cards
that is 40 listeners and a render per frame. Catastrophic.

**One listener per container. One element updated per frame.**

```
container.addEventListener('pointermove', e => {
  const card = e.target.closest('[data-tilt]')
  if (card !== active) { release(active); active = card }
  if (!active) return
  rafId ??= requestAnimationFrame(() => {
    const r = active.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width          // 0..1
    const y = (e.clientY - r.top)  / r.height
    active.style.setProperty('--mx', x)
    active.style.setProperty('--my', y)
    rafId = null
  })
})
```

Only the hovered card tilts — which is what the video does anyway, since you point at one
card at a time. So the per-frame cost is **one** style write on **one** element,
regardless of how many cards are on screen. `will-change` is applied on pointerenter and
removed on pointerleave, so at most one card is layer-promoted at a time.

The CSS reads those properties:

```css
[data-tilt] {
  --mx: .5; --my: .5;
  transform: perspective(900px)
             rotateX(calc((.5 - var(--my)) * var(--tilt-max)))
             rotateY(calc((var(--mx) - .5) * var(--tilt-max) * var(--tilt-dir)));
}
:root       { --tilt-dir: -1; }   /* RTL: rotateY sign flips */
[dir="ltr"] { --tilt-dir:  1; }
```

The glow is a single radial gradient positioned from the same two properties, on a
`::after` at `inset: 0` with `mix-blend-mode: plus-lighter`.

**Verification needed:** whether `--mx`/`--my` require `@property` registration to
interpolate smoothly here. Since they are written every frame from rAF rather than
transitioned, they likely do **not** — but this should be confirmed empirically rather
than assumed.

**Touch:** there is no hover on a phone. On coarse pointers tilt and glow are disabled
entirely (`@media (hover: hover) and (pointer: fine)`); touch gets the existing press-state
lift instead.

### 6.3 Directional noise

A fine grain across surfaces. Recommend a **single inline SVG `feTurbulence` data-URI**
declared once on a utility class and reused, rather than a PNG tile (no extra request, no
cache concern, ~400 bytes). It must sit at very low opacity on a pseudo-element *below*
text, never over it, so it cannot affect text contrast.

### 6.4 Reduced motion

The codebase already has 11 `prefers-reduced-motion` blocks and a `usePrefersReducedMotion`
hook. Extend the existing convention:

```css
@media (prefers-reduced-motion: reduce) {
  [data-tilt] { transform: none !important; }
  [data-glow]::after { display: none; }
}
```

and the delegated listener bails early on the same media query.

---

## 7. Performance budget

| Effect | Ceiling | Degradation past it |
|---|---|---|
| 3D tilt | 1 active at a time by construction | n/a |
| Cursor glow | 1 active at a time by construction | n/a |
| `backdrop-filter` glass | **≤ 6 simultaneous** | opaque `--surface` fallback |
| Notch (`clip-path` + `--card-drop`) | ~40 per screen | drop the notch below `--notch-min` (already the behaviour) |
| Stacked `drop-shadow` | 2 max | flatten to `--sh-1` |

`/driver` opts out of all of it. Boards that can exceed ~60 cards get
`content-visibility: auto` on rows.

**Honest gap:** these numbers are reasoned, not measured. Before rolling the notch onto
high-cardinality boards, profile one real board on a mid-range Android. `clip-path` +
stacked `drop-shadow` at 40 instances is the specific combination I would want measured.

---

## 8. The physical kit

| Component | Basis | Needs a library? |
|---|---|---|
| `NotchedCard` | generalises `CarvedCard` | no |
| `PageHeaderCard` | new — overview text + sub-nav in the notch | no |
| `TiltCard` / `useTilt` | new — delegated listener | no |
| `GlowSurface` | new — CSS custom properties | no |
| `GlassFace` | extracted from the pocket's frosted face | no |
| `Field` / `Select` / `Textarea` | new — pill-shaped | no |
| `RangeSlider` | extends `ProcessingModal`'s slider | no |
| `IconButton` | new — circular | no |
| `SegmentedPill` | extends `TabPill` (already measures + springs) | no |
| `AvatarStack` | extends `AvatarStack.tsx` + numeric badges | no |
| `ArcGauge` | extends `components/charts/` | no |
| `StatCounter` | existing `CountUp.tsx` — keep it | no |
| `ExpandableCard` | Aceternity — `layoutId` shared-layout transition, confirmed | **yes — `motion`**, the only such dependency in the kit |
| `FloatingDock` | Aceternity — the icon rail, `MotionValue`+distance→scale, confirmed | hand-roll via §6.2's delegated pattern |
| `TracedAvatar` | Aceternity `AnimatedTooltip`'s hover-pop-and-track, repurposed as click-to-pin trace — **confirmed live in the reference** at 00:10 (§9c) | hand-roll |
| `StatefulButton` | Aceternity idle→loading→success — **confirmed live in the reference** on "Take for Processing" and "Add Case" (§9c) | hand-roll |
| `GooeyInput` | Aceternity — SVG `feGaussianBlur`+`feColorMatrix`, confirmed | hand-roll |
| `NavBar` | **new** — replaces two-row `Chrome.tsx` (§9a) | no |
| `IconRail` | **new** — left rail + theme toggle (§9a) | no |
| `ThemeToggle3` | extends `ThemeToggle.tsx` to auto/light/dark | no |
| `BentoGrid` | extends `BentoStrip.tsx` (§9b) | no |
| `JourneyGraph` | **new** — SVG connector overlay (§9c) | no |
| `NodePort` | **new** — the small circular edge nodes | no |
| `TaskRow` | **new** — avatar-or-`+`, title, state icon, date button | no |

**On the seven Aceternity components — now fetched and confirmed directly, not
inferred:**

| Component | Confirmed mechanism | Needs `motion`? |
|---|---|---|
| `GooeyInput` | SVG filter (`feGaussianBlur` + `feColorMatrix` contrast) wrapping an expanding input; width animates `collapsedWidth → expandedWidth` | reimplement in CSS — the width tween is a transition, the goo is the SVG filter |
| `ExpandableCard` | `layoutId` **shared-layout** transition — Motion computes the FLIP animation between the collapsed and expanded DOM position automatically | **yes** — this is the one genuine dependency case |
| `FloatingDock` | a `MotionValue` tracks `mouseX`; each icon computes `distance = mouseX - iconCenterX` and maps it to a scale transform | reimplement — this is exactly the delegated-pointer/CSS-custom-property pattern in §6.2, just applied to `scale` instead of tilt |
| `ResizableNavbar` | scroll-position state toggles a `visible` prop that Motion animates between two width/padding presets | reimplement in CSS — a scroll listener + a class toggle |
| `StatefulButton` | idle → loading (spinner swaps in) → success (checkmark) state machine, `onClick` accepts `() => void \| Promise<void>` | reimplement — **confirmed live in the reference video itself** (§9c below), a plain CSS/JS state machine |
| `AnimatedTooltip` | hover reveals a name/title tooltip that **follows the cursor**, via mouse-position state | reimplement — CSS `:hover` + the same delegated pointer pattern |
| `BackgroundGradientAnimation` | 5 absolutely-positioned blurred gradient blobs, three keyframe animations (`moveHorizontal` 40s, `moveInCircle` 20–40s, `moveVertical` 30s), `mix-blend-mode: hard-light` | **no dependency at all** — pure CSS keyframes, confirmed on the docs page itself |

**Revised conclusion:** only `ExpandableCard`'s shared-layout transition needs `motion`.
Everything else is confirmed CSS-expressible from the vendor's own documented mechanism,
which sharpens §11's dependency case — `motion` earns its install for exactly one
component, not as general-purpose animation infrastructure. All seven ship via Aceternity's
`shadcn` CLI (`npx shadcn@latest add @aceternity/...`); this repo has no shadcn
configuration, so components are **hand-ported from the fetched source**, not
CLI-installed — consistent with the rest of the kit being hand-rolled.

**AnimatedTooltip and StatefulButton are not merely "worth considering" — the reference
video shows both directly.** See §9c.

---

## 9. The pocket — preserved, then extended

### 9.1 What survives untouched

The geometry is entirely palette-independent and does not change: `.pocket`'s `padding-top`,
`.pocket__papers`' absolute box, `.pocket__paper`'s `46×34` sheets with
`transform-origin: bottom center`, the `--paper-i` index custom property, and the hover
fan `translateX(calc(var(--paper-i) * 26px)) translateY(-3px) rotate(...)`.

**Only three declarations are palette-dependent** and they change values, not structure:

- `.pocket__paper` `background: var(--surface-raised)` → `var(--surface-2)`
- `.pocket__paper` `border: 1px solid var(--border-strong)` → retinted automatically
- `.pocket__card`'s radial status wash `color-mix(… var(--pocket-tone) 14% …)` → the tone
  tokens retint; the 14% figure may need a nudge on a cooler ground.

### 9.2 The four extensions — all have real data

Verified against the schema in `lib/db.ts`:

| Pocket | Slips | Table |
|---|---|---|
| Product | its batches | `batches` |
| Customer | open orders + unpaid cheques | `orders`, `cheques` |
| Delivery run | its stops | `delivery_stops` |
| Saved list | member customers | `lead_lists` / `lead_list_items`, `saved_locations` |

The governing rule holds in every case: **slip count is the real count, capped at 3.** An
empty pocket is a legitimate empty state — which incidentally gives the "Coverage Map →
Selected List" fix a free visual for "this list has nothing in it."

### 9.3 Continuity: the modal rises out of the stack

Clicking a pocket card currently fades a modal in over the board. Instead: the slips fan,
and the card itself scales and rises into the modal position with the tilted 3D entrance
the video uses. One gesture, one motion. This is the one place `ExpandableCard`'s
shared-element technique earns its dependency.

---

## 9a. The shell — single navbar + left rail

Read directly off the 00:11 frame.

### Single navbar — one row, not two

The video is LTR: logo → menu → avatar, left to right. **This app is RTL Persian, so the
layout is not a position-for-position copy — it is mirrored by *logical* role, not by
literal left/right.** Brand sits at inline-start (which resolves to the **visual right**
under `dir="rtl"`); the utility cluster sits at inline-end (**visual left**):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ روت‌فلو ◈    گزارش‌ها [پرونده‌ها] تقویم سرنخ‌ها فرصت‌ها ارتباطات │●bell○share○search○│
└──────────────────────────────────────────────────────────────────────────┘
  visual right = inline-start                          visual left = inline-end
```

Built entirely with logical CSS (`justify-content` on a `flex` row with the brand and
utility cluster as the two ends, nav centred) so the same markup mirrors correctly if a
future LTR locale is ever added — never a hardcoded `left:`/`right:`. The active nav item
is a **solid near-black pill** — the same `--primary` fill as the primary button, which is
what ties the nav to the action language.

This replaces `components/kargah/Chrome.tsx`, which is currently a *two-row* sticky
header (brand bar + both nav rows). Collapsing it to one row is the brief's
*"re-architect the main header row so that the primary menu is aligned alongside the site
branding and user profile."*

Nav dropdowns and the profile menu open on **hover**, not click (also from the brief).

### Left icon rail

A narrow vertical rail of circular icon buttons, flush to the inline-start edge, below the
navbar. Top: a back chevron in its own circle, visually separated. Middle: the app's
verbs — share, export, star, add, mobile, data, calendar, send, alerts (the alerts icon
carries a small red dot when unread). **Bottom: the theme control** — the video puts a
moon and a filled sun-disc at the foot of the rail, which is exactly where decision 9's
three-state auto/light/dark control belongs.

`FloatingDock`'s magnification-on-proximity is the one Aceternity behaviour that maps here,
and it is hand-rollable — a `pointermove` on the rail writing a distance-derived scale to
each button as a custom property, same delegated pattern as §6.2.

**Notch:** the rail's active item seats into a notch cut from the content area's edge, so
the selected icon reads as *part of* the page rather than floating over it.

## 9b. Bento grid

The frame shows the layout rule plainly: the journey card spans full width; beneath it a
**wide table card** ("Suggested Knowledge") sits beside a **narrower chart card**
("Support Ticket Journey"). Unequal widths, one row, consistent gutters.

This is a real system, not ad-hoc widths:

```css
.bento { display: grid; grid-template-columns: repeat(12, 1fr); gap: var(--space-5); }
.bento > * { grid-column: span 12; }                    /* phone: stack */
@media (min-width: 900px) {
  .bento > [data-span="full"] { grid-column: span 12; }
  .bento > [data-span="wide"] { grid-column: span 7; }
  .bento > [data-span="half"] { grid-column: span 6; }
  .bento > [data-span="narrow"]{ grid-column: span 5; }
}
```

`components/BentoStrip.tsx` already exists and is the starting point. The brief's
complaint about *"full-width cards with ~90% empty white space"* and *"card widths on the
My Day page over-expanding"* is exactly what a real span system fixes.

Every tile is a `NotchedCard`. Every tile's header gets the `(i)` help trigger the brief
asks for, seated in the notch.

## 9c. The connector system — a workflow editor, not decoration

**This section was rewritten after re-watching the video frame-by-frame for
interaction, not just anatomy.** The first pass under-read it: the connectors are not a
static diagram, and "New Tasks" is not a fourth pipeline stage. Watched closely, the
screen is a **node-link workflow editor** — the drag-and-drop workflow the user's brief
names explicitly — and two Aceternity components the user picked are visible *live in the
reference itself*, not merely candidates for it.

### What the frames actually show, second by second

- **00:00–00:09** — a Kanban of case cards. Clicking a card's `⋯` opens the Processing
  modal. Inside it: a text field taking live keystrokes, a **budget slider whose readout
  updates on every drag tick** (22,500 → 24,985), and a primary button that visibly runs
  **idle → spinner → (implied) success** before the modal closes — this *is*
  `StatefulButton`, confirmed on screen, not inferred from the component's docs.
- **00:07–00:09** — a second modal, "Add New Case": the Responsible Team field opens a
  dropdown, each row a team with an avatar cluster; selecting one collapses the dropdown
  and updates the field.
- **00:10 →** — the view becomes "Customer Journeys": a row of team avatars along the top,
  each carrying a small numeric badge (unread/assigned count), then three columns below:
  **Issue Identification**, **Technical Resolution**, and **New Tasks**.
- **Clicking an avatar in the top row** pops it (scale-up, the exact interaction
  `AnimatedTooltip` documents — a hover-reveal that tracks the cursor) and an **animated
  highlight traces down** through that person's task rows across both stage columns. This
  is a live filter/trace gesture, not a static assignment.
- **The "New Tasks" column is a template palette, not a stage.** Its six cards — *Request
  Processing, Problem Resolution, Customer Communication, Testing and Verification,
  Customer Notification, Customer Satisfaction* — are small, label-only, avatar-less. They
  read as a library of reusable next-step types, not tasks already in flight.
- **The link-creation gesture:** hovering the `⋯` on "Estimate Resolution Time" (in
  Technical Resolution) draws a line toward "Request Processing" in the template column;
  on completion, that target card **fills solid black** — an activated/selected state — a
  new task has been instantiated from the template and wired to the source task as its
  next step.
- Existing edges: **solid blue** for resolved paths, **dashed pink/red** for pending ones,
  both terminating in small circular nodes on each card's edges. Unassigned task rows show
  a `+` circle in place of an avatar with muted text.

### Revised anatomy for implementation

- Each stage is a white rounded container, its label centred and muted *below* it.
- Circular **ports** sit on the inline edges of each row, one per task.
- Cubic-bezier edges connect ports across the column gutter, horizontal control points.
- Solid = resolved, dashed = pending; both terminate in a filled circular node.
- Unassigned rows: `+` in place of the avatar, muted label text.
- The template column's cards are visually distinct — smaller, centred label, no avatar,
  no port on their outward edge (nothing connects *out* of an unstarted template).

### Interaction model to build

1. **Trace-on-click.** Clicking a top-row avatar highlights (colour + a subtle glow, using
   the §6.2 delegated-listener machinery already built for tilt) every port and edge
   touching that person's rows, and dims the rest. This is `AnimatedTooltip`'s
   hover-pop-and-track behaviour repurposed as a selection gesture, not literally its
   tooltip — build it as a `TracedAvatar` primitive: pop-on-hover, click-to-pin the trace.
2. **Link-drag from an existing task to a template.** `pointerdown` on a task row's `⋯`
   begins a drag; a live bezier follows the pointer; `pointerup` over a template card
   commits the edge and instantiates a real task from that template, which fills solid
   black to confirm. This reuses the exact `setPointerCapture` discipline
   `OrderPipeline.tsx:122` already has for board dragging — same primitive, new target.
3. **`StatefulButton` is not optional-nice-to-have** — it is what "Take for Processing" and
   "Add Case" already do in the reference, and belongs on every primary action that hits
   the network: order confirmation, payment allocation, case creation.

### Rendering

One absolutely-positioned SVG overlay per journey, sized to the container,
`pointer-events: none` except while a drag is live, sitting *behind* the stage cards. Port
positions come from `getBoundingClientRect` relative to the container, recomputed on
`ResizeObserver` and `document.fonts.ready` — the same discipline `CarvedCard` already
uses and for the same reason (Persian glyph metrics move the boxes after the webfont
lands).

```
M x1,y1  C x1+k,y1  x2-k,y2  x2,y2      k = (x2 - x1) * 0.5
```

**RTL:** the flow runs right-to-left, so `k` is negative and column order reverses. The
direction must be derived from the resolved `dir`, never hardcoded — the same discipline
as the navbar fix in §9a.

Pending edges: `stroke-dasharray`, `stroke: var(--crit)`. Resolved edges:
`stroke: var(--accent)`. Under `prefers-reduced-motion`, the draw-on and the drag-preview
still function (they are the interaction, not decoration) but the ambient trace/glow
animation is skipped.

## 9d. Backend — what "front and backend" actually requires

Two genuine gaps, both verified against `lib/db.ts`:

### Profile pictures — no schema exists

`users` ([lib/db.ts:887](../../lib/db.ts#L887)) has `display_name` but **no avatar
column**. The `photos` table ([lib/db.ts:736](../../lib/db.ts#L736)) has a usable
`file_stem` storage pattern but its CHECK constraint is
`entity_type IN ('district', 'customer')` — it cannot hold a user avatar without being
altered.

The reference leans on faces everywhere: the navbar profile, the avatar row above the
journey, per-task avatars, avatar stacks with numeric badges. Mock avatars will not carry
it.

**Required:** add `'user'` to the `photos` CHECK constraint (reusing the existing storage
and upload path rather than inventing a second one), an upload endpoint with image
resizing via the already-installed `sharp`, and a fallback initials-monogram avatar in the
new palette for users with no picture. The brief's *"assign realistic AI-generated avatars
to demo users"* then becomes a seed-script concern, not a UI fake.

### Drag-and-drop workflow editor — bigger than first assessed

`OrderPipeline.tsx:122` already uses `setPointerCapture`, so pointer-based dragging is
real and touch-capable — that part transfers directly to the link-drag gesture in §9c.

What does not exist, now that §9c's re-watch corrected the interaction model, is **three**
things, not one:

1. **The edge graph.** `tasks` and `order_events` exist; a task→task edge does not.
   Needs a `workflow_edges` table: `from_task_id`, `to_task_id`, `state`
   (`resolved`/`pending`), timestamps.
2. **The template library.** The "New Tasks" column's six cards (Request Processing,
   Problem Resolution, Customer Communication, Testing and Verification, Customer
   Notification, Customer Satisfaction) are reusable step *definitions*, instantiated into
   a real task when linked. **Settled: fixed, app-wide, seeded — no admin CRUD.** A plain
   lookup table:
   ```sql
   CREATE TABLE workflow_step_templates (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     key TEXT UNIQUE NOT NULL,
     label_fa TEXT NOT NULL,
     default_stage TEXT NOT NULL
   );
   ```
   seeded once with the six (or however many are decided at build time), no permission
   model, no per-org scoping.
3. **Instantiation-on-link.** The `pointerup`-over-template endpoint has to, in one
   transaction: create a `tasks` row from the template, create the `workflow_edges` row
   connecting the source task to it, and return both so the client can render the new port
   and fill the card solid without a full board refetch.

**Settled: this is a new module, not a change to `OrderJourney.tsx`.**
`components/sales/OrderJourney.tsx` carries an explicit, deliberate invariant — its own
comment: *"Read-only, and that is the design... A tick anyone could toggle here would be
a second record of whether the goods went out, and it would disagree with the invoice the
first time it was used."* The video's live drag-to-link editor is the opposite of that —
a user-editable graph — and retrofitting it onto the order journey would break a real
architectural guarantee for no good reason. The video's "Cases" domain is generic
case/task management, not order fulfilment; RouteFlow's equivalent is a **new
`/sales/tasks` workflow board**, wired to `tasks` + `workflow_edges` +
`workflow_step_templates`. `OrderJourney.tsx` is not touched by this work at all.

This is real backend work — a new graph model, not a styling pass — and is sized as its
own sequence step (§17, split into 6a/6b/6c).

---

## 10. Brand mark, icons, splash

There is no logo. `public/icon.svg` is a placeholder (navy square + cyan diamond, both
colours now dead) and `app/favicon.ico` is still Next.js's stock file — same Aug 14
scaffold timestamp as `next.svg` and `vercel.svg`.

**Concept:** the mark *is* the notch. A near-black rounded square (`--radius-2xl` scaled)
with the signature bay subtracted from one corner, and a single route-line or chevron
seated in the bay. It reads at 16px because it is a silhouette, not a drawing, and it
teaches the notch on first sight.

**Deliverables:** `app/icon.svg`, `app/apple-icon.png` (180×180), `app/favicon.ico`
(32+16), maskable 512×512 for PWA, plus fixes to `app/manifest.ts` (still
`background_color: "#0A0E14"`) and the root `<title>` in `app/layout.tsx` (still the stale
«نقشه پوشش مشتریان»).

**The mark gets user approval before it ships.**

---

## 11. Dependencies

Checked against the npm registry today (2026-09-08):

| Package | Latest | Published | Verdict |
|---|---|---|---|
| `motion` | 13.2.0 | 2026-09-02 | **install** — successor to framer-motion, 6 days old |
| `lucide-react` | 1.43.0 | **2026-09-08** | **install** — published today |
| `clsx` | 2.1.1 | 2024-04-23 | **install** — mature, stable, universal |
| `tailwind-merge` | 3.6.0 | 2026-05-10 | **install** — needed for `cn()` |
| `class-variance-authority` | 0.7.1 | 2024-11-26 | **skip** — 22 months stale, and the kit's variants are simple enough for plain props |
| `cmdk` | 1.1.1 | 2025-03-14 | **defer** — belongs to the command-palette sub-project |

```
npm i motion lucide-react clsx tailwind-merge
```

`framer-motion` and `motion` both publish 13.2.0 on the same date; `motion` is the current
name. Both are healthy — this is the actively-maintained, famous-library bar the user set.

**Not recommended:** a chart library. `components/charts/` already works and the arc gauge
is ~30 lines of SVG. **Not recommended:** `react-countup` — `CountUp.tsx` already exists.

---

## 12. MASTER.md rewrite

| Section | Fate |
|---|---|
| Product shape | survives |
| **Visual thesis** | **replaced** by §3 |
| Interaction thesis | rewritten — tilt/glow/glass are now the interaction language |
| **Theme architecture** | **rewritten** — light is default; the self-contradiction is resolved |
| **Color** | **replaced** by §4 |
| **Elevation** | **replaced** by §4.3 — adds inset highlights |
| Typography / Spacing | survive |
| **Radii** | updated (§4.4) |
| **Motion** | **rewritten** — the spring/hover bans die outside `/driver`; the perf budget is added |
| Base components | rewritten as the kit (§8) |
| CRM/ERP patterns | mostly ships; pocket section extended (§9) |
| **Anti-patterns** | the Lucide exclusion and spring bans deleted; reduced-motion and contrast rules kept |
| Not yet decided | icon set resolved → Lucide |

---

## 13. Migration risk

**The app is not shipped.** That removes the largest constraint the first draft was
written around — there are no real users, no stored preferences to preserve, and no
production data to protect. Breaking changes are cheap right now and will not be later,
which argues for doing the structural moves (§2 promotion, attribute collapse, accent
retirement) **now rather than incrementally**.

What still needs care:

1. **The `data-theme` polarity inversion.** Dark is currently the *absence* of the
   attribute; after this, light is. `THEME_INIT_SCRIPT` is blocking-before-paint precisely
   to avoid a wrong-theme flash — it must change in the same commit as the CSS, or every
   load flashes. `data-skin` collapses into `data-theme` at the same time.
2. **Contrast is only partly verified.** §4's figures are hand-computed for the critical
   text pairs; status colours are not computed at all. `npm run check:contrast` must pass
   before merge, and the script itself may need updating if it has token names baked in.
3. **No test baseline established.** Run the suite *before* touching anything, so failures
   this work causes are distinguishable from failures already present.
4. **The backend work in §9d is not styling.** User avatars need a schema change and an
   upload path; the workflow graph needs new tables. Size and sequence these separately —
   folding them into a theme pass is how a theme pass becomes a three-week project.
5. Deployment remains `npm run build` + `systemctl restart routeflow`.

---

## 14. Out of scope — deferred, must stay unblocked

Route migration for the remaining pages · the `loading.tsx` / `<Suspense>` /
`next/dynamic` / `Promise.all` speed work · command palette · hotkeys · Login-As · error
pages and boundaries · contextual help · map/GIS cleanup · CRM workflow gaps · logistics
polish (vertical timeline, Lottie empty states) · calendar/weather · the i18n sweep.

The shell (§9a), bento (§9b) and connectors (§9c) are **no longer deferred** — see the
scope correction in §1.

---

## 15. Decisions — all settled

| # | Question | Answer |
|---|---|---|
| 1 | Accent themes | **Retired** (§4.6) |
| 2 | `THEME_KEY` rename | **Migrated** — app not shipped, nothing to preserve |
| 3 | `/driver` theme | **Auto everywhere, pinned in `/driver`** (§4.5) |
| 4 | Navbar mirroring | **Fixed** — logical properties, brand at inline-start (visual right under RTL) (§9a) |
| 5 | Workflow editor's home | **New `/sales/tasks` module; `OrderJourney.tsx` untouched** (§9d) |
| 6 | Template steps | **Fixed, app-wide, seeded — no admin CRUD** (§9d) |

No open questions remain.

---

## 16. Honest gaps in this document

The 28-agent research run died on a session limit before returning anything on the first
attempt. Rather than re-run it, the research was done directly: the video was re-watched
frame-by-frame at 0.3s resolution specifically for interaction (not just anatomy), all
seven Aceternity components were fetched and their mechanisms confirmed from source
documentation, `corner-shape` browser support was verified by search, and the repo's own
files (`carve.ts`, `CarvedCard.tsx`, `OrderPipeline.tsx`, `lib/db.ts`'s schema,
`gen-accent-themes.mjs`, npm registry for every dependency) were read directly. What
remains genuinely unverified:

- Performance numbers in §7 are **reasoned, not measured** on real hardware.
- Status-colour contrast in §4.1 is **not yet computed** (text-colour pairs are).
- §9a/§9b's exact spacing and type scale are estimates from a still frame — legible
  anatomy, imprecise geometry.
- §9d's `workflow_edges` / `workflow_step_templates` shape is proposed, not built against
  a finished migration.
- Question 5 above (fixed vs. per-org templates) blocks finalising the template schema.

None of these change the shape of the plan; they are implementation-time verifications.

---

## 17. Suggested sequence

The work now spans styling, a shell rebuild, and a genuine backend feature (the workflow
editor), so it should not land as one commit — and should not be sequenced as one
undifferentiated "backend" step, which the first draft of this table understated.

| Step | What | Why here |
|---|---|---|
| 1 | Test baseline + `check:contrast` baseline | so later failures are attributable |
| 2 | Substrate: repalette, promote `.kargah` → `:root`, retire accents, theme rewrite (incl. auto/light/dark, §4.5) | everything else reads these tokens |
| 3 | Notch system + skeuomorphic devices (§5, §6) | the kit's foundation |
| 4 | Kit primitives incl. `StatefulButton`, `TracedAvatar`, `FloatingDock` mechanics (§8) | shell and journey are both built from these |
| 5 | Shell: navbar (RTL-correct, §9a) + rail + bento (§9b) | every page gets a home |
| 6a | Backend: user avatars — schema + upload path (§9d) | independent, unblocks avatar UI everywhere |
| 6b | Backend: `workflow_edges` + `workflow_step_templates` + instantiate-on-link endpoint (§9d) | needs Q5 answered first |
| 6c | Backend: task→stage assignment on `tasks` | needed for the board itself, not just connectors |
| 7 | Journey UI: `JourneyGraph` render + trace-on-click + link-drag gesture (§9c) | depends on 4, 5 and 6b/6c together |
| 8 | Brand mark + icon set + splash (§10) | independent; can slot in anywhere after 2 |
