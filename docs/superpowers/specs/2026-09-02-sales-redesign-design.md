# /sales redesign — design

**Date:** 2026-09-02
**Branch:** `sales-redesign` (off `main`)
**Skill path:** brainstorming → this spec → writing-plans → build. User waived the
spec-review gate: refine the plan, then build without waiting for approval.

---

## 1. Goal

Raise the `/sales` (کارگاه) surface to a premium, unified UI:

1. Self-host five Persian font families; make **Peyda** the UI voice and **Damavand**
   the display voice across the whole app; add a **user-facing font picker** (Peyda /
   IRANYekanX / IRANSansX / IRAN Family).
2. The accent picker must fully re-skin `/sales` — including a per-theme **surface tint**
   — instead of leaving hardcoded terracotta behind.
3. `.kargah .app` → **true full-bleed** (21:9 monitors).
4. One **unified card system**: a single primitive, the colorful top bar from image 3
   (hybrid: accent gradient by default, status color where a card has a lifecycle), and
   the `/sales/products` hover (lift + growing edge rail) on every card.
5. Fix **image-1** (table text bleeds past the card edge in `.kblock`) and **image-2**
   (the "documents behind" pocket cards have no visible edge in dark mode).
6. Merge `/sales/analysis` into `/sales/dashboard`; redirect the old route.
7. Restructure the 26-tab bar into **6 labeled groups** + a label rename pass.
8. Add an **animation layer**: card hover, list/grid stagger-in, number count-up, route
   transitions, chart draw-in — all `prefers-reduced-motion`-gated and RTL-correct.

## 2. Non-goals / untouched

- The map itself, Leaflet canvas ink, and the `:root` map/CRM **surface** palette
  (`#0a0e14` dark base, 260-pair contrast system). The accent **token** still switches
  on `:root`; the surface tint is `.kargah`-scoped only.
- All business logic, API routes, DB schema, `routeflow.db` contents.
- `check:contrast`'s existing 260 pairs stay green; new surface pairs are *added*.

## 3. Deployment constraints (from project memory)

- RouteFlow runs as a **production systemd service**. Source edits require
  `npm run build` + `systemctl restart` to appear. The plan batches build/restart at
  phase boundaries, never per-commit.
- A Stop hook auto-commits and pushes every change on this repo. Keep each commit
  coherent; do not fight the hook.
- `routeflow.db` is WAL — irrelevant here (no DB writes) but noted.

---

## 4. Typography

### 4.1 Files

- `public/fonts/` — woff2 only, self-hosted:
  - **Peyda** — `PeydaWeb-{Thin,ExtraLight,Light,Regular,Medium,SemiBold,Bold,ExtraBold,Black,ExtraBlack}.woff2` and the matching `PeydaFaNumWeb-*` (Farsi-numeral) faces for tabular figures.
  - **Damavand** — `Damavand ExtraBold.woff2` (display only; single weight).
  - **IRANYekanX** — `IRANYekanX-Regular.woff2` + `IRANYekanXFaNum-{Regular,Bold}.woff2` (+ a Bold UI face if present in the zip; else `Regular` only).
  - **IRANSansX** — `IRANSansX-Regular.woff2` + `IRANSansXFaNum-{Regular,Bold}.woff2`.
  - **IRAN Family** — `IRAN.woff2`, `IRANBold.woff2`, `IRANBlack.woff2`, `IRAN(FaNum).woff` (no woff2 in zip — convert or ship woff).
- `app/fonts.ts` — all `next/font/local` declarations at module scope (Next requires
  it), each exposing a CSS variable. Consumed from `app/layout.tsx`.

### 4.2 Tokens (`app/globals.css`)

| token | value | role |
|---|---|---|
| `--font-ui` | per `:root[data-font]`, default Peyda | body / labels / headings |
| `--font-num` | matching family's FaNum, tabular | figures, amounts, KPIs |
| `--font-display` | Damavand ExtraBold (always) | `.top h1`, `.mark`, `.side__brand h1`, big KPI headings |

Legacy aliases keep pointing at the new tokens so we don't touch 200+ call sites:
`--font-vazirmatn → --font-ui`, `--font-fa → --font-ui`, `--font-en → --font-ui`,
`--font-jetbrains-mono → --font-num`. `app/layout.tsx` swaps the 4 Google families
for the local ones; `<html>` className carries every `*.variable`.

### 4.3 Font picker

