# MASTER — Coverage Map Design System

Canonical source of truth. Every color, font, spacing, radius, shadow, and motion
value used in the app comes from this file. No magic numbers in components.

## Visual thesis

A dark, near-black radar-console interface where the map is the uncontested hero
and the UI chrome recedes to thin, crisp borders; status colors (visited /
needs-coverage / not-allowed) glow like radar blips against the dark canvas while
a single cyan accent marks interactive UI; Vazirmatn carries all Persian text, a
monospace face carries numbers/coordinates for a telemetry feel; spacing is dense
and information-rich in the sidebar but generous around the map itself;
components are flat with crisp edges and glow-based elevation instead of drop
shadows.

## Interaction thesis

Fast, precise transitions (150–300ms, sharp ease-out, no bounce/elastic);
interactive elements respond with a subtle glow-intensify + slight scale (1.03)
on hover; customer markers carry a recurring soft radar-ping pulse as their idle
state so the map always feels "live"; panel/modal transitions are quick
fades/slides, no scroll-driven parallax gimmicks; everything degrades cleanly
under `prefers-reduced-motion`.

**Single-world commitment:** this app is dark-only by design (the radar-console
concept *is* the pitch, not a switchable mode) — no light theme, no
`prefers-color-scheme` branch. Approved in the thesis preview.

---

