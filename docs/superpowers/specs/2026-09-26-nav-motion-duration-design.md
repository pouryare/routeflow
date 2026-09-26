# Nav motion: one duration, two curves

**Date:** 2026-09-26
**Status:** approved, ready for plan
**Touches:** the shell's nav popover, the card help popover, the auto-hiding top chrome

## The problem

Two motions in the shell open and close, and both read as a snap rather than a
move.

**The nav popover** (`components/meridian/HoverPill.tsx` → `.seg-pop`) travels
`y: -4` over 300ms. Four pixels is nearly a pure fade, so the panel arrives
without ever appearing to travel. Its exit is 120ms against a 300ms enter — an
asymmetric dismissal that reads as the panel being flung away.

**The auto-hiding chrome** (`components/meridian/Chrome.tsx` → `.meridian .chrome`)
travels its full height (`translateY(-100%)`, ~64px) over 320ms on `--ease`. The
duration reads generous; the curve does not. Measured, `--ease-out`
(`cubic-bezier(0.16, 1, 0.3, 1)`) puts that bar **89% of the way at 100ms** and
visually finished by ~160ms. The last 160ms is dead time. The motion is abrupt
because it is front-loaded, not because it is short.

The two are written in different systems — the chrome is pure CSS reading
`--dur-*` / `--ease-*` custom properties, the popover is `framer-motion` reading
`DUR` / `EASE` in seconds from `lib/motion.ts` — so they do not currently feel
related even where their numbers happen to agree.

## The design

**One declared duration, shared. The curve is chosen per travel distance.**

Overshoot is a function of travel, not of the curve. `--spring-pop`'s ~13% peak
is a 1px whisper on a 10px rise and a 6px bounce on a 64px slide. So the two
motions share the *duration* and differ in *curve*: overshoot where travel is
short and the arrival is an entrance, none at all where travel is long and a
bounce would read as broken.

| | travel | duration | curve | effect |
|---|---|---|---|---|
| Nav popover (enter) | 10px | `--dur-panel` 400ms | `--spring-pop` | 0.98px overshoot — a whisper |
| Card help panel (enter) | 10px | `--dur-panel` 400ms | `--spring-pop` | same preset, unchanged call site |
| Nav / help panel (exit) | 10px | 200ms | `--ease-out` | no overshoot; a dismissal must not bounce |
| Auto-hiding chrome | 64px | `--dur-panel` 400ms | `--ease-glide` (new) | spread across the window; peak exactly 100% |

### The chrome's new curve

`--ease-glide: cubic-bezier(0.25, 0.8, 0.3, 1)`. Progress over the 64px travel:

| ms | 50 | 80 | 100 | 160 | 240 | 400 |
|---|---|---|---|---|---|---|
| now (`--ease-out` @320ms) | 66% | 83% | 89% | 97% | 100% | — |
| new (`--ease-glide` @400ms) | 39% | 58% | 68% | 87% | 96% | 100% |

Front-loaded enough to answer the scroll, gentle enough to keep travelling.
`--ease-out` is retained everywhere else; this curve exists because this element
travels far enough that a curve tuned for a 10px rise reads as a slam.

### Why the panel's exit does not overshoot

A dismissal that overshoots reads as a panel that has not left yet. Measured,
`--spring-pop` on exit peaks at 10.98px of a 10px travel — it visibly bounces
back off its own resting place. Exit therefore uses `--ease-out`, which peaks at
exactly 10.00px.

The cost is real and is accepted deliberately: pointer-leave to gone goes from
**180ms grace + 120ms exit = 300ms** to **180ms + 200ms = 380ms**. That is 80ms
more lag on every dismissal, which is the price of a longer closing animation.
`CLOSE_DELAY_MS` stays at 180ms rather than rising, to keep that total honest.


## Files

