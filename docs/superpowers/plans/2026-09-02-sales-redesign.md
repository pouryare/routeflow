# /sales Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Logic-bearing tasks are full TDD; CSS/visual tasks end in a build + screenshot verification instead of a unit test.

**Goal:** Raise the `/sales` (کارگاه) surface to a unified premium UI — self-hosted fonts + a font picker, a fully-propagating accent with per-theme surface tint, one card primitive with the image-3 top bar, full-bleed layout, a 6-group tab bar, the dashboard+analysis merge, and a reduced-motion-safe animation layer.

**Architecture:** All work is inside the `.kargah` scope plus the shared `app/layout.tsx`. Fonts move from `next/font/google` to `next/font/local`, wired through three CSS tokens (`--font-ui` / `--font-num` / `--font-display`) with legacy aliases so ~200 call sites are untouched. The accent generator (`scripts/gen-accent-themes.mjs`) gains a low-chroma neutrals solver that emits `.kargah`-scoped surface tokens per theme; hardcoded terracotta in `globals.css` is tokenized. A new `.kcard` primitive consolidates `.card`/`.kblock`/`.gcard`/`.prow`/`.ptile` visuals and carries the colorful top bar (`data-tone` switches gradient→status). Navigation groups the 26 tabs into 6. Animation is CSS-first with three small JS helpers.

**Tech Stack:** Next.js 16 (App Router, `next/font/local`), React 19, Tailwind v4, vanilla CSS custom properties, vitest, an OKLCH solver script (Node, no deps).

**Spec:** `docs/superpowers/specs/2026-09-02-sales-redesign-design.md`

**Status (2026-09-02):** All five phases implemented on branch `sales-redesign`.
`npm run build` clean; `npm run check:contrast` 500/500; `node scripts/gen-accent-themes.mjs --check` clean; `npm run lint` 0 errors (3 pre-existing warnings). Full `vitest` run showed one timing-flaky failure in `tests/rules-repo.test.ts` that passes in isolation (known de-flake history in this repo) — no test file was modified except the three new ones. Authenticated visual walk of §12 still pending (needs a logged-in browser).

## Global Constraints

- **This is not stock Next.js.** Read `node_modules/next/dist/docs/` for the relevant API before writing App-Router/font code. Commit the `AGENTS.md` agent-files block with your work; do not fight it.
- **Production service.** Source edits only appear after `npm run build` + `sudo systemctl restart` of the app service. Batch build/restart at phase boundaries, never per-commit. Ask the user to run the restart if the command is not permitted.
- **Stop hook auto-commits and pushes.** Keep each commit coherent; if the hook already committed, continue or amend.
- **Accent = interaction, never status.** Green = visited/done, amber = needs attention, red = keep out — shared with `/report` and `/analytics`, **never themed**. Only `--accent` moves on a hue collision.
- **`--accent-ink` does not invert.** Light: `#FFFFFF` on the fill. Dark: near-black. Never white text on the dark accent fill.
- **RTL.** Logical properties only (`inset-inline-start`, `padding-inline`, `margin-inline`); axis-neutral transforms (`translateY`, `scaleY`, `scale`). No bare `translateX` in animation.
- **Reduced motion.** Gate every animation (`@media (prefers-reduced-motion: no-preference)` or `usePrefersReducedMotion()`); reduced = final state, no transition.
- **Contrast.** `npm run check:contrast` stays green; new surface pairs are *added* to its table.
- **Defaults unchanged:** accent `terracotta`, font `peyda`, theme `dark`.
- **Verify before claiming done.** Run the command, read the output. For visual claims, screenshot: `python3 /root/.claude/shrink-shot.py <img>` then read the `.small.png`.

---

## File Structure

**New**

| path | responsibility |
|---|---|
| `app/fonts.ts` | All `next/font/local` declarations (module scope) → CSS variables. |
| `lib/font.ts` | Font preference: `data-font` attr, blocking init script, `applyFont`/`readFont`, custom event. Mirror of `lib/accent.ts`. |
| `lib/fontChoices.ts` | `FONT_CHOICES: {id,label,stack}[]` + `DEFAULT_FONT`, `isFontId`, `FontId`. Mirror of `lib/accentThemes.ts`. |
| `lib/usePrefersReducedMotion.ts` | `usePrefersReducedMotion(): boolean`. |
| `lib/useCountUp.ts` | `useCountUp(target: number, opts?: {durationMs?: number}): number` — rAF ease-out, reduced-motion aware. |
| `components/FontPicker.tsx` | Popover picker, variants `header`\|`map`, previews each family in its own face. Mirror of `components/AccentPicker.tsx`. |
| `components/kargah/Stagger.tsx` | Wraps a list; fades+`translateY(6px)`→0 children with a capped step; `IntersectionObserver` for below-fold; no-op under reduced motion. |
| `tests/font.test.ts` | `isFontId`, default, round-trip. |
| `tests/salesNav.test.ts` | Every `ready` tab in exactly one group; no orphan/dupe hrefs; no duplicate labels among `ready` tabs. |
| `tests/useCountUp.test.ts` | Reaches target; reduced-motion returns target immediately. |
| `public/fonts/*.woff2` | Self-hosted faces. |

