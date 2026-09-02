# /sales polish — design (v2, baseline = `main`)

**Date:** 2026-09-02
**Supersedes:** `2026-09-02-sales-redesign-design.md` (that spec treated this as a ground-up
redesign; it is not).
**Audit:** `docs/superpowers/audits/2026-09-02-sales-redesign-regression-audit.md` (synthesis)
and `2026-09-02-per-agent-findings.md` (verbatim fixes). Cite the audit for exact CSS/TSX.

## Principle

`main`'s `/sales` UI is the **baseline and it stays**. The user likes it. Every change here is
**additive and opt-in** — a new class, attribute, or component — never a replacement of an
existing system. The goal is *more wow / interactivity / gamification* (the papers-tuck-behind
stack is the model), layered on top, plus the specific asks from the original brief.

The `sales-redesign` branch is **abandoned** (kept for reference). Its genuinely-good work is
re-applied cleanly onto a fresh branch off `main`.

## Locked decisions

1. **Branch:** fresh `sales-polish` off `main`. Salvage listed files; do NOT bring the
   `.kcard` primitive, the full-bleed-as-shipped, the nav rewrite, the RevealRoute edits, or
   the font aliasing.
2. **Width:** full-bleed `.kargah .app`, with **every fixed-column layout individually
   capped** (`.board`, `.bento`, `.sched`, `.lanes`, `.chartbox`, `.statrow`) so nothing
   sprawls. This also fixes the "so much white space" on the kanban.
3. **Accent:** full per-theme paper tint (`.kargah`-scoped), plus tokenizing every baked-in
   terracotta so the picker fully re-skins. `check:contrast` must stay green.
4. **Avatars:** one `<Avatar>` — a squircle with the initial(s), background colour
   deterministically seeded from the user id. No DB change. Real photo uploads are a later
   follow-up.

## Salvage from `sales-redesign` (re-apply, mostly verbatim)

| Path | Note |
|---|---|
| `public/fonts/*` | as-is |
| `app/fonts.ts` | as-is (literals already inlined) |
| `lib/font.ts`, `lib/fontChoices.ts`, `components/FontPicker.tsx`, `tests/font.test.ts` | FontPicker moves into `<ProfileMenu>` |
| `scripts/gen-accent-themes.mjs` (neutrals solver + `.kargah` surface emission + `--gcard-hue-rotate`) | raise `SURFACE_C_CEIL` so the tint is clearly visible (decision 3); terracotta stays pinned; re-verify |
| `scripts/check-contrast.mjs` (surface-pair assertions) | as-is |
| `app/sales/dashboard/page.tsx` + `app/sales/analysis/page.tsx` (merge + redirect) | with the **fixed** `CountUp` (mode/suffix, no function props) |
| `lib/salesNav.ts` (tab list + renamed labels) | keep the labels; the grouping is reworked in Layer H |
| `lib/useCountUp.ts`, `lib/usePrefersReducedMotion.ts`, `components/kargah/CountUp.tsx` | fixed versions (setState only in rAF; serialisable format) |
| `tests/useCountUp.test.ts`, `tests/salesNav.test.ts` | as-is |
| The `.chart-rise` / `.chart-arc` draw-in CSS + the `BarChart`/`BentoStrip` class hooks | as-is (pure CSS, `.kargah`-scoped, reduced-motion gated) |

## DROP (the damage — never re-apply)

- `.kcard` primitive; aliasing `.card`/`.kblock` to it (added `overflow:hidden` +
  `isolation:isolate` + `position:relative` → **clips the JalaliDatePicker calendar and every
  absolute popover in a form card**).
- `.kcard::after` top-bar on `.card`/`.kblock`/`.prow`/`.ptile`/`.gcard`/`.face`.
- `.kcard::before` hover rail on `.card`/`.kblock`.
- Full-bleed `.app` without per-layout caps.
- `.route-fade` permanent-node wrapper (a no-op; browser coalesces the double-rAF toggle).
- `.stag` CSS + the unwired `Stagger` component.
- The `REVEAL["/sales/dashboard"]` edits in `RevealRoute.tsx` (`.kblock`/`.kcard` additions
  pushed the card count past `LIFT_MAX=6` → every card lost its spring lift).
- Font aliasing that pointed `--fa`/`--en` at `--font-ui` (orphaned every FaNum face → figures
  rendered in the proportional UI font).