Mirrors `lib/accent.ts` exactly (same rationale: attribute before first paint,
same-tab custom event, separate localStorage key).

- `lib/font.ts` — `FONT_KEY = "coverage-font"`, `FONT_CHANGE_EVENT`, `FONT_INIT_SCRIPT`
  (blocking inline in `app/layout.tsx`, sets `data-font` on `<html>`), `applyFont`,
  `readFont`, `isFontId`, `FONT_IDS`, `DEFAULT_FONT = "peyda"`.
- `lib/fontChoices.ts` — `[{id, label, stack}]` for `peyda | yekan | sans | iran`,
  label in its own script (پیدا / ایران‌یکان / ایران‌سنس / ایران).
- `globals.css` — `:root[data-font="yekan"] { --font-ui: var(--font-yekan); --font-num: var(--font-yekan-fanum); }` etc. Bare `:root` = Peyda.
- `components/FontPicker.tsx` — same two-variant shape as `AccentPicker`
  (`header` | `map`), popover lists 4 options each previewed **in its own typeface**.
  Placed next to `<AccentPicker />` in `app/sales/layout.tsx`; `variant="map"` copy
  added beside the map's `AccentPicker` for parity.
- `useFont()` hook in the component, same shape as `useAccent()`.
- Damavand (display) does **not** switch — it is the display voice for every choice.

## 5. Accent → surface tint

### 5.1 Propagation bug fixes (independent of the tint)

Hardcoded terracotta that must become tokens:

- `.kargah .mark`, `.kargah .side__mark` — gradient `#D9663A→#B0431C` →
  `linear-gradient(145deg, var(--accent), var(--accent-2))`; drop-shadow → `color-mix`
  from `--accent`.
- `.kargah .btn.solid` — `box-shadow … rgba(192,83,43,.7)` → `color-mix(in srgb,
  var(--accent) 55%, transparent)`.
- `.kargah .gcard` washes — `--wash-mint`, `--wash-sand`, `--wash-sky` and the
  `--gcard-chip-*` inks are currently fixed; generator will emit them per theme
  (today only `--wash-peach` follows). If a full solve is out of budget, minimum:
  mix each wash toward the theme hue by ~40% in the generator.
- Any remaining literal `#C0532B / #B44E28 / #A9451F` in `globals.css` outside the
  generated block → the matching `--accent*` token. Grep gate in the plan.

### 5.2 Surface tint (generator change)

`scripts/gen-accent-themes.mjs` gains a **neutrals solver**. For each of the 10 themes,
in both skins, it emits these tokens **scoped to `.kargah` only**
(`:root[data-accent="x"] .kargah { … }`):

`--bg --surface --surface-2 --surface-sunk --border --border-strong --card --card-2
--sunk --line --line-2`

Rules:

- Very low chroma: **OKLCH C ≈ 0.006–0.014**, hue = theme hue. Lightness ladder copied
  from today's cream values (`--bg` L≈0.94 light / L≈0.16 dark, etc.) so only the hue
  moves.
- `terracotta` must resolve to visually today's cream (`#F4F0E9` family) — it is the
  regression anchor.
- Every emitted neutral is verified as a **ground** against `--text`, `--text-muted`,
  `--text-faint`, `--accent-text`, and the status inks — reuse the existing
  `contrastVerify` in the generator; refuse to write on failure (existing behavior).
- `scripts/check-contrast.mjs` — add the `.kargah` surface × ink pairs (10 themes × 2
  skins × ~5 inks) to its assertion table.
- Map/CRM `:root` neutrals: **unchanged**.

### 5.3 Default accent

Stays `terracotta`. (Revisit only if the user asks.)

## 6. Layout — full-bleed

- `.kargah .app` — remove `max-width: 1240px`; `width: 100%`;
  `padding-inline: clamp(14px, 4vw, 64px)`; keep `padding-block-end: 120px`
  (110px at the ≤620px breakpoint).
- Density guards for grids that assumed the old cap:
  - `.kargah .statrow` — allow a 4th column above ~1700px
    (`grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))` with a
    `max-width` on the first `.gcard` or an explicit `@media` bump).
  - `.kargah .pockets`, `.kargah .ptiles` — raise `minmax()` ceiling and cap column
    count with `repeat(auto-fill, minmax(clamp(240px, 22vw, 320px), 1fr))`.
  - `.kargah .prow` / `.plist` — inner content `max-width` not needed (rows are
    grid-defined) but the `.pk` grid template widened for the extra room.