**Modified**

| path | change |
|---|---|
| `app/layout.tsx` | Local fonts from `app/fonts.ts`; add `FONT_INIT_SCRIPT`; extend `<html>` className. |
| `app/globals.css` | Font tokens + `:root[data-font]` map; `.kcard` primitive + `.kcard__bar` + hover rail + `.kcard__body`; `.kblock`/`.card` aliased; `.doc` dark-skin edge; `.kargah .app` full-bleed; grid density; prose measure; terracotta→token; `--gcard-hue-rotate`; regrown ACCENT-THEMES block. |
| `scripts/gen-accent-themes.mjs` | Neutrals solver; emit `.kargah`-scoped surface tokens + `--gcard-hue-rotate` per theme/skin; extend verify. |
| `scripts/check-contrast.mjs` | Add `.kargah` surface × ink assertions. |
| `app/sales/layout.tsx` | `<FontPicker />` beside `<AccentPicker />`; `tabs` gain `group`; new labels; pass groups to `TabPill`. |
| `components/kargah/TabPill.tsx` | Grouped rendering: group-button row + travelling-pill row for the active group. |
| `components/kargah/RevealRoute.tsx` | Route cross-fade/slide on `pathname` change; `REVEAL` selectors updated for `.kcard` + merged dashboard. |
| `components/CoverageMap.tsx` (~1317) | `<FontPicker variant="map" />` beside `<AccentPicker variant="map" />`. |
| `app/sales/dashboard/page.tsx` | Absorb the analysis page body as sections below the KPI tiles. |
| `app/sales/analysis/page.tsx` | Body → `redirect("/sales/dashboard")`. |
| `components/predict/DemandTable.tsx`, `ChurnList.tsx`, `LearnedCapacity.tsx` | Wrap `overflow-x-auto` table in `.kblock__body`. |
| `components/analysis/*.tsx` | Adopt `.kcard`/`data-tone` where they render cards (no logic change). |
| `components/BentoStrip.tsx` | `useCountUp` in `BentoTile`, `BentoGauge`. |
| `components/kargah/{PocketCard,OrderPocketCard,OrdersPockets,ProductsView,ScheduleBoard,EarnerCard,CarvedCard}.tsx`, `components/sales/*Panel.tsx` | Adopt `.kcard` / `data-tone` / wrap lists in `<Stagger>`. |

---

## Phase 1 — Fonts

### Task 1.1: Vendor the font files

**Files:** Create `public/fonts/*` from the five `/root/pourya/*.zip` archives.

**Interfaces:**
- Produces: `public/fonts/` containing (exact names): `PeydaWeb-{Thin,ExtraLight,Light,Regular,Medium,SemiBold,Bold,ExtraBold,Black,ExtraBlack}.woff2`, `PeydaFaNumWeb-{Regular,Medium,SemiBold,Bold}.woff2`, `Damavand-ExtraBold.woff2`, `IRANYekanX-Regular.ttf`, `IRANYekanXFaNum-{Regular,Bold}.woff2`, `IRANSansX-Regular.ttf`, `IRANSansXFaNum-{Regular,Bold}.woff2`, `IRAN.woff2`, `IRANBold.woff2`, `IRANBlack.woff2`, `IRAN-FaNum.woff`.

- [ ] **Step 1: Extract (no `unzip` on this box — use Python).** Run the extraction script (see spec §4.1 for the family→role mapping); it copies the members above into `public/fonts/`. Print `MISS` for any member not found so names can be corrected.
- [ ] **Step 2: Verify every file is non-zero and a real font** — `ls -la public/fonts` (all > 1KB) and `file public/fonts/*` (woff2/woff/ttf, not "empty" / "ASCII").
- [ ] **Step 3: Commit** — `git add public/fonts && git commit -m "Self-host Peyda/Damavand/IRANYekanX/IRANSansX/IRAN fonts"`.

### Task 1.2: `app/fonts.ts` — local font declarations

**Files:** Create `app/fonts.ts`. Read `node_modules/next/dist/docs/` for `next/font/local` first.

**Interfaces:**
- Produces: named exports `ui` (Peyda, `--font-ui`, weights 100–900 via the woff2 set, `display:"swap"`), `uiNum` (PeydaFaNum, `--font-num`, weights 400–700, `display:"swap"`), `display` (Damavand, `--font-display`, weight 800), `yekan`/`yekanNum` (`--font-yekan`/`--font-yekan-num`), `sans`/`sansNum` (`--font-sans-x`/`--font-sans-x-num`), `iran`/`iranNum` (`--font-iran`/`--font-iran-num`). Each is a `NextFontWithVariable` exposing `.variable`.