---

## Layers

Each layer is one or a few focused commits, verified against the running app on
`127.0.0.1:3003` before moving on. `app/globals.css` is the contention point — layers that
touch it run in the order below.

### Layer 0 — reset
`git checkout main && git checkout -b sales-polish`. Copy in the salvage files that are
**new files** (fonts dir, `lib/font*`, `FontPicker`, the anim helpers, the tests). Do NOT copy
`globals.css`, `layout.tsx`, `TabPill.tsx`, `RevealRoute.tsx` from the branch — those are
edited fresh here.

### Layer A — Fonts (self-host; figures keep a tabular numeral face)
Files: `app/layout.tsx` (local fonts + `FONT_INIT_SCRIPT`), `app/globals.css` (tokens).
- `--font-ui` = Peyda · `--font-num` = Peyda **FaNum** (tabular) · `--font-display` = Damavand.
- Map `--font-fa` / legacy `--font-vazirmatn` → `var(--font-ui)`.
- **`--font-en` → `var(--font-ui)` for text, but add explicit `.kargah .mono, .kargah .num,
  .kargah [class*="tabular"] { font-family: var(--font-num); }`** so every figure keeps a
  tabular FaNum face. This is the audit's P0-8 fix — do not skip it.
- `:root[data-font="yekan"|"sans"|"iran"]` remap `--font-ui` **and** `--font-num` to that
  family's faces.
- `.top h1`, `.mark`, `.side__brand h1` → `var(--font-display)` (moot after Layer I replaces
  the brand, but harmless).

### Layer B — Accent fully re-skins + full per-theme paper tint
Files: `app/globals.css` (`.kargah` block), `scripts/gen-accent-themes.mjs`,
`scripts/check-contrast.mjs`.
- Tokenize baked terracotta in the `.kargah` block: `.mark` / `.side__mark` gradients →
  `linear-gradient(145deg, color-mix(in srgb, var(--accent) 80%, #fff 20%), var(--accent-2))`;
  `.btn.solid` / `.day.today` shadows → `color-mix(in srgb, var(--accent) N%, transparent)`;
  `.ev.a .dot` → `color-mix(... var(--accent) 16% ...)`; `#fff` on accent fills →
  `var(--accent-ink)`.
- `.gcard::before` → add `filter: hue-rotate(var(--gcard-hue-rotate, 0deg))`.
- Generator: re-apply the neutrals solver; **raise `SURFACE_C_CEIL` to ~0.024 (light) /
  ~0.020 (dark)** for a clearly-visible tint (decision 3); keep terracotta pinned to today's
  exact cream; keep the `min(WCAG, cream-baseline − eps)` gate.
- `check-contrast.mjs`: keep the surface-pair assertions. `npm run check:contrast` green.
- Regenerate the `ACCENT-THEMES` block.

### Layer C — Full-bleed + per-layout caps
Files: `app/globals.css`.
- `.kargah .app { width: 100%; max-width: none; margin: 0; padding: 26px clamp(16px, 3vw, 72px) 120px; }`
  (`18px 14px 110px` at ≤620px).
- Caps (audit P0-4/P0-5, exact values in the per-agent findings — kanban agent + sweep agent):
  - `.kargah .board`, `.kargah .board.pipe` → columns capped: `grid-template-columns: repeat(3, minmax(280px, 380px))` / `repeat(4, minmax(240px, 340px))`, `justify-content: start`.
  - `.kargah .bento` → `max-width: 1100px`.
  - `.kargah .sched` → `max-width: 1200px`.
  - `.kargah .lanes` → `max-width: 1440px`.
  - `.kargah .statrow` → `max-width: 1400px`.
  - `.kargah .chartbox` host blocks → `max-width: 1400px` where they are heroes.
  - Prose surfaces (academy lesson body, complaint text, objection cards) → inner
    `max-width: 72ch; margin-inline: auto` (new `.prose` helper).
- `.pockets` / `.ptiles` keep `repeat(auto-fill, minmax(clamp(240px, 20vw, 300px), 1fr))`.

### Layer D — Colorful top bar, to image 3 (opt-in only)
Files: `app/globals.css` (new `.kbar` treatment), the components that opt in.
- New opt-in: a `<span class="kbar" aria-hidden>` (or a `.has-bar` modifier drawing `::after`)
  — **never** by touching `.card` / `.kblock` / `.face` base rules.