- Prose surfaces get an inner measure: academy lesson body, complaint text,
  objection cards → `max-width: 72ch; margin-inline: auto` on the text column only.

## 7. Unified card system

### 7.1 Primitive

New `.kargah .kcard` consolidating the visual language of `.card`, `.kblock`,
`.gcard`, `.prow`, `.ptile`:

```
.kargah .kcard {
  position: relative; overflow: hidden; isolation: isolate;
  border-radius: var(--r-xl);
  border: 1px solid var(--line);
  background: var(--card);
  box-shadow: var(--sh-1);
  transition: box-shadow 260ms var(--ease), transform 260ms var(--ease);
}
```

`.kblock`, `.card` become **aliases** (`.kargah .kblock, .kargah .card { … same … }`)
so existing markup keeps working; new markup uses `.kcard`. `.gcard` keeps its mesh
background but inherits the border + hover from `.kcard` via an added class.

### 7.2 Colorful top bar (`image 3`)

`.kargah .kcard__bar` — 3px strip pinned to `inset-block-start: 0`.

- **Default:** `background: linear-gradient(90deg, var(--accent), var(--accent-2),
  var(--tint-plum))`.
- **Status mode:** `.kcard[data-tone="good|warn|crit|info"] .kcard__bar { background:
  var(--good|--warn|--crit|--info); }`.
- Applied with `data-tone` on lifecycle cards: **orders, cheques, deliveries, tasks,
  runs, payments** (map the existing per-card status → tone). All other cards get the
  gradient default (no `data-tone`).
- RTL: the bar is full-width, direction-agnostic. Gradient angle stays `90deg` (visual
  left→right is fine; it is decorative).

### 7.3 Hover (products effect, everywhere)

```
.kargah .kcard::before {   /* the edge rail */
  content: ""; position: absolute; inset-block: 0; inset-inline-start: 0;
  width: 3px; background: var(--accent);
  transform: scaleY(0); transform-origin: center;
  transition: transform 320ms var(--spring);
}
.kargah .kcard:hover { box-shadow: var(--sh-2); transform: translateY(-2px); }
.kargah .kcard:hover::before { transform: scaleY(1); }
@media (prefers-reduced-motion: reduce) {
  .kargah .kcard, .kargah .kcard::before { transition: none; }
  .kargah .kcard:hover { transform: none; }
}
```

Note: `.kcard__bar` (top) and `::before` (inline-start rail) coexist — the bar is
identity, the rail is the hover affordance. `.prow::before` is already this; it is
promoted to the primitive.

### 7.4 Image-1 fix (`.kblock` body inset)

`.kblock` gives its header (`.bhead`) a `20px 24px 14px` inset but nothing for the
body, so table wrappers sit flush to the card edge and Farsi figures/ranges bleed
past it. Add a body convention:

```
.kargah .kblock__body,
.kargah .kcard__body { padding: 0 24px 20px; }
@media (max-width: 639px) { .kargah .kblock__body,
                            .kargah .kcard__body { padding-inline: 16px; } }
```

Wrap the `overflow-x-auto` table containers (`DemandTable`, `ChurnList`,
`LearnedCapacity`, and any other `.kblock` consumer) in `.kblock__body`. Table cells
that use `text-left` in the RTL context keep a trailing gutter via the body padding.

### 7.5 Image-2 fix (pocket docs in dark)

`.kargah .doc` (the papers peeking behind a `.pocket`) use `background: var(--card)`
with only warm-brown shadows — invisible on the dark skin.

```
.kargah .doc {
  border: 1px solid var(--border-strong);
  box-shadow: 0 2px 6px rgba(62,44,28,.10), 0 10px 24px -12px rgba(62,44,28,.3);
}
:root[data-skin="dark"] .kargah .doc {
  border-color: rgba(255,255,255,.10);
  box-shadow: 0 0 0 1px rgba(255,255,255,.06),
              0 2px 8px rgba(0,0,0,.45), 0 12px 28px -14px rgba(0,0,0,.6);
}
```

Same treatment for `components/kargah/PocketCard.tsx` / `OrderPocketCard.tsx` if they
carry their own inline shadow rather than the class.

## 8. Navigation

`components/kargah/TabPill.tsx` → grouped nav. Data shape in `app/sales/layout.tsx`
gains a `group` field per tab.

**Groups** (6), tabs in display order:

| group | tabs (href → new label) |
|---|---|
| **روز من** | `/sales/today` امروز · `/sales/pocket` پاکت · `/sales/schedule` برنامهٔ روز → **مسیر امروز** · `/sales/journey` مسیر سفارش |
| **فروش و سفارش** | `/sales/dashboard` (was داشبورد + تحلیل + تحلیل و KPI) → **تحلیل فروش** · `/sales` داشبورد · `/sales/orders` سفارش‌ها · `/sales/forecast` پیش‌بینی · `/sales/products` کالاها و قیمت‌ها · `/sales/commission` پورسانت |
| **تحویل** | `/sales/runs` مسیر تحویل · `/sales/deliveries` تحویل‌ها · `/sales/batches` بچ‌ها · `/sales/routing` مسیریابی |
| **مالی** | `/sales/payments` دریافت‌ها · `/sales/cheques` چک‌ها |
| **انبار** | `/sales/stock` انبار و خرید |
| **مدیریت** | `/sales/board` تخصیص کارها · `/sales/tasks` تختهٔ کارها · `/sales/reps` **نمایندگان فروش** · `/sales/academy` آموزش · `/sales/complaints` شکایات · `/sales/admin/users` کاربران · `/sales/admin/groups` گروه‌ها · `/sales/admin/representatives` **تعریف نمایندگی** |

Rename collisions resolved:

- `امروز` vs `برنامهٔ روز` → keep `امروز`, rename schedule to **مسیر امروز**.
- three `نمایندگان`: `/sales/reps` → **نمایندگان فروش**, `/sales/admin/representatives`
  → **تعریف نمایندگی** (the `/sales/reps` "نمایندگان" in group مدیریت and the admin one
  no longer collide).
- `داشبورد` / `تحلیل` / `تحلیل و KPI` → one **تحلیل فروش** (`/sales/dashboard`);
  `/sales` stays **داشبورد** (the landing overview).

**Mechanism:** a row of 6 group buttons; selecting a group reveals its tab row beneath
with the existing travelling-pill animation scoped to that row. No dropdowns (full-bleed
bar has the width; keeps keyboard/touch simple). Active group derives from the current
pathname. Role-gating (`ready`) logic unchanged — a group with zero ready tabs is
hidden.

## 9. Merge dashboard + analysis

- Move the analysis page content into `/sales/dashboard`:
  `app/sales/dashboard/page.tsx` renders its KPI tiles, then an `<h2>` section divider
  (**تحلیل عمیق**), then the components currently in `app/sales/analysis/page.tsx`
  (and `components/analysis/*`).
- `app/sales/analysis/page.tsx` → `import { redirect }` … `export default function () {
  redirect("/sales/dashboard"); }` (keep `dynamic = "force-dynamic"`).
- Remove the `analysis` tab; `dashboard` tab label becomes **تحلیل فروش**.
- Any internal `<Link href="/sales/analysis">` → `/sales/dashboard`.

## 10. Animation layer

All gated behind `@media (prefers-reduced-motion: no-preference)` (CSS) or a
`usePrefersReducedMotion()` guard (JS). RTL: transforms use `translateY` / `scaleY`
(axis-neutral) or logical `inset-inline`; never a bare `translateX`.

| piece | where | mechanism |
|---|---|---|
| **Card hover lift + rail** | every `.kcard` | §7.3, CSS only |
| **List / grid stagger-in** | `.pockets`, `.ptiles`, `.plist`, merged-analysis table `tbody` | new `components/kargah/Stagger.tsx` — wraps children, applies `opacity 0→1` + `translateY(6px)→0`, `40ms` step, `IntersectionObserver` for below-fold; no-op under reduced motion |
| **Number count-up** | KPI `<strong>` figures, `BentoTile`, `BentoGauge` centre number | new `lib/useCountUp.ts` — `requestAnimationFrame` ease-out over ~600ms, respects reduced motion (renders final value), formats via existing `faNum` |
| **Route transitions** | between `/sales/*` | extend `components/kargah/RevealRoute.tsx` — cross-fade + `translateY(8px)` on `pathname` change |
| **Chart draw-in** | `BentoGauge` arc (add), any bar/line charts in merged analysis | reuse `SalesSpark`'s draw pattern (`stroke-dashoffset` / height transition on mount) |

## 11. File-change map

**New**