- [ ] **Step 1:** Write `app/fonts.ts` with one `localFont({ src: [...], variable, display, weight/style })` per family. Peyda `src` lists all 10 weights with numeric `weight` values (`Thin`=100 … `ExtraBlack`=950). FaNum families map `weight` 400/500/600/700.
- [ ] **Step 2:** `npx tsc --noEmit` — expect clean (or only pre-existing errors).
- [ ] **Step 3: Commit** — `git add app/fonts.ts && git commit -m "app/fonts.ts: local font declarations"`.

### Task 1.3: `lib/fontChoices.ts` + `lib/font.ts` + `tests/font.test.ts`

**Files:** Create `lib/fontChoices.ts`, `lib/font.ts`, `tests/font.test.ts`. Model on `lib/accentThemes.ts` + `lib/accent.ts` + `tests/accent.test.ts` verbatim in shape.

**Interfaces:**
- Produces (`lib/fontChoices.ts`): `FONT_CHOICES = [{id:"peyda",label:"پیدا"},{id:"yekan",label:"ایران‌یکان"},{id:"sans",label:"ایران‌سنس"},{id:"iran",label:"ایران"}] as const`; `type FontId`; `DEFAULT_FONT: FontId = "peyda"`; `isFontId(v: unknown): v is FontId`.
- Produces (`lib/font.ts`): `FONT_KEY = "coverage-font"`, `FONT_CHANGE_EVENT = "coverage-font-change"`, `FONT_INIT_SCRIPT` (blocking IIFE: read key, if valid `document.documentElement.setAttribute("data-font", v)`; try/catch), `applyFont(f: FontId)`, `readFont(): FontId`. Re-exports `DEFAULT_FONT`, `isFontId`, `FontId`.

- [ ] **Step 1: Write `tests/font.test.ts`** — assert `isFontId("peyda")` true, `isFontId("comic")` false, `isFontId(null)` false; `DEFAULT_FONT === "peyda"`; `FONT_CHOICES` ids are unique and all pass `isFontId`.
- [ ] **Step 2:** `npx vitest run tests/font.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Write `lib/fontChoices.ts` then `lib/font.ts` (copy `lib/accent.ts` structure; swap key/attr/event names; no hex).
- [ ] **Step 4:** `npx vitest run tests/font.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add lib/fontChoices.ts lib/font.ts tests/font.test.ts && git commit -m "Font preference: lib/font.ts + choices + tests"`.

### Task 1.4: Wire fonts into `app/layout.tsx` + `globals.css` tokens

**Files:** Modify `app/layout.tsx`, `app/globals.css`.

**Interfaces:**
- Consumes: `app/fonts.ts` exports; `FONT_INIT_SCRIPT` from `lib/font.ts`.
- Produces: `<html>` carries every font `.variable` + `data-font` set pre-paint. CSS: `--font-ui`, `--font-num`, `--font-display` defined on `:root`; `--font-yekan`/`--font-sans-x`/`--font-iran` (+ `-num`) defined; `:root[data-font="yekan"|"sans"|"iran"]` remap `--font-ui`/`--font-num`. Legacy aliases `--font-vazirmatn`/`--font-fa`/`--font-en` → `--font-ui`; `--font-jetbrains-mono` → `--font-num`.

- [ ] **Step 1:** In `app/layout.tsx`: replace the 4 `next/font/google` imports with `import * as F from "@/app/fonts"`; drop the 4 google `const` blocks; build the className from `[F.ui, F.uiNum, F.display, F.yekan, F.yekanNum, F.sans, F.sansNum, F.iran, F.iranNum].map(f => f.variable).join(" ")` + `"h-full antialiased"`; add `<script dangerouslySetInnerHTML={{ __html: FONT_INIT_SCRIPT }} />` right after the accent init script.
- [ ] **Step 2:** In `app/globals.css` `@theme`/`:root` block (near line 220 & 244): point `--font-sans`/`--font-vazirmatn`/`--font-fa`/`--font-en` at `var(--font-ui)`, `--font-mono`/`--font-jetbrains-mono` at `var(--font-num)`; add `--font-display: var(--font-damavand), var(--font-ui)`. After `:root`, add the `:root[data-font="…"]` remap rules.
- [ ] **Step 3:** In `.kargah` block, change `.top h1`, `.mark`, `.side__brand h1` to `font-family: var(--font-display)`.
- [ ] **Step 4:** `npm run lint` clean; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add app/layout.tsx app/globals.css && git commit -m "Wire local fonts: --font-ui/--font-num/--font-display + data-font remap"`.

### Task 1.5: `components/FontPicker.tsx` + mount points

**Files:** Create `components/FontPicker.tsx`; modify `app/sales/layout.tsx`, `components/CoverageMap.tsx`.

