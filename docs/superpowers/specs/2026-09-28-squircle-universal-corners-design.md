# Squircle corners, everywhere — design

**Date:** 2026-09-28
**Status:** approved, ready for plan
**Supersedes:** the superellipse block in `app/globals.css:4746-4771`

## Principle

**One corner shape for every user, on every browser.** Today the app has two: Chromium gets a
superellipse, Firefox and older Safari get a plain circular arc. The two do not match, and
neither is a squircle. This makes them match — and fixes the fact that the Chromium one is
currently concave, which is a bug, not a style.

## Locked decisions

1. **Exponent = `superellipse(1.5)`.** Measured at 1.11× a true circle's corner area — a
   visible, unmistakably squircle. Not `0.6` (see Defect below), not `2` (too boxy).
2. **Strategy = native `corner-shape` + JS `clip-path` fallback.** `corner-shape` has no
   polyfill, and every universal squircle technique is ultimately a clip. Chromium keeps the
   native path and pays zero JS.
3. **Scope = the `.meridian` skin only.** `.tapflow`, `.pocket`, `.kargah` and the bare map
   chrome keep plain radii. One skin landed correctly beats three landed badly; the others are
   a separate, later pass reusing this machinery.
4. **Popovers are portalled.** `.modal`, `.sheet` and form cards hosting a picker/menu become
   `createPortal(..., document.body)` so the dropdown escapes the clip. Uniform corners wins
   over "no popovers in dialogs".
5. **The surface list becomes the attribute `data-squircle`** — not a class list. One
   declaration, read by both the CSS engine and the JS.
6. **A `?force=1` / `localStorage` switch forces the fallback on Chromium.** Without it the
   entire fallback is unviewable on 71% of machines and therefore unmaintainable.

## Defect found while designing this

The existing comment at `app/globals.css:4766-4768` states:

> *"0.6 is the mild end of the range. Anything past ~1.0 reads as a lozenge."*

**This is backwards and the shipped value is concave.** Measured by rendering corners in
Chromium 151 via Playwright + sharp (screenshot → trace the corner → integrate its area,
sanity-checked to 100.0% against the exact quarter-circle):

| `corner-shape` | corner area vs. a true circle | shape |
|---|---|---|
| `superellipse(0.6)` — **shipped today** | **0.878×** | **scooped inward (concave)** |
| `superellipse(1)` | 1.000× | circular |
| `superellipse(1.5)` — **target** | 1.110× | squarer |
| `superellipse(2)` | 1.181× | squarer |
| `superellipse(4)` | 1.266× | squarest |

The exponent runs the opposite way from the comment's assumption: below 1.0 Chromium *removes*
material from the corner, denting it inward, rather than rounding more gently. All ~119
meridian surfaces currently render with scooped corners on Chromium while Firefox users see
plain arcs. Nobody noticed because both read as "some kind of rounded corner."

**Consequence:** this is a correctness fix, not a polish pass, and it gives the fallback a
concrete, measurable target.


## Why a clip is unavoidable

`corner-shape` is the only declarative route and it is not yet Baseline. Support as of
Aug 2026 (caniuse, 71.02% global):

| Browser | Supported from |
|---|---|
| Chrome / Edge | 139 (Aug 2025) |
| Chrome Android, Opera, Samsung | 139 / 123 / 30 |
| Safari | 27.1 (Technology Preview at time of writing) |
| Firefox | not shipped; 156/157/158 all lack it |

So ~29% of users have never seen a squircle here. Every fallback technique is a clip
(`clip-path` or `mask-image`), and this repo's CSS already documents the cost twice:

- `app/globals.css:821` — "a clip-path cuts the box-shadow off with everything else outside
  the shape"
- `app/globals.css:2398` — "clip-path clips descendants, so tabs inside would be erased by the
  bay meant to hold"

There are 132 `box-shadow` declarations, 29 `overflow: hidden`, and 17 components with
`position: absolute` popovers that a blanket clip would damage. Hence decisions 3 and 4.

## Architecture — one list, two consumers

```css
/* native path: one attribute replaces the 13 hand-written selectors */
@supports (corner-shape: superellipse(1.5)) {
  [data-squircle] { corner-shape: superellipse(1.5); }
}
```

Three units, each with a single job:

| Unit | Responsibility | Depends on |
|---|---|---|
| `[data-squircle]` attribute | declares "this surface is a squircle" | nothing |
| `lib/squircle.ts` | pure geometry + feature detect | nothing |
| `components/meridian/SquircleFallback.tsx` | observe, measure, write `--sq-clip` | `lib/squircle` |

```ts
// lib/squircle.ts
export const supportsCornerShape = (): boolean =>
  typeof CSS !== "undefined" && CSS.supports("corner-shape", "superellipse(1.5)");

export function superellipsePath(w: number, h: number, r: number): string;
```

`SquircleFallback` mounts once in `AppShell`:

1. `supportsCornerShape()` → `true` ⇒ render `null`. Chromium pays nothing.
2. Otherwise collect `[data-squircle]`, skipping any element whose computed `border-radius`
   resolves to 999px (or any radius ≥ half the element's shorter side, which is a pill by
   another name).
3. Per element: read the computed radius, write `--sq-clip: path("...")`.
4. `ResizeObserver` per element, recomputing on width/height change only.

Two rules keep the geometry honest:

- **`border-radius: 999px` is skipped.** A squircle at a full semicircle is invisible; clipping
  there is pure cost. Pills stay pills (`app/globals.css:4750` already argues this).
- **Radius comes from the cascade, not from JS constants.** The fallback reads
  `getComputedStyle().borderRadius`, so every surface keeps its existing per-token radius and
  the JS never needs to know `--r-md` exists.

The 13 existing selectors are converted to the attribute; the other ~106 usages receive it in
the same pass, so coverage stops being a hand-maintained list. Of the 13, twelve are actually
used (`.pagehead` matches no usage today but is kept, since it is clearly intended for page
headers still to be built); the manual pass in Verification therefore covers **twelve** surfaces.

## Fallback mechanics

`superellipsePath(w, h, r)` returns a `path()` string of four cubic beziers, one per corner,
with control points from the standard continuous-corner construction, fitted so the rendered
corner area matches the measured `1.5` target. It is pure and DOM-free, which is what makes the
calibration testable.

Three consequences the implementation must honour:

- **Box-shadow dies on a clipped element.** The 11 surfaces carrying `box-shadow` switch to
  `filter: var(--card-drop)`, a pattern already built at `app/globals.css:1648` and shipped on
  `.cradlecard` (2345) and `.phc` (2383). `filter` also creates a stacking context and a
  containing block; that is the riskier of the two, and it is already proven in-repo.
- **Popovers are portalled** to `document.body` (decision 4). Largest single change in the
  project; gets its own pass.
- **Reduced motion:** `clip-path` is static, so the RevealRoute spring cascade is unaffected.
  The observer must ignore transform-only changes or the entrance animation will thrash it.

## Verification

The native side is directly testable, not merely assertable — Chromium 151 is installed locally
and Playwright is already a devDependency.

1. **`tests/squircle.test.ts`** — `superellipsePath()` on known `w/h/r`; asserts the 999px
   skip, the attribute contract, and that radius is read from the cascade rather than hardcoded.
2. **Geometry calibration test** — renders `superellipse(1.5)` in Chromium, measures corner area
   with the same harness, asserts the fallback path lands within **±2% of the native corner
   area** (1.110× of a circle; a band narrow enough to catch a wrong exponent, wide enough not
   to fail on sub-pixel rasterisation). This is what keeps Firefox and Chromium honest as the
   exponent changes.
3. **`?force=1`** forces the fallback on Chromium so the clipped path is inspectable in the
   browser you actually use (decision 6).
4. **Manual pass** over the 12 surfaces, concentrating on the popovers, the 11 box-shadow
   surfaces, and picker-inside-modal — which no unit test will catch.

## Risks

| Risk | Mitigation |
|---|---|
| `filter: var(--card-drop)` changes stacking/containing block | Already ships on two surfaces; manual pass covers them |
| Portal porting breaks picker positioning/scrims | Its own pass; manual pass on JalaliDatePicker, AccentPicker, FontPicker |
| 119 surfaces is a wide diff | Attribute conversion is mechanical and reviewable per surface |
| Slightly different rendering between engines | Tolerance-based calibration test, not eyeballing |

## Out of scope

Non-meridian skins; controls (buttons, inputs, tabs) which are still on plain arcs and would be
a separate pass; the `superellipse` shape for map markers.