## Color

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0A0E14` | App canvas |
| `--surface` | `#121A24` | Sidebar, panels, cards |
| `--surface-raised` | `#182230` | Popups, modals, dropdowns (one step up) |
| `--border` | `#1E2A38` | Hairlines, dividers |
| `--border-strong` | `#2A3A4C` | Emphasized borders (focus rings' static ring) |
| `--accent` | `#2DE0E6` | Interactive UI only — links, active states, focus, the sweep |
| `--accent-dim` | `#1B8A8F` | Accent at rest on large fills (rare) |
| `--text` | `#E7EEF5` | Primary text |
| `--text-muted` | `#8697A8` | Secondary text, labels, placeholders |
| `--text-faint` | `#546271` | Tertiary — timestamps, disabled |
| `--good` | `#3DDC84` | Status: بازدید شده / فعال / مشتری فعال |
| `--warn` | `#F5A623` | Status: نیاز به پوشش / سرنخ / نمونه داده شد / در حال پیگیری |
| `--crit` | `#F0475B` | Status: اجازه ورود ندارم / بدهی بحرانی |
| `--neutral` | `#5B6B7C` | Status: نامشخص / غیرفعال |
| `--facility` | `#D6E6F5` | Our own sites (انبار مرکزی، خانه) — infrastructure, never a status |

Semantic status colors are **never** repurposed as the interactive accent, and
`--accent` never carries status meaning — kept distinct per genjutsu's own rule
(a color must mean one thing). `--facility` is a third category again: our
own depots carry no coverage/debt/activity reading, so they may not borrow a status
color, and they are not interactive chrome, so they may not borrow `--accent`.

Contrast checked against `--bg`: `--text` 15.1:1, `--text-muted` 5.8:1,
`--accent` 9.6:1, `--good` 8.9:1, `--warn` 7.4:1, `--crit` 5.2:1 — all clear
4.5:1 for the text-weight use each token gets.

## Typography

- **UI / Persian text:** Vazirmatn (already wired via `next/font/google`,
  `--font-vazirmatn`). Carries every label, name, sentence.
- **Data / telemetry:** JetBrains Mono (`--font-mono`, new). Carries every
  number: coordinates, دebt figures, customer codes, counts, dates in compact
  contexts. Weight 400 only — bold ruins mono rhythm at this density.
- **Scale** (rem, 1.25 ratio, base 0.875rem for console density):

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 0.6875rem / 11px | Eyebrow labels, badges (mono, uppercase, tracked) |
| `--text-sm` | 0.8125rem / 13px | Secondary UI text, filters |
| `--text-base` | 0.875rem / 14px | Default body/UI text |
| `--text-md` | 1rem / 16px | Popup titles, emphasized rows |
| `--text-lg` | 1.25rem / 20px | Section headers |
| `--text-xl` | 1.5rem / 24px | Page title ("نقشه پوشش مشتریان") |

Line-height 1.5 for Persian body text (Vazirmatn needs the room), 1.3 for mono
data rows (tighter, tabular).

## Spacing

Base unit 4px. Scale: `1` 4px · `2` 8px · `3` 12px · `4` 16px · `5` 20px ·
`6` 24px · `8` 32px · `12` 48px. Sidebar sections use `3`–`4` internal gaps
(dense); the map itself gets no forced padding — it fills.

## Radii

`--radius-sm` 4px (pills, badges) · `--radius-md` 6px (buttons, inputs, cards) ·
`--radius-lg` 10px (panels, modals). Nothing fully rounded except status pills —
sharp-ish reads "console," not "friendly app."

## Elevation — glow, not shadow

No drop shadows anywhere (a shadow implies a light source above; a dark console
has none). Elevation is communicated by:
1. A 1px `--border` (default) or `--border-strong` (raised/focused).
2. A subtle outer glow in the relevant semantic color for anything "active" —
   `box-shadow: 0 0 0 1px var(--border), 0 0 16px -4px <color>`.
3. `--surface-raised` for anything that sits above the sidebar/map (popups,
   modals) — one perceptible step lighter, not a shadow.

## Motion tokens

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | The one easing curve. Everything. |
| `--dur-fast` | 120ms | Press/active feedback |
| `--dur-base` | 180ms | Hover, focus, small transitions |
| `--dur-slow` | 300ms | Panel/modal enter-exit |
| `--pulse-duration` | 2400ms | Marker radar-ping loop |
| `--pulse-stagger` | 800ms | Delay between the two ping rings |
| `--sweep-duration` | 4000ms | Ambient radar-sweep rotation (linear, decorative only) |

**Forbidden:** spring/bounce/elastic easings, any animation on `width`/`height`/
`top`/`left` (transform + opacity only), scroll-driven parallax, animations
longer than 300ms for anything the user is waiting on.

## Base components

- **Button** — `--surface` bg, `--border` 1px, `--radius-md`. Primary variant:
  `--accent` bg, dark text (`#04191C`) for contrast on the bright cyan fill.
  Hover: border→accent, text→accent (secondary) or brightness+4% (primary),
  scale 1.03, `--dur-base`. Active: scale 0.98, `--dur-fast`. Focus: 2px
  `--accent` outline, 2px offset. Disabled: 40% opacity, no pointer events.
- **Input / select** — `--surface` bg, `--border` 1px, `--radius-md`, mono font
  for anything numeric. Focus: border→accent + glow.
- **Card** (customer detail, district panel) — `--surface-raised`, `--border`
  1px, `--radius-lg`, `padding: var(--space-4)`.
- **Status pill** — `--radius-sm`, mono `--text-xs` uppercase tracked, colored
  dot + tinted background (`color-mix(in srgb, <status> 16%, transparent)`),
  text in the full-strength status color. Color is never the only signal — the
  Persian status word is always alongside the dot.
- **Map marker** — diamond (45°-rotated square), 14px, status color fill, 2px
  `--bg`-colored ring (separates it from the dark tiles), glow matching status
  color, idle radar-ping animation (two staggered expanding rings).
- **Facility marker** — our own sites, in `--facility`, distinguished by silhouette
  before color so they hold up for a color-blind reader and over satellite tiles:
  **warehouse** is a filled hexagon, 26×29px, center-anchored, with its crate glyph
  knocked out in `--bg`; **home base** is the same two parts inverted — a hollow house,
  24×26px, anchored at its *base* (a house that floats above its point reads as
  standing next to the address, not on it), `--bg` body at 88% with a `--facility`
  outline and door. Both static: the idle radar-ping belongs to live readings, and a
  building is not one. Hover: glow-intensify + scale 1.03, like every other
  interactive element. Drawn above the cluster layer — they are landmarks the rest of
  the map is read against, never something to hide inside a customer bubble.

## Anti-patterns (explicitly avoided)

- No purple/pink AI-gradient hero.
- No emoji-as-icon (existing ⚠/✅ text markers in status strings get replaced
  by the status-pill component instead).
- No light mode fallback fighting the single-world commitment.
- No map tile replaced/obscured by decoration — the sweep and glows sit in UI
  chrome and marker layers, never over the base tiles as a wash.