**Interfaces:**
- Consumes: `applyFont`, `readFont`, `FONT_CHANGE_EVENT`, `FONT_CHOICES`, `DEFAULT_FONT`, `useTheme`.
- Produces: `default function FontPicker({ variant?: "header"|"map", className?: string })`; `useFont(): [FontId, (f: FontId) => void]`.

- [ ] **Step 1:** Copy `components/AccentPicker.tsx` → `FontPicker.tsx`; swap accent→font APIs; the trigger glyph is «آ» set in `var(--font-ui)`; each option row renders its `label` with inline `style={{ fontFamily: "var(--font-" + id-map + ")" }}` so the preview is in that face; keep the popover dismiss/aria logic unchanged.
- [ ] **Step 2:** `app/sales/layout.tsx`: `import FontPicker` and render `<FontPicker />` immediately before `<AccentPicker />` in `.topright`.
- [ ] **Step 3:** `components/CoverageMap.tsx`: render `<FontPicker variant="map" />` immediately before `<AccentPicker variant="map" />`.
- [ ] **Step 4:** `npm run lint`; `npx tsc --noEmit` — clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "FontPicker: header + map, previews each family in its own face"`.

### Task 1.6: Phase 1 build + verify

- [ ] **Step 1:** `npm run build` — succeeds; no font-resolution errors.
- [ ] **Step 2:** Ask the user to `sudo systemctl restart` the service (or run if permitted).
- [ ] **Step 3:** Screenshot `/sales` and `/map`: font picker present in both; default text is Peyda (rounder than the old Plex/Vazir); headings are Damavand; no flash of a fallback family on reload (init script works).
- [ ] **Step 4:** Switch each font choice: body family changes, numbers stay tabular, Damavand headings unchanged, choice survives reload.

---

## Phase 2 — Accent generator: surface tint + propagation

### Task 2.1: Tokenize hardcoded terracotta in `globals.css`

**Files:** Modify `app/globals.css` (outside the `ACCENT-THEMES:BEGIN…END` block).

- [ ] **Step 1: Find them** — `grep -nE '#(C0532B|B44E28|A9451F|D9663A|B0431C)|rgba\(192, ?83, ?43' app/globals.css` (ignore hits inside the generated block).
- [ ] **Step 2: Replace** — `.mark`/`.side__mark` gradient → `linear-gradient(145deg, var(--accent), var(--accent-2))`; their `box-shadow` tint → `color-mix(in srgb, var(--accent) 55%, transparent)`; `.btn.solid` shadow likewise; any `--accent`-family literal used as text/border → the matching token.
- [ ] **Step 3:** `grep` again — zero non-generated hits.
- [ ] **Step 4: Commit** — `git add app/globals.css && git commit -m "Tokenize hardcoded terracotta so the accent picker fully re-skins /sales"`.

### Task 2.2: Neutrals solver in `scripts/gen-accent-themes.mjs`

**Files:** Modify `scripts/gen-accent-themes.mjs`. Read the whole file first — it already has an OKLCH↔hex core and a `contrastVerify` step; reuse them.

**Interfaces:**
- Produces: for each theme × skin, a `surfaceTokens(hue, skin)` returning `{ "--bg","--surface","--surface-2","--surface-sunk","--border","--border-strong","--card","--card-2","--sunk","--line","--line-2","--gcard-hue-rotate" }`. Emitted as `:root[data-accent="<id>"] .kargah, :root[data-accent="<id>"] .kargah` — **scoped to `.kargah` only** (not bare `:root`). `--gcard-hue-rotate` = `round(themeHue - TERRACOTTA_HUE)` deg (so terracotta → `0deg`).

- [ ] **Step 1:** Add `SURFACE_LADDER` — the L (and tiny C ceiling) for each token, read off today's `.kargah` light values (`--bg` `#F4F0E9`, `--surface` `#FFFFFF`, `--surface-sunk` `#EFE9E0`, `--border` `#EAE2D7`, …) and dark values (from the `:root[data-skin="dark"] .kargah` block). Chroma ceiling `0.006–0.014`.
- [ ] **Step 2:** `surfaceTokens()` — for each rung, `oklchToHex(L, min(C_ceiling, requestedC), themeHue)`, backing off chroma if it clips (the file's `oklchToHex` already reports clipping).
- [ ] **Step 3:** Assert `terracotta` (hue ≈ 44) yields hexes within ΔE 2 of today's cream values — a `--check` guard that throws otherwise.
- [ ] **Step 4:** Extend the writer to include the surface block in each theme's `.kargah`-scoped rule; keep the existing `:root, :root .kargah` accent-only defaults.
- [ ] **Step 5:** `node scripts/gen-accent-themes.mjs --check` → solves + verifies, writes nothing, exits 0.
- [ ] **Step 6: Commit** — `git add scripts/gen-accent-themes.mjs && git commit -m "gen-accent-themes: low-chroma neutrals solver, .kargah surface tint per theme"`.

### Task 2.3: `check-contrast.mjs` — surface pairs

**Files:** Modify `scripts/check-contrast.mjs`.

- [ ] **Step 1:** Add assertions: for every theme × skin, each solved surface ground (`--bg`,`--surface`,`--surface-2`,`--surface-sunk`,`--card`,`--card-2`,`--sunk`) vs each ink (`--text` ≥ 7, `--text-muted` ≥ 4.5, `--text-faint` ≥ 3, `--accent-text` ≥ 4.5). Read the solved values from the generator's in-memory result (import or re-solve), not by parsing CSS.
- [ ] **Step 2:** `npm run check:contrast` → all pass (old + new).
- [ ] **Step 3: Commit** — `git add scripts/check-contrast.mjs && git commit -m "check:contrast: assert .kargah surface x ink pairs for all themes"`.

### Task 2.4: `--gcard-hue-rotate` + regrow the CSS block

**Files:** Modify `app/globals.css`.

- [ ] **Step 1:** On `.kargah .gcard::before` (and the `:root[data-skin="dark"] .kargah .gcard.<x>::before` rules) add `filter: hue-rotate(var(--gcard-hue-rotate, 0deg));`. `--gcard-hue-rotate` defaults `0deg` on `:root .kargah`.
- [ ] **Step 2:** `node scripts/gen-accent-themes.mjs` (no flag) — rewrites the `ACCENT-THEMES` block with the new surface tokens.
- [ ] **Step 3:** `npm run lint`; `git diff --stat` shows only `app/globals.css`.
- [ ] **Step 4: Commit** — `git add app/globals.css && git commit -m "Regrow ACCENT-THEMES block with surface tint; hue-rotate gcard washes"`.

### Task 2.5: Phase 2 build + verify

- [ ] **Step 1:** `npm run build`; restart.
- [ ] **Step 2:** Screenshot `/sales` under 3 accents (terracotta, teal, purple) × 2 skins: terracotta looks identical to before; teal → cool paper + cool washes + teal brand mark + teal buttons; purple similar. No terracotta artifact anywhere.
- [ ] **Step 3:** `npm run check:contrast` green.

---

## Phase 3 — Layout + unified card system

### Task 3.1: Full-bleed `.app` + grid density + prose measure

**Files:** Modify `app/globals.css`.

- [ ] **Step 1:** `.kargah .app` — remove `max-width: 1240px`; set `width: 100%; padding-inline: clamp(14px, 4vw, 64px);` keep `padding-block` (`26px …120px`; `18px …110px` at ≤620px).
- [ ] **Step 2:** `.kargah .statrow` → `grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));` + `@media (min-width:1700px){ .kargah .statrow{ grid-template-columns: repeat(4, 1fr);} }` (keep the ≤940 / ≤620 collapses).
- [ ] **Step 3:** `.kargah .pockets`, `.kargah .ptiles` → `repeat(auto-fill, minmax(clamp(240px, 22vw, 320px), 1fr))`.
- [ ] **Step 4:** Add `.kargah .prose { max-width: 72ch; margin-inline: auto; }` and apply to academy lesson body, complaint text, objection-card body (grep `academy`, `complaint` components for the text column).
- [ ] **Step 5:** `npm run lint`; **Commit** — `git add -A && git commit -m ".app full-bleed; grid density guards; 72ch prose measure"`.

### Task 3.2: `.kcard` primitive + top bar + hover rail + `__body`

**Files:** Modify `app/globals.css`.

**Interfaces:**
- Produces: `.kargah .kcard` (border+bg+shadow+radius+`position:relative;overflow:hidden;isolation:isolate`), `.kargah .kcard__bar` (3px `inset-block-start:0` strip; default `linear-gradient(90deg,var(--accent),var(--accent-2),var(--tint-plum))`; `.kcard[data-tone="good|warn|crit|info"] .kcard__bar` → `var(--<tone>)`), `.kargah .kcard::before` edge rail (`scaleY(0)`→`1` on hover, `--spring`), `.kargah .kcard:hover` lift, `.kargah .kcard__body` (`padding: 0 24px 20px`; `16px` inline at ≤639px). Reduced-motion block zeroing transitions/transforms.
- `.kargah .kblock, .kargah .card` become aliases of `.kcard` (share the rule list); `.kargah .kblock .bhead` unchanged.

- [ ] **Step 1:** Write the `.kcard` rules near the existing `.card`/`.prow` section; fold `.prow`'s `::before` rail into `.kcard::before`; keep `.prow` as `.kcard` + its grid specifics.
- [ ] **Step 2:** Alias `.kblock`/`.card`; add `.kcard__body`/`.kblock__body`.
- [ ] **Step 3:** `npm run lint`; **Commit** — `git add app/globals.css && git commit -m ".kcard primitive: colorful top bar (gradient|status), hover rail, body inset"`.

### Task 3.3: Image-1 fix — table body inset

**Files:** Modify `components/predict/DemandTable.tsx`, `ChurnList.tsx`, `LearnedCapacity.tsx` (+ any other `.kblock` with a flush table — grep `overflow-x-auto` in `components/`).

- [ ] **Step 1:** Wrap each `<div className="overflow-x-auto">…table…</div>` so the scroll container is `<div className="kblock__body overflow-x-auto">`. Where the `.kblock` has only a table (no `.bhead` padding sibling), the body class supplies the inset.
- [ ] **Step 2:** Build not required yet — visual check deferred to 3.6. `npm run lint`.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "Image-1: inset .kblock table bodies so Farsi figures stay inside the card"`.

### Task 3.4: Image-2 fix — pocket doc edges in dark

**Files:** Modify `app/globals.css`; check `components/kargah/PocketCard.tsx`, `components/sales/OrderPocketCard.tsx` for inline shadow overrides.

- [ ] **Step 1:** `.kargah .doc` — add `border: 1px solid var(--border-strong);`.
- [ ] **Step 2:** Add `:root[data-skin="dark"] .kargah .doc { border-color: rgba(255,255,255,.10); box-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 2px 8px rgba(0,0,0,.45), 0 12px 28px -14px rgba(0,0,0,.6); }`.
- [ ] **Step 3:** If `PocketCard`/`OrderPocketCard` set `box-shadow` inline on the doc elements, move it to the class or add the dark variant there too.
- [ ] **Step 4:** `npm run lint`; **Commit** — `git add -A && git commit -m "Image-2: give pocket 'doc' cards a visible edge on the dark skin"`.

### Task 3.5: Migrate card consumers to `.kcard` + `data-tone`

**Files:** `components/kargah/{OrdersPockets,ProductsView,ScheduleBoard,EarnerCard,CarvedCard,PocketCard,OrderPocketCard}.tsx`, `components/sales/{PaymentsPanel,ChequesBoard,BatchesPanel,ComplaintsPanel,AssignmentBoard}.tsx`, `components/analysis/*.tsx`.

- [ ] **Step 1:** For each card element currently using `.card`/`.kblock`/bespoke card CSS: add `kcard` to its class list and, as the first child, `<span className="kcard__bar" aria-hidden="true" />`. Move body content into a `.kcard__body` wrapper where padding was ad-hoc.
- [ ] **Step 2:** For lifecycle cards (orders, cheques, deliveries, tasks, runs, payments), map the existing status → `data-tone` (`good`/`warn`/`crit`/`info`) on the `.kcard` element. Reuse the component's existing status→color logic; do not invent new states.
- [ ] **Step 3:** `npm run lint`; `npx tsc --noEmit` clean.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "Adopt .kcard + status top bar across sales cards"`.

### Task 3.6: Phase 3 build + verify

- [ ] **Step 1:** `npm run build`; restart.
- [ ] **Step 2:** Screenshots: 21:9 `/sales` fills viewport, grids sane density, prose ≤72ch; `/sales/forecast` figures inside the card; `/sales/pocket` dark skin doc edges visible; every card has a top bar (gradient default, status where applicable) + hover lift/rail.

---

## Phase 4 — Navigation + dashboard/analysis merge

### Task 4.1: Grouped tab data + labels + `tests/salesNav.test.ts`

**Files:** Modify `app/sales/layout.tsx`; create `lib/salesNav.ts` (extract the tab list so it is testable); create `tests/salesNav.test.ts`.

**Interfaces:**
- Produces (`lib/salesNav.ts`): `SALES_GROUPS: {id,label}[]` (6, order: `day`,`sales`,`delivery`,`money`,`stock`,`admin` → labels روز من / فروش و سفارش / تحویل / مالی / انبار / مدیریت); `salesTabs(session): (Tab & {group: GroupId})[]` — the current list with `group` added and labels per spec §8 (schedule → «مسیر امروز»; `/sales/reps` → «نمایندگان فروش»; `/sales/admin/representatives` → «تعریف نمایندگی»; `/sales/dashboard` → «تحلیل فروش»; drop the `/sales/analysis` entry).

- [ ] **Step 1: Write `tests/salesNav.test.ts`** — for a stub owner session: every tab's `group` is one of `SALES_GROUPS` ids; hrefs are unique; labels are unique among `ready` tabs; no tab points at `/sales/analysis`.
- [ ] **Step 2:** `npx vitest run tests/salesNav.test.ts` → FAIL.
- [ ] **Step 3:** Create `lib/salesNav.ts` (move the array out of `layout.tsx`, add `group` + relabel); `layout.tsx` imports `salesTabs(session)` and `SALES_GROUPS`.
- [ ] **Step 4:** `npx vitest run tests/salesNav.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Sales nav: 6 groups, disambiguated labels, testable list"`.

### Task 4.2: Grouped `TabPill`

**Files:** Modify `components/kargah/TabPill.tsx`; add CSS for `.seg-groups` in `app/globals.css`.

**Interfaces:**
- Consumes: `SALES_GROUPS`, tabs with `.group`.
- Produces: `TabPill({ tabs, groups })`. Renders a `.seg-groups` row of group buttons; the active group = the group of the longest-prefix-matched active tab (fallback: first group with a `ready` tab). Only the active group's tabs render in the existing `.seg` pill row; the travelling-thumb logic is unchanged but re-runs on group change. A group with no `ready` tab is not rendered.

- [ ] **Step 1:** Add `groups` prop; compute `activeGroup` from `active` tab; `visibleTabs = tabs.filter(t => t.group === activeGroup)`.
- [ ] **Step 2:** Render `.seg-groups` (buttons link to that group's first `ready` tab). Keep `.seg` markup for `visibleTabs`. Add `activeGroup` to the `move()` effect deps.
- [ ] **Step 3:** CSS `.kargah .seg-groups` — horizontal, wraps, active button uses `--accent-soft` bg + `--accent-text`.
- [ ] **Step 4:** `npm run lint`; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "TabPill: group row + per-group travelling pill"`.

### Task 4.3: Merge analysis into dashboard

**Files:** Modify `app/sales/dashboard/page.tsx`, `app/sales/analysis/page.tsx`; grep for `href="/sales/analysis"`.

- [ ] **Step 1:** Move the data-loading + JSX from `analysis/page.tsx` (`ActionCenter`, `KpiStrip`, `MarginTable`, the «سلامت مشتری» `.kblock`) into `dashboard/page.tsx` below its existing KPI tiles, under `<h2 className="…">تحلیل عمیق</h2>`. Merge the two `SweepButton`s (keep both endpoints; label the analysis one «به‌روزرسانی تحلیل»). Dedupe imports/session logic.
- [ ] **Step 2:** `analysis/page.tsx` → keep `export const dynamic = "force-dynamic"` and a default component that calls `redirect("/sales/dashboard")`.
- [ ] **Step 3:** Repoint any `<Link href="/sales/analysis">` → `/sales/dashboard`.
- [ ] **Step 4:** Update `RevealRoute` `REVEAL["/sales/dashboard"]` to include the analysis selectors (`.kcard`, `.sect`); remove the `/sales/analysis` key.
- [ ] **Step 5:** `npm run lint`; `npx tsc --noEmit`.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "Merge /sales/analysis into /sales/dashboard; redirect old route"`.

### Task 4.4: Phase 4 build + verify

- [ ] **Step 1:** `npm run build`; restart.
- [ ] **Step 2:** `/sales/analysis` → 307/redirect to `/sales/dashboard`; dashboard shows KPIs then تحلیل عمیق sections. Tab bar: 6 groups; switching a group swaps the pill row; pill animates within a group; empty groups hidden for a salesperson session. No two visible tabs share a label.
- [ ] **Step 3:** `npx vitest run` — full suite green.

---

## Phase 5 — Animation layer

### Task 5.1: `usePrefersReducedMotion` + `useCountUp` (+ tests)

**Files:** Create `lib/usePrefersReducedMotion.ts`, `lib/useCountUp.ts`, `tests/useCountUp.test.ts`.

**Interfaces:**
- Produces: `usePrefersReducedMotion(): boolean` (SSR-safe: `false` until mounted; subscribes to the media query). `useCountUp(target: number, opts?: { durationMs?: number }): number` — returns `target` immediately when reduced or on first SSR paint; otherwise animates `0…target` (or `prev…target` on change) with `easeOutCubic` over `durationMs ?? 600`, via `requestAnimationFrame`.

- [ ] **Step 1: Write `tests/useCountUp.test.ts`** (vitest + `@testing-library/react` `renderHook`, jsdom, fake timers/rAF stub): with reduced-motion mocked true → first value is `target`; with false → advances past 0 and lands exactly on `target` after `durationMs`.
- [ ] **Step 2:** `npx vitest run tests/useCountUp.test.ts` → FAIL.
- [ ] **Step 3:** Implement both hooks.
- [ ] **Step 4:** `npx vitest run tests/useCountUp.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Animation helpers: usePrefersReducedMotion, useCountUp (+tests)"`.

### Task 5.2: `Stagger` component

**Files:** Create `components/kargah/Stagger.tsx`; add `.kargah .stag`/`.stag-in` CSS.

**Interfaces:**
- Consumes: `usePrefersReducedMotion`.
- Produces: `Stagger({ children, step? = 40, className? }): JSX` — wraps each direct child in a `<div class="stag">`; on mount (or when it scrolls into view via one shared `IntersectionObserver`) toggles `stag-in` with `transition-delay: min(i, 10) * step ms`. Reduced motion → renders children with `stag-in` already set, no transition.

- [ ] **Step 1:** Implement; CSS `.stag{opacity:0;transform:translateY(6px);transition:opacity .32s var(--ease),transform .32s var(--ease)} .stag-in{opacity:1;transform:none}` inside a `@media (prefers-reduced-motion: no-preference)` guard, with a plain `.stag{opacity:1;transform:none}` default.
- [ ] **Step 2:** `npm run lint`; `npx tsc --noEmit`.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "Stagger: capped fade+slide list entrance, reduced-motion safe"`.

### Task 5.3: Wire animation into consumers

**Files:** `components/BentoStrip.tsx` (`useCountUp` in `BentoTile`, `BentoGauge` centre number); `app/sales/dashboard/page.tsx` KPI `<strong>` figures; `components/kargah/{OrdersPockets,ProductsView,ScheduleBoard}.tsx` + merged analysis tables (wrap lists/`tbody` groups in `<Stagger>`); `components/kargah/RevealRoute.tsx` (route cross-fade).

- [ ] **Step 1:** `BentoTile`/`BentoGauge`: parse the numeric part of `value`, feed `useCountUp`, re-format via `faNum`; non-numeric values pass through untouched.
- [ ] **Step 2:** Wrap `.pockets`, `.ptiles`, `.plist`, and the analysis table bodies in `<Stagger>` (Stagger renders a wrapper — keep the grid class on it).
- [ ] **Step 3:** `RevealRoute`: on `pathname` change, before the existing stagger, set the scroll container (`.app > .rev` root or a new `.route-fade` wrapper in `app/sales/layout.tsx`) to `opacity:0;translateY(8px)` then to `opacity:1;none` on the next frame; gate on reduced motion. Keep the per-card stagger it already does.
- [ ] **Step 4:** `npm run lint`; `npx tsc --noEmit`; `npx vitest run`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Wire count-up, stagger, and route cross-fade into /sales"`.

### Task 5.4: Chart draw-in

**Files:** `components/BentoStrip.tsx` (`BentoGauge` arc), any bar/line chart in the merged analysis sections. Reference `components/kargah/SalesSpark.tsx` for the pattern.

- [ ] **Step 1:** `BentoGauge`: animate the value arc's `stroke-dasharray` from `0` to `track*f` on mount (CSS transition on the `<circle>` or a rAF), gated on reduced motion. The centre number already gets `useCountUp` from 5.3.
- [ ] **Step 2:** For bar charts in analysis: transition `height`/`transform: scaleY` from 0 on mount with a small per-bar delay.
- [ ] **Step 3:** `npm run lint`; **Commit** — `git add -A && git commit -m "Chart draw-in: gauge arc + analysis bars animate on mount"`.

### Task 5.5: Final build + full verification (spec §12)

- [ ] **Step 1:** `npm run build`; restart.
- [ ] **Step 2:** `npm run lint` · `npx vitest run` · `npm run check:contrast` · `node scripts/gen-accent-themes.mjs --check` — all green.
- [ ] **Step 3:** Manual walk (screenshots) of the full spec §12 checklist: accents × skins, font choices, 21:9, image-1, image-2, card bars + hover, analysis redirect + merged sections, 6-group nav, and **reduced-motion** (no count-up / stagger / route slide / hover transform).
- [ ] **Step 4:** `superpowers:finishing-a-development-branch` — decide merge of `sales-redesign`.

---

## Self-Review

**Spec coverage:**
- §4 fonts → Tasks 1.1–1.6. §4.3 picker → 1.5. ✓
- §5.1 propagation fixes → 2.1, 2.4. §5.2 surface tint → 2.2, 2.3, 2.4. §5.3 default → constraints. ✓
- §6 full-bleed → 3.1. ✓
- §7 card system: primitive 3.2, bar 3.2, hover 3.2, image-1 3.3, image-2 3.4, migration 3.5. ✓
- §8 nav → 4.1, 4.2. §9 merge → 4.3. ✓
- §10 animation: helpers 5.1, Stagger 5.2, wiring 5.3, charts 5.4. ✓
- §12 verification → 5.5 + per-phase verify tasks. §13 phasing → the five phases. ✓

**Placeholder scan:** CSS/visual tasks intentionally end in build+screenshot, not unit tests (documented in the header). No "TBD"/"handle edge cases". The extraction script member paths in 1.1 are taken from the verified `zipinfo` listing; `MISS` output catches any drift. `components/analysis/*` card adoption (3.5) depends on reading those files at execution — acceptable, they are small and named.

**Type consistency:** `FontId`/`isFontId`/`DEFAULT_FONT` defined in `lib/fontChoices.ts` (1.3), consumed by `lib/font.ts` (1.3), `FontPicker` (1.5). `SALES_GROUPS`/`salesTabs` defined in `lib/salesNav.ts` (4.1), consumed by `layout.tsx` (4.1) and `TabPill` (4.2). `usePrefersReducedMotion`/`useCountUp` defined 5.1, consumed 5.2/5.3/5.4. `.kcard`/`.kcard__bar`/`.kcard__body`/`data-tone` defined 3.2, consumed 3.3/3.5/5.3. Consistent. ✓