- Treatment (audit top-bar agent, verbatim): one `--bar` custom property drives it;
  ends fade to transparent via `mask-image: linear-gradient(90deg, transparent 0, #000 <r+6>px,
  #000 calc(100% - <r+6>px), transparent 100%)` where `<r>` = card corner radius; glow via
  `filter: drop-shadow(0 0 6px color-mix(in srgb, var(--bar) 70%, transparent))` **dark-skin
  only**; light skin = a 1px hairline, no blur (MASTER.md "glow, not shadow" on cream).
  `data-tone="good|warn|crit|info"` sets `--bar` to the status colour so the halo matches.
- Apply to: run/delivery cards, batch cards, cheque cards, kanban task cards. **Not** on the
  pocket `.face` fold line, **not** on `.gcard` mesh cards. Pocket cards instead get a soft
  top **glow** on `.face` (not a strip) — tune during implementation with a screenshot.

### Layer E — Unify the products-style hover (opt-in)
Files: `app/globals.css`.
- Extract `.prow`'s effect (inline-start rail grows on hover + `translateY(-2px)` + shadow
  bump, `--spring`) into an opt-in `.liftcard` class. **No `overflow:hidden`, no
  `isolation`.** Add the class in the components that should lift (kanban tasks, order rows,
  stock rows, commission rows) — not on `.card`/`.kblock` themselves.
- Respect `prefers-reduced-motion`.

### Layer F — Pocket "papers behind": restore + generalise (the gamification core)
Files: `app/globals.css` (restore `.doc`/`.face`/`.pocket` to `main`; add `.pocketed`),
`components/kargah/Pocketed.tsx` (new), + the components it's applied to.
- **Restore:** `.face` — remove `overflow:hidden`, remove the `::after` bar (Layer D never
  touches it). `.doc` — border/shadow **dark-skin only** (`main` had none; image-2 asked only
  for a dark-skin edge): `:root[data-skin="dark"] .kargah .doc { border: 1px solid rgba(255,255,255,.10); box-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 2px 8px rgba(0,0,0,.45), 0 12px 28px -14px rgba(0,0,0,.6); }`. Light skin = exactly `main`.
- **Generalise:** `<Pocketed slips={1|2} tone={...} labels={[...]}>{children}</Pocketed>` and a
  `.pocketed` / `.pocketed__slip` CSS pair derived from the existing `.pocket` / `.doc`
  (audit pocket agent gave the CSS + API — pull verbatim). The wrapper carries the top
  padding the slips occupy; slips fan on `:hover`/`:focus-within`.
- Apply to: kanban `.task` cards (`/sales/board`, `/sales/tasks`), cheque cards, batch cards,
  delivery/payment receipt cards — each seeding slip count/tone from its own data.
- Delete dead code: `components/sales/OrderPocketCard.tsx` and the never-imported global-scope
  `.pocket*` CSS (audit P2-6).

### Layer G — Animation (additive; `main`'s entrance untouched)
Files: `components/kargah/RevealRoute.tsx` (= `main`'s version, verbatim — revert the branch
edits), `components/kargah/RouteFade.tsx` (new), `app/sales/layout.tsx`, `app/globals.css`,
`components/kargah/CountUp.tsx` (salvaged, fixed), chart components (salvaged CSS).
- RevealRoute: exactly `main`. The staggered spring-lift entrance is preserved.
- `<RouteFade>`: real transition (audit anim agent, verbatim) — a wrapper with
  `key={pathname}` so it remounts per route and replays a `kargah-route-in` keyframe
  (`opacity 0→1` + `translateY(8px)→0`, ~220ms, `--ease`), reduced-motion → no-op. Sits
  *inside* `.app`, wrapping `{children}`, as a sibling of `<RevealRoute>`.
- `<CountUp>` on the dashboard KPI figures (fixed).
- Chart draw-in (`.chart-rise` bars, `.chart-arc` gauge) — salvaged CSS.
- Micro-interactions: `.kargah .btn:active { transform: scale(.97); }`, pill/chip press
  states, `.pocketed:hover` slip fan — small, `--spring`, reduced-motion gated.