- `app/fonts.ts`
- `lib/font.ts`, `lib/fontChoices.ts`, `lib/useCountUp.ts`, `lib/usePrefersReducedMotion.ts`
- `components/FontPicker.tsx`, `components/kargah/Stagger.tsx`
- `public/fonts/*.woff2`

**Modified**

- `app/layout.tsx` — local fonts, `FONT_INIT_SCRIPT`
- `app/globals.css` — font tokens + `:root[data-font]`, `.kcard` primitive + bar +
  hover + `__body`, `.doc` dark fix, `.app` full-bleed, grid density, prose measure,
  terracotta→token fixes, generated block regrown
- `scripts/gen-accent-themes.mjs` — neutrals solver, `.kargah` surface emission
- `scripts/check-contrast.mjs` — new surface pairs
- `lib/accentThemes.ts` — regenerated (if the generator also writes it)
- `app/sales/layout.tsx` — `<FontPicker />`, grouped `tabs` data, new labels
- `components/kargah/TabPill.tsx` — grouped rendering
- `components/kargah/RevealRoute.tsx` — route transition
- `app/sales/dashboard/page.tsx` — absorb analysis
- `app/sales/analysis/page.tsx` — redirect
- `components/predict/DemandTable.tsx`, `ChurnList.tsx`, `LearnedCapacity.tsx` —
  `.kblock__body` wrapper
- `components/kargah/{PocketCard,OrdersPockets,ProductsView,ScheduleBoard,…}.tsx`,
  `components/sales/*Panel.tsx`, `components/sales/OrderPocketCard.tsx` — adopt
  `.kcard` / `data-tone` / `<Stagger>` / `useCountUp`
- `components/BentoStrip.tsx` — `useCountUp` in `BentoTile` / `BentoGauge`
- `components/AccentPicker.tsx` — map-chrome spot gains a `FontPicker` sibling
  (layout only)
- map chrome host (wherever `<AccentPicker variant="map" />` mounts) — add
  `<FontPicker variant="map" />`

## 12. Verification

- `npm run lint` clean.
- `npm run test` — existing `tests/accent.test.ts` still green; add
  `tests/font.test.ts` (mirror: `isFontId`, default, round-trip) and a nav-groups
  test (every `ready` tab lands in exactly one group; no orphan hrefs).
- `npm run check:contrast` — all pairs green, **including** the new `.kargah` surface
  pairs.
- `node scripts/gen-accent-themes.mjs --check` — solves and verifies without writing.
- Manual (build + `systemctl restart`, then walk):
  - Every accent × both skins: no terracotta left where the accent should be; surface
    hue tracks the theme; `terracotta` looks like today.
  - Every font choice: applies before first paint (no FOUT flash of the old family),
    numbers stay tabular, Damavand headings unchanged.
  - 21:9: `.app` fills the viewport; grids stay sane density; prose stays ≤72ch.
  - `/sales/forecast`: table figures sit inside the card (image-1 fixed).
  - `/sales/pocket` dark skin: the papers behind each card have visible edges
    (image-2 fixed).
  - Every `/sales/*` card has the top bar; lifecycle cards show status tone; hover
    lift + rail everywhere.
  - `/sales/analysis` → 301 to `/sales/dashboard`; analysis sections render below KPIs.
  - Tab bar: 6 groups, no duplicate/confusable labels, pill animates within a group,
    role-gated groups hide when empty.
  - Reduced-motion: no count-up, no stagger, no route slide, no hover transform.

## 13. Phasing (for the plan)

1. **Fonts** — self-host, tokens, `app/fonts.ts`, layout swap, `lib/font.ts` +
   `FontPicker` + `:root[data-font]`. Build/restart. Verify picker + no FOUT.
2. **Accent generator** — neutrals solver, `.kargah` surface emission, `check:contrast`
   extension, regrow the block, fix hardcoded terracotta. Build/restart. Verify all
   accents × skins.
3. **Layout + card primitive** — `.app` full-bleed, `.kcard` + bar + hover + `__body`,
   grid density, prose measure, image-1 + image-2 fixes, migrate consumers to `.kcard`
   / `data-tone`. Build/restart.
4. **Navigation** — grouped `TabPill`, tab data + labels, redirect analysis, merge
   analysis into dashboard, update internal links. Build/restart.
5. **Animation** — `Stagger`, `useCountUp`, `usePrefersReducedMotion`, `RevealRoute`
   route transition, chart draw-in, wire into consumers. Build/restart. Full
   verification pass §12.

Each phase: lint + test + relevant check script before its build/restart.