| File | Change |
|---|---|
| `app/globals.css` | Add `--dur-panel: 400ms` and `--ease-glide: cubic-bezier(0.25, 0.8, 0.3, 1)` to the `:root` motion block. `.meridian .chrome` → `transition: transform var(--dur-panel) var(--ease-glide)`. |
| `lib/motion.ts` | `DUR.panel = 0.4`. The `popover` preset becomes: `initial { opacity: 0, y: -10 }`, `animate` → `DUR.panel` on `EASE.pop`, `exit` → 200ms on `EASE.out` (this module is in **seconds**, so the exit duration is written `0.2`; do not add a `DUR` entry for it, as 200ms is the exit's own value, not a tier). |
| `MASTER.md` | Add the `--dur-panel` and `--ease-glide` rows to the Motion tables. Record the driver-mode exception (below). Note that the chrome and the panels share one duration. |
| `tests/motion.test.ts` | Assert `DUR.panel === 0.4`; assert `--dur-panel: 400ms` and the glide control points appear in `app/globals.css`; assert the preset travels 10px and its exit is not `DUR.fast`. |
| `components/meridian/HoverPill.tsx` | **Unchanged.** |
| `components/meridian/CardHelp.tsx` | **Unchanged.** |

Both consumers keep reading `popover.initial / animate / exit`, so correcting the
preset corrects the nav menu and the card help panel together, and any future
popover inherits the treatment for free. No component call site moves.

## The driver-mode exception

MASTER.md bans overshoot in driver mode "entirely." The nav popover is reachable
while driver mode is active: `CoverageMap` toggles `driver-mode` on `<html>`, it
renders on `/map`, and `/map` is a shell page whose header contains the popover.
The existing `.driver-mode aside …` rules scope only to the Leaflet sidebar, so
nothing suppresses the header today.

**Decision: document the exception rather than guard it.** The shell header is
chrome that the driver reaches only by scrolling up out of the map — it is not
the driver's screen, and the map itself (markers, controls, the bottom bar) keeps
every rule MASTER.md gives it. The exception is recorded against the header
popover *by name*, not against "the shell," so it cannot later be read as
permission to overshoot elsewhere in the chrome.

## Edge cases

**Reduced motion** — unaffected, and the longer duration cannot leak past either
gate. The CSS `@media (prefers-reduced-motion: reduce)` block at
`app/globals.css:2129` zeroes the chrome transition independently of duration,
and `withReducedMotion` collapses the framer transitions to `{ duration: 0 }`.

**Touch** — the popover opens on first tap (`canHover()` is false) and reads the
same preset. The longer travel is legible on a touch device.

**Scroll logic** — unchanged. `Chrome.tsx` only toggles a class; all geometry
stays in CSS. Its hysteresis (`DOWN_PX = 12`, `UP_PX = 6`) commits before any
motion begins, so the slower curve never delays the trigger's response.

**Known risk, accepted** — `--ease-glide` starts slower than `--ease-out` (25px
vs 42px in the first 50ms), and the bar is scroll-triggered, so it could read as
laggy. Two things defuse it: the hysteresis above, and glide still crosses 50% at
~65ms, inside the ~100ms window where a delay stops being perceptible. **If it
still feels laggy on a real device, shorten `--dur-panel` to 360ms** — a one-token
change, which is the reason the duration lives in a variable.

## Verification

`npm run test:unit` proves the mirror: that `DUR.panel` and the CSS tokens agree,
and that the preset's travel and exit duration hold.

The feel is not a boolean and no test asserts it. After the unit gate, open
`/sales/dashboard` in a browser and hover a group chip and scroll the page,
comparing against the progress tables above.

**No Playwright assertion on the animation itself.** The smoke suite proves
layout (`.chrome .top .seg-groups` shares a line with `.topright`); asserting on
a 400ms transform would be a timing-dependent flake. The repo's precedent is
geometry in the browser, values in unit tests, and this follows it.

## Not in scope

- The travelling thumb (`.seg.ready .thumb`, 520ms on `--spring`) — a third
  motion in the same row, already the slowest there, and neither opening nor
  closing.
- A choreographed stagger inside the popover. Rejected during design as a second
  mechanism rather than a retiming.
- Driver-mode code. See the exception above.