### Layer H — Tabs: renames + grouped nav where BOTH rows get the travelling pill
Files: `lib/salesNav.ts` (salvaged labels), `components/kargah/TabPill.tsx` (rework),
`components/kargah/Chrome.tsx` (new), `app/sales/layout.tsx`, `app/globals.css`.
- Keep the renamed labels (امروز / برنامهٔ بازدید, تقسیم کار / کارتابل, نمایندگان فروش /
  تعریف نمایندگی, one تحلیل فروش).
- Nav = two rows (6 group buttons, then the active group's tabs) — **both** rows get a
  travelling `.thumb` pill driven by one shared `slideThumb(rootRef)` helper (audit nav agent
  gave the full `TabPill.tsx` + CSS). Same `--spring`, same measure-then-enable dance.
- Both rows `justify-content: center` with `overflow-x: auto` (centered, but scroll — never
  wrap). Keyboard nav, `aria-current`, the "به‌زودی" disabled state, longest-prefix active
  match all preserved.
- `<Chrome>`: a `position: sticky` wrapper around the brand bar + nav that toggles
  `transform: translateY(-100%)` on scroll-down and back on scroll-up (audit nav agent gave
  it). RTL-safe, reduced-motion → always visible.

### Layer I — Brand + Profile menu + Avatars
Files: `app/sales/layout.tsx`, `components/kargah/ProfileMenu.tsx` (new),
`components/kargah/Avatar.tsx` (new), `app/globals.css`, + every user-render site.
- **Brand:** `.mark` → inline-SVG infinity (lemniscate) in `var(--accent)` (or an accent
  gradient stroke) in the same ~46px rounded square; `<h1>` → the app name. **Name string:**
  «RouteFlow» as a Latin wordmark (matches `package.json` name `routeflow`, `README`,
  `MASTER.md`, `<title>`); a transliterated Farsi name would be worse. Keep the date `.sub`
  under it.
- **ProfileMenu:** `.me` → a button opening a popover (reuse `AccentPicker`'s
  click-outside/Esc pattern) with rows: "↗ نقشه" link · `<SkinToggle>` · `<FontPicker>` ·
  `<AccentPicker>`. `.topright` then holds only `<ProfileMenu>`.
- **Avatar:** `<Avatar userId={n} name={s} size={n} />` — squircle, one or two initials, bg =
  `AV_TONE[hashId(userId) % AV_TONE.length]` (consolidate the ~6 ad-hoc `AV_TONE` copies the
  sweep found). Swap in at: the top-bar `.me`, kanban task cards, pocket cards, rep lists,
  commission tables, assignment board, journey, complaints, and anywhere else a bare initial
  circle renders in `/sales` (audit brand agent enumerated the sites).

### Layer J — dashboard + analysis merge
Salvaged `dashboard/page.tsx` (with fixed `CountUp`) + `analysis/page.tsx` redirect. Add a
small `.kblock__body { padding: 0 24px 20px; }` helper (`16px` inline ≤639px) and wrap
`KpiStrip` / `ActionCenter` / the merged table bodies in it (audit P2-2). This is one tiny
helper, not the primitive.

### Layer K — image-1 + image-2
- image-1 (forecast table bleeds past the card): wrap the `overflow-x-auto` tables in
  `components/predict/{DemandTable,ChurnList,LearnedCapacity}.tsx` in `.kblock__body`.
- image-2 (docs invisible in dark): covered by Layer F's dark-skin `.doc` edge.

---

## Verification (every layer)

`npm run lint` · `npx tsc --noEmit` · relevant `vitest` · `npm run check:contrast` (Layer B) ·
`npm run build` · restart `coverage-map.service` · **then a screenshot walk of the affected
`/sales` screens while logged in**. The last step is what was missing last time. Needs either
a test login, or the user drives the visual pass per layer. State which per layer.

Full spec §12-style checklist from the audit synthesis applies at the end.

## Sequencing

`globals.css` order: **A → B → C → F(restore) → D → E → G(css) → H(css) → I(css) → J/K.**
Independent of `globals.css`: `RouteFade`, `Avatar`, `ProfileMenu`, `Chrome`, `Pocketed`
components; `salesNav.ts`; the tests. `TabPill.tsx` (H) and `layout.tsx` (H+I) are shared —
do H then I. `RevealRoute.tsx` revert (G) is standalone and first in G.
