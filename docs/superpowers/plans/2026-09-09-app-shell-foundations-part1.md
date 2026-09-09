# App Shell & Foundations — Part 1 (Rename + Cold Palette + Leaf Primitives) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `kargah` design-system namespace to `meridian`, re-temperature the palette from warm to cold, and build the leaf-level primitives (`Icon`, `Card`, `Counter`, `CardHelp`, motion presets, the app-wide nav registry) that the shell work in Part 2 depends on — with no visual regression beyond the intended colour shift.

**Architecture:** Part 1 touches tokens, one stylesheet, a component folder rename, two build scripts, and adds five self-contained components under `components/meridian/`. No route files move (that is Part 2). Every task ends green on `npm run build`, `npm test`, `npm run lint`, and — for palette tasks — `npm run check:contrast`.

**Tech Stack:** Next.js 16.3.1 (App Router; **read `node_modules/next/dist/docs/` before touching any Next file** — this repo runs a build of Next with breaking changes, see `AGENTS.md`), React 19.2, Tailwind v4, TypeScript 5, Vitest 4, Playwright. New deps this plan adds: `lucide-react`, `framer-motion`.

**Spec:** `docs/superpowers/specs/2026-09-09-app-shell-and-foundations-design.md` (Sections 0 and the primitive halves of Section 3). Part 2 covers Sections 1, 2, 4, 5.

## STATUS: Part 1 complete (branch `app-shell-foundations`)

| Task | Commit | Notes |
|---|---|---|
| 1 deps | `036e279` | lucide-react@1.43, framer-motion@13.2 |
| 2 rename kargah→meridian | `a05311e` | + NUL-byte bug in `lib/repo/notifications.ts` |
| 3+4 warm→cold palette | `e75d1e9` | default accent → ocean; `check:contrast` 500/500 |
| 5 MASTER.md | `2c1af6e` | + cool shadows in globals.css |
| 6 lib/motion.ts | `9850009` | framer-motion presets from MASTER.md Motion |
| 7 Icon | `9850009` | lucide wrapper, `resolveIcon` pure-tested |
| 8 Card primitive | — | **dropped** (repo has CarvedCard/GradientStat/.gcard/.card/.kblock) |
| 9 Counter | — | **already shipped** as `CountUp` + `useCountUp` + tests |
| 10 CardHelp | `dc31028` | standalone + `lib/help/` registry |
| 11 appNav + field group | — | **moved to Part 2** (inseparable from HoverPill/shell) |
| 12 close-out | this | full gate, tag `app-shell-foundations-part1` |

New tests added: `tests/skin.test.ts` (cold-ground guard), `tests/motion.test.ts`,
`tests/meridian-icon.test.ts`, `tests/meridian-help.test.ts`. Total suite 1870→~1885.

Lint: still the 2 pre-existing `set-state-in-effect` errors in `components/board/`,
zero new.

**Part 2 carries forward:** `appNav`+`field` group, the route-group shell, `AppShell`,
one-row header (`HoverPill`, hover `ProfileMenu`, bell relocation, `⌘K` slot),
`PageHeaderCard`, per-route `loading.tsx`, `/analytics` merge, the whole-app icon/card
sweep (now that `Icon`/`CardHelp` exist), the decorative warm-token cleanup
(`--gcard-*`, `--frost`, `--island-*`, `--wash-mint/sand/sky`), and the MASTER.md
map + motion sections.

## Progress & deviations (updated during execution)

- **Baseline (branch point):** build ✓, 1868 tests pass, `check:contrast` ✓ (500 pairs, not 260 — plan estimate was low). Lint has **2 pre-existing errors** (`components/board/Board.tsx:79`, `BoardMobile.tsx:40`, both `react-hooks/set-state-in-effect`) unrelated to this slice. Gate for this plan is therefore "no *new* lint errors", not "zero".
- **Task 1 (deps):** done. `lucide-react@1.43.0`, `framer-motion@13.2.0` (current as of 2026-09; lucide is on 1.x now). Commit `036e279`.
- **Task 2 (rename):** done. Commit `a05311e`. Extra work: `lib/repo/notifications.ts` carries 3 stray NUL bytes (used as map-key separators, e.g. `` `${code}\0push` ``), so `grep -I` treated it as binary and the sweep skipped it — its `PUSH_TAG "kargah-digest"` was patched directly. **NUL separators left in place** (behaviour-adjacent; pre-existing). *Follow-up candidate: replace the `\0` separators with a printable delimiter so the file is text again.*
- **Tasks 3+4 (cold palette) — merged and reordered.** They are inseparable (grounds → default accent → regenerate). The default accent is switched by **reordering the `THEMES` array in `scripts/gen-accent-themes.mjs` so `ocean` is `themes[0]`** — the solver derives both `dflt` (the no-attribute CSS block) and `DEFAULT_ACCENT` from `themes[0]`. `lib/accentThemes.ts` is solver-generated; editing it directly is futile.
  - Stale hard-coded grounds also live in **`scripts/check-contrast.mjs`** in *three* blocks: `SURFACE_CREAM`, `SURFACE_INK`, `THEME_GROUND` — all updated to the cold values. The dark *map* ground (`THEME_GROUND.dark.map`) stays `#12100F` (the map keeps its own identity).
  - Contrast iteration: cold grounds triggered 12 near-miss failures, all `--wash-ink-muted` / `--text-faint`; resolved by nudging `SKINS.*.washInkMuted`, `SURFACE_INKS.light.faint`, and the `check-contrast.mjs` `THEME_GROUND.washMuted` mirror. Final: **500/500 pass.**
  - **Decorative warm tokens deferred:** `--gcard-*`, `--frost*`, `--island-*`, `--tick-ink`, `--notice-ink`, `--serie-b`, `--ev-*-ink`, `--wash-mint/sand/sky` in the hand `.meridian` blocks are still warm-brown. They are outside any contrast pair and belong to the gradient-stat / island / frost components — re-tinted in **Part 2** when those get the primitive pass.
- **Primitive discovery (affects Tasks 8, 9):** `components/meridian/` **already contains** `CarvedCard.tsx` (= the planned `Card` w/ carved-bay notch), `CountUp.tsx` (= the planned `Counter`), `PocketCard.tsx` + `Pocketed.tsx` + `OrdersPockets.tsx` (the pocket device), `GradientStat.tsx`, `Reveal.tsx`. MASTER.md's `TARGET` markers for these are **stale — they are SHIPPED.** Revised approach: **do not rebuild.** Task 8/9 become "audit the existing `CarvedCard`/`CountUp` against the spec's API, extend if needed, add tests". Only `Icon`, `CardHelp`, `lib/motion.ts`, `lib/appNav.ts` are genuinely new.

## Global Constraints

- **Namespace:** the design system is `meridian`. CSS scope class `.meridian` (never `:root`). Components in `components/meridian/`. No `kargah` string may remain in `app/`, `components/`, `lib/`, `scripts/`, `tests/`, `types/` after Task 2 — only `docs/` history keeps it. Verify with `grep -rn kargah app components lib scripts tests types`.
- **Palette temperature:** cold. Light ground `--bg` cool off-white (anchor `#F1F3F6`), `--surface` `#FFFFFF`. Dark ground `--bg` cool near-black (anchor `#0F1214`), still **not** the map's blue-black. Default accent theme is **`ocean`** (`اقیانوسی`); `graphite` (`گرافیت`) is the documented neutral fallback. Exact token hexes are whatever `scripts/gen-accent-themes.mjs` + hand-solve land on — the gate is the checker, not the anchor.
- **Contrast gate:** `npm run check:contrast` must exit 0 (260 pairs, every theme × skin × ground). Never loosen a threshold in `scripts/check-contrast.mjs` to pass; move the failing token.
- **Status semantics never move:** `--good` = visited/paid, `--warn` = needs coverage/partial, `--crit` = keep-out/critical-debt, `--info` = in-transit. Only their hex values may be re-tuned against the cold grounds, and only if a pair fails.
- **No visual regression** beyond the deliberate warm→cold shift. `RevealRoute` / `RouteFade` entrance motion is unchanged (only its `@keyframes` names get the `meridian-` prefix).
- **Do not alter the document-pocket card** (`components/meridian/Pocket.tsx` after the rename — the `OrderPocketCard` with two documents stacked behind it, fanning on hover). Task 3/4 may only re-point its colours at the cold tokens. Its extraction into a reusable `<PocketCard>` and reuse elsewhere is Part 2 — see spec "Preserved & promoted devices".
- **TDD:** failing test → run it red → minimal impl → run it green → commit. One logical change per commit.
- **Commit message trailer:** end every commit body with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

## File Structure

**Renamed (Task 2):**
- `components/kargah/` → `components/meridian/` (folder `git mv`; 8 files inside)

**Modified (Tasks 1–4):**
- `app/globals.css` — `.kargah` → `.meridian` (~700 scoped rules), `@keyframes kargah-*` → `meridian-*`, the warm surface-token block re-anchored to cold, the `ACCENT-THEMES:BEGIN…END` generated block regenerated
- `scripts/gen-accent-themes.mjs` — `GROUNDS`, `SURFACE_BASE`, `SURFACE_INKS` re-anchored to cold; `.kargah` selector in the emitted block → `.meridian`; comment prose
- `scripts/check-contrast.mjs` — any hard-coded ground hexes re-anchored to cold; `.kargah` mentions → `.meridian`
- `lib/theme.ts` — `.kargah` mentions in comments/strings → `.meridian`
- `lib/accentThemes.ts` — `DEFAULT_ACCENT` `"terracotta"` → `"ocean"`
- `lib/accent.ts` — comment mention of the default
- ~18 component/page files that reference the `kargah` class or `components/kargah/` import path (see Task 2 list)
- `tests/accent.test.ts`, `tests/skin.test.ts`, `tests/notifications-flush.test.ts`, `tests/api/notifications-channels-route.test.ts` — `kargah` → `meridian`
- `MASTER.md` — title, thesis headings, all warm/workshop prose → cold framing; `.kargah` → `.meridian`; accent-themes default row
- `package.json` / `package-lock.json` — `lucide-react`, `framer-motion` added

**Created (Tasks 5–9):**
- `lib/motion.ts` — framer-motion transition/variant presets mirroring `MASTER.md` Motion tokens
- `components/meridian/Icon.tsx` + `components/meridian/icon-map.ts` — lucide wrapper, monochrome, tokenised sizes
- `components/meridian/Card.tsx` — standardised card + `CardHeader` subcomponent, optional `notch`
- `components/meridian/Counter.tsx` — animated number, in-view / mount trigger, reduced-motion aware
- `components/meridian/CardHelp.tsx` + `lib/help/index.ts` + `lib/help/types.ts` — `(i)` popover + keyed copy registry
- `lib/appNav.ts` (from `lib/salesNav.ts`) — nav registry with the `field` group and adopted routes
- Tests: `tests/motion.test.ts`, `tests/meridian/Icon.test.tsx`, `tests/meridian/Card.test.tsx`, `tests/meridian/Counter.test.tsx`, `tests/meridian/CardHelp.test.tsx`, `tests/appNav.test.ts` (from `tests/salesNav.test.ts`)

---

## Task 1: Prep — branch, baseline, dependency install

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: `lucide-react` and `framer-motion` resolvable; a green baseline recorded.

- [ ] **Step 1: Create the working branch**

```bash
git checkout main && git pull --ff-only
git checkout -b app-shell-foundations
```

- [ ] **Step 2: Record the green baseline**

```bash
npm run build && npm test && npm run lint && npm run check:contrast
```
Expected: all four exit 0. If any fails on a clean `main`, STOP and report — the plan assumes a green start.

- [ ] **Step 3: Install the two new deps**

```bash
npm install lucide-react@latest framer-motion@latest
```
Expected: `package.json` `dependencies` gains both; lockfile updates.

- [ ] **Step 4: Verify nothing broke**

```bash
npm run build && npm test
```
Expected: exit 0 (nothing imports them yet).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add lucide-react and framer-motion

Part 1 of the app-shell & foundations slice. No imports yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Rename `kargah` → `meridian` (mechanical, whole-repo)

**Files:**
- Rename: `components/kargah/` → `components/meridian/`
- Modify (class / import / keyframe / string references): `app/globals.css`, `lib/theme.ts`, `scripts/gen-accent-themes.mjs`, `scripts/check-contrast.mjs`, `app/sales/layout.tsx`, `app/sales/page.tsx`, `app/sales/commission/page.tsx`, `app/sales/dashboard/page.tsx`, `app/sales/orders/page.tsx`, `app/sales/products/page.tsx`, `app/sales/schedule/page.tsx`, `app/sales/stock/page.tsx`, `app/sales/today/page.tsx`, `app/settings/layout.tsx`, `components/CoverageMap.tsx`, `components/CustomerDetailPanel.tsx`, `components/MapLoader.tsx`, `components/board/Board.tsx`, `components/pocket/Pocket.tsx`, `components/sales/OrderPipeline.tsx`, `components/sales/ProcessingModal.tsx`, `components/today/Briefing.tsx`, `components/meridian/*` (the moved files' internal refs), `tests/accent.test.ts`, `tests/skin.test.ts`, `tests/notifications-flush.test.ts`, `tests/api/notifications-channels-route.test.ts`
- Do **not** touch: anything under `docs/` (history).

**Interfaces:**
- Produces: `.meridian` CSS scope; `@/components/meridian/*` import path; `@keyframes meridian-route-in` / `meridian-arc-draw`; zero `kargah` tokens outside `docs/`.

- [ ] **Step 1: Move the component folder**

```bash
git mv components/kargah components/meridian
```

- [ ] **Step 2: Rewrite every `kargah` reference outside `docs/`**

```bash
grep -rl 'kargah' app components lib scripts tests types \
  | xargs sed -i 's/kargah/meridian/g'
```
This catches: the `.kargah` class → `.meridian`, `components/kargah/` import paths → `components/meridian/`, `@keyframes kargah-route-in` → `meridian-route-in`, `kargah-arc-draw` → `meridian-arc-draw`, and comment prose. It is safe because `kargah` is a coined token that never overlaps a real English/Persian identifier.

- [ ] **Step 3: Rewrite the Persian design-system name in `app/globals.css` and comments**

In `app/globals.css` and any moved component file, the Persian word `کارگاه` ("workshop") appears in header comments. Replace each `کارگاه` with `مریدین` (transliteration of "meridian") so the comments stay coherent. Grep: `grep -rn 'کارگاه' app components lib scripts`.

- [ ] **Step 4: Verify the rename is total**

```bash
grep -rn 'kargah\|کارگاه' app components lib scripts tests types
```
Expected: no output.

- [ ] **Step 5: Build, test, lint**

```bash
npm run build && npm test && npm run lint && npm run check:contrast
```
Expected: all exit 0. The generated `ACCENT-THEMES` block still says `.kargah` if `check:contrast` reads the CSS — if `check:contrast` fails on a selector mismatch, run `node scripts/gen-accent-themes.mjs` (it now emits `.meridian`) and re-run. Commit the regenerated block as part of this task.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename design-system namespace kargah -> meridian

Mechanical whole-repo rename ahead of the shell work: .kargah CSS scope
-> .meridian, components/kargah/ -> components/meridian/, @keyframes
prefix, and the کارگاه -> مریدین prose. docs/ history untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Re-temperature the grounds — warm → cold (tokens + solver)

**Files:**
- Modify: `app/globals.css` (the hand-authored `.meridian` surface-token block, both skins), `scripts/gen-accent-themes.mjs` (`GROUNDS` ~L138, `SURFACE_BASE` ~L167, `SURFACE_INKS` ~L216), `scripts/check-contrast.mjs` (any hard-coded ground hexes)

**Interfaces:**
- Consumes: nothing.
- Produces: cold ground tokens; the solver and checker agree on the new grounds. The `ACCENT-THEMES` generated block is **not** regenerated in this task (Task 4 does that after the default flips) — so `check:contrast` may report accent-pair failures at the end of this task; ground/ink/border pairs must pass.

- [ ] **Step 1: Write the failing check — a ground-temperature assertion**

Add to `tests/skin.test.ts`:

```ts
import { readFileSync } from "node:fs";

test("meridian ground tokens are cold, not warm", () => {
  const css = readFileSync("app/globals.css", "utf8");
  // light --bg: cool off-white — blue channel >= red channel
  const light = css.match(/\.meridian\s*{[^}]*?--bg:\s*(#[0-9A-Fa-f]{6})/s);
  expect(light).toBeTruthy();
  const hex = light![1];
  const r = parseInt(hex.slice(1, 3), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  expect(b).toBeGreaterThanOrEqual(r); // cold: blue not below red
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run tests/skin.test.ts -t "cold, not warm"`
Expected: FAIL — current `--bg` is `#F4F0E9` (r=244 > b=233).

- [ ] **Step 3: Re-anchor the ground tokens in `app/globals.css`**

In the `.meridian { … }` light block and the `:root[data-skin="dark"] .meridian` dark block, replace the surface tokens with the cold anchors (adjust only if Step 6 fails a pair):

```
/* light */
--bg:#F1F3F6; --surface:#FFFFFF; --surface-2:#F8FAFC; --surface-sunk:#E7EBF0;
--border:#E1E6EC; --border-strong:#CFD6DF;
--text:#1A1F24; --text-muted:#5C6672; --text-faint:#8A93A0;

/* dark */
--bg:#0F1214; --surface:#171B1F; --surface-2:#1D2226; --surface-sunk:#232A2F;
--border:#2A3238; --border-strong:#37414A;
--text:#EEF2F5; --text-muted:#8A97A2; --text-faint:#8A8278;
```
Keep every alias (`--card`, `--sunk`, `--line`, …) pointing at its source token — do not inline.

- [ ] **Step 4: Re-anchor the solver grounds**

In `scripts/gen-accent-themes.mjs`, set `GROUNDS.light` / `GROUNDS.dark`, `SURFACE_BASE.light` / `.dark`, and `SURFACE_INKS.light` / `.dark` to the exact same hexes as Step 3. In `scripts/check-contrast.mjs`, do the same for any ground hex it hard-codes (grep `#F4F0E9`, `#141110`, `#231C16`, `#F3EEE7`).

- [ ] **Step 5: Run the ground assertion green**

Run: `npx vitest run tests/skin.test.ts -t "cold, not warm"`
Expected: PASS.

- [ ] **Step 6: Solver self-check + contrast on non-accent pairs**

```bash
node scripts/gen-accent-themes.mjs --check
```
Expected: it reports the accent solve against the new grounds. If it reports a **ground/ink/border** contradiction (text on bg below 4.5, border below its gate), nudge that token in both Step 3 and Step 4 locations and repeat. Accent-pair complaints are expected here and are fixed in Task 4.

- [ ] **Step 7: Commit**

```bash
git add app/globals.css scripts/gen-accent-themes.mjs scripts/check-contrast.mjs tests/skin.test.ts
git commit -m "feat: re-anchor meridian grounds from warm cream to cold blue-grey

Light --bg #F4F0E9 -> #F1F3F6, dark --bg #141110 -> #0F1214, and the
matching surface/border/ink shifts, in the stylesheet and in both build
scripts. Accent themes regenerate in the next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Flip the default accent to `ocean` and regenerate the themes

**Files:**
- Modify: `lib/accentThemes.ts` (`DEFAULT_ACCENT`), `lib/accent.ts` (comment), `app/globals.css` (`ACCENT-THEMES:BEGIN…END` block — regenerated, plus the non-generated default `:root .meridian` accent tokens if they are hand-authored for terracotta), `tests/accent.test.ts`

**Interfaces:**
- Consumes: cold grounds from Task 3.
- Produces: `DEFAULT_ACCENT === "ocean"`; regenerated accent block; `npm run check:contrast` green.

- [ ] **Step 1: Update the failing test**

In `tests/accent.test.ts`, change the default-accent expectation:

```ts
test("the default accent is ocean", () => {
  expect(DEFAULT_ACCENT).toBe("ocean");
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run tests/accent.test.ts -t "default accent is ocean"`
Expected: FAIL — still `"terracotta"`.

- [ ] **Step 3: Flip the default**

`lib/accentThemes.ts`: `export const DEFAULT_ACCENT: AccentId = "ocean";`
Update the `lib/accent.ts` doc comment that names terracotta as the default.
If `app/globals.css` has a hand-authored default accent block (tokens `--accent`, `--accent-ink`, `--accent-text`, `--accent-soft`, `--wash-*`, `--ev-a-ink` on `.meridian` without a `data-accent` selector) that duplicates terracotta's values, replace those with `ocean`'s solved values from the regenerated block in Step 4 (or point the default at `[data-accent="ocean"]`'s values).

- [ ] **Step 4: Regenerate the accent themes against the cold grounds**

```bash
node scripts/gen-accent-themes.mjs
```
Expected: rewrites the `ACCENT-THEMES:BEGIN…END` block in `app/globals.css` and `lib/accentThemes.ts`'s generated companion (if it writes one). The `terracotta` theme is still emitted — it is one of the ten, just no longer the default.

- [ ] **Step 5: Contrast gate**

```bash
npm run check:contrast
```
Expected: exit 0. If a pair fails, it will name the token and the ground; nudge that token's constraint in `scripts/gen-accent-themes.mjs` (not the threshold in `check-contrast.mjs`) and re-run Step 4–5. Re-check the `MASTER.md` "critical had to move off red" note — with a blue accent, `--crit` may return toward true red; let the solver place it.

- [ ] **Step 6: Full green**

```bash
npm run build && npm test && npm run lint && npm run check:contrast
```
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/accentThemes.ts lib/accent.ts app/globals.css tests/accent.test.ts
git commit -m "feat: default accent terracotta -> ocean, themes regenerated cold

Warm-to-cold: the default accent is now اقیانوسی. All ten themes
re-solved against the cold grounds; check:contrast green (260 pairs).
terracotta stays available, just not default.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `MASTER.md` — cold thesis prose + namespace

**Files:**
- Modify: `MASTER.md`

**Interfaces:**
- Produces: `MASTER.md` describes a cold system named meridian; no warm/workshop language; no `kargah`.

- [ ] **Step 1: Rewrite the thesis sections**

Edit `MASTER.md`:
- Title: `MASTER — RouteFlow Design System` (drop nothing; it is already generic).
- "Visual thesis": replace `کارگاه — a warm workshop, not an instrument panel.` with `مریدین — a cool, quiet workbench, lit from the north.` Rewrite the paragraph: "cool off-white ground, white surfaces lifted by real shadow, generous radii, and an **ocean** accent — calm and exact where every other operations tool in the category shouts." Keep the anti-cockpit paragraph (the rejected thesis was a *dark-navy-cyan console*; this is light-default with physical devices — that contrast still holds).
- "Interaction thesis": `Warm and physical.` → `Cool and physical.` Leave the spring/choreography rules verbatim.
- "Color" section: update the Light and Dark token tables to the Task 3 hexes and the Task 4 regenerated accent values (copy the final solved numbers out of `app/globals.css`). Update the four "findings" notes to match what the cold solve actually did (esp. the `--crit` hue note).
- "Accent themes": change the table row `خاکی (default)` → `اقیانوسی (default)`; note `خاکی` and `گرافیت` remain in the ten.
- Replace every remaining `کارگاه` / `.kargah` with `مریدین` / `.meridian`.

- [ ] **Step 2: Sanity check**

```bash
grep -n 'کارگاه\|kargah\|warm\|terracotta\|cream' MASTER.md
```
Expected: only deliberate mentions (e.g. a "was warm cream, now cold" changelog line if you add one). No stray warm language in the live thesis.

- [ ] **Step 3: Commit**

```bash
git add MASTER.md
git commit -m "docs: MASTER.md — cold thesis, ocean accent, meridian namespace

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `lib/motion.ts` — framer-motion presets from the Motion tokens

**Files:**
- Create: `lib/motion.ts`, `tests/motion.test.ts`

**Interfaces:**
- Consumes: `MASTER.md` Motion section (curves, durations).
- Produces:
  - `export const DUR: { instant: number; fast: number; base: number; slow: number }` — seconds (framer-motion uses seconds).
  - `export const EASE: { standard: [number,number,number,number]; entrance: [number,number,number,number]; exit: [number,number,number,number] }`
  - `export const SPRING_SNAP: { type: "spring"; stiffness: number; damping: number }`
  - `export const SPRING_SOFT: { type: "spring"; stiffness: number; damping: number }`
  - `export function withReducedMotion<T extends object>(t: T, reduced: boolean): T | { duration: 0 }` — returns `{ duration: 0 }` when `reduced`.
  - `export const fadeInUp: Variants` — `{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE.entrance } } }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/motion.test.ts
import { DUR, EASE, SPRING_SNAP, withReducedMotion, fadeInUp } from "@/lib/motion";

test("durations are in seconds and ordered", () => {
  expect(DUR.instant).toBeLessThan(DUR.fast);
  expect(DUR.fast).toBeLessThan(DUR.base);
  expect(DUR.base).toBeLessThan(DUR.slow);
  expect(DUR.slow).toBeLessThan(1); // seconds, not ms
});

test("eases are 4-tuple cubic-beziers", () => {
  for (const e of [EASE.standard, EASE.entrance, EASE.exit]) {
    expect(e).toHaveLength(4);
    e.forEach((n) => expect(typeof n).toBe("number"));
  }
});

test("withReducedMotion collapses to an instant transition", () => {
  expect(withReducedMotion(SPRING_SNAP, true)).toEqual({ duration: 0 });
  expect(withReducedMotion(SPRING_SNAP, false)).toBe(SPRING_SNAP);
});

test("fadeInUp hides at opacity 0 and shows at 1", () => {
  expect((fadeInUp.hidden as any).opacity).toBe(0);
  expect((fadeInUp.show as any).opacity).toBe(1);
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run tests/motion.test.ts`
Expected: FAIL — `@/lib/motion` not found.

- [ ] **Step 3: Implement `lib/motion.ts`**

Read the Motion section of `MASTER.md` for the real curve/duration numbers; use these if it is silent:

```ts
import type { Variants } from "framer-motion";

/** framer-motion transition presets. The single source is MASTER.md "Motion";
 *  these mirror it in framer-motion's units (seconds, not ms) so no component
 *  hand-rolls a curve. Pure-CSS RevealRoute/RouteFade keep their own copy. */
export const DUR = { instant: 0.08, fast: 0.14, base: 0.24, slow: 0.42 } as const;

export const EASE = {
  standard: [0.2, 0, 0, 1] as [number, number, number, number],
  entrance: [0.16, 1, 0.3, 1] as [number, number, number, number],
  exit: [0.4, 0, 1, 1] as [number, number, number, number],
};

export const SPRING_SNAP = { type: "spring", stiffness: 520, damping: 32 } as const;
export const SPRING_SOFT = { type: "spring", stiffness: 260, damping: 30 } as const;

export function withReducedMotion<T extends object>(t: T, reduced: boolean) {
  return reduced ? ({ duration: 0 } as const) : t;
}

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE.entrance } },
};
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run tests/motion.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add lib/motion.ts tests/motion.test.ts
git commit -m "feat: lib/motion — framer-motion presets mirroring MASTER.md Motion

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `components/meridian/Icon.tsx` — the one icon primitive

**Files:**
- Create: `components/meridian/Icon.tsx`, `components/meridian/icon-map.ts`, `tests/meridian/Icon.test.tsx`

**Interfaces:**
- Consumes: `lucide-react`.
- Produces:
  - `export type IconName` — a string-literal union of the mapped names.
  - `export const ICON_SIZE: { sm: 16; md: 20; lg: 24 }`
  - `export function Icon(props: { name: IconName; size?: keyof typeof ICON_SIZE; className?: string; "aria-label"?: string; strokeWidth?: number }): JSX.Element` — renders the mapped lucide component at the tokenised pixel size, `stroke="currentColor"`, `strokeWidth` default `1.75`, `aria-hidden` unless `aria-label` is given.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/meridian/Icon.test.tsx
import { render } from "@testing-library/react";
import { Icon, ICON_SIZE } from "@/components/meridian/Icon";

test("renders an svg at the tokenised size with currentColor stroke", () => {
  const { container } = render(<Icon name="truck" size="lg" />);
  const svg = container.querySelector("svg")!;
  expect(svg).toBeTruthy();
  expect(svg.getAttribute("width")).toBe(String(ICON_SIZE.lg));
  expect(svg.getAttribute("stroke")).toBe("currentColor");
  expect(svg.getAttribute("aria-hidden")).toBe("true");
});

test("exposes a label when given one", () => {
  const { container } = render(<Icon name="truck" aria-label="ماشین" />);
  const svg = container.querySelector("svg")!;
  expect(svg.getAttribute("aria-hidden")).toBeNull();
  expect(svg.getAttribute("aria-label")).toBe("ماشین");
});
```
(If the repo has no `@testing-library/react`, check `package.json`; `tests/` currently uses `jsdom` + `vitest`. Add `@testing-library/react` + `@testing-library/dom` as devDeps in this task's Step 3 and note it in the commit.)

- [ ] **Step 2: Run it red**

Run: `npx vitest run tests/meridian/Icon.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// components/meridian/icon-map.ts
import { Truck, MapPin, Bell, User, Info, Search, ChevronLeft, ChevronRight,
  Plus, X, Check, TriangleAlert, Package, Calendar, CloudSun } from "lucide-react";

/** The app's icon vocabulary. Add a name here, never import lucide directly in a
 *  feature file — that is how stroke width and size drift back in. */
export const ICONS = {
  truck: Truck, "map-pin": MapPin, bell: Bell, user: User, info: Info,
  search: Search, "chevron-left": ChevronLeft, "chevron-right": ChevronRight,
  plus: Plus, x: X, check: Check, warn: TriangleAlert, package: Package,
  calendar: Calendar, weather: CloudSun,
} as const;

export type IconName = keyof typeof ICONS;
```

```tsx
// components/meridian/Icon.tsx
import { ICONS, type IconName } from "./icon-map";

export type { IconName };
export const ICON_SIZE = { sm: 16, md: 20, lg: 24 } as const;

export function Icon({
  name, size = "md", className, strokeWidth = 1.75, ...rest
}: {
  name: IconName;
  size?: keyof typeof ICON_SIZE;
  className?: string;
  strokeWidth?: number;
  "aria-label"?: string;
}) {
  const L = ICONS[name];
  const px = ICON_SIZE[size];
  const label = rest["aria-label"];
  return (
    <L
      width={px}
      height={px}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run tests/meridian/Icon.test.tsx`
Expected: PASS (2).

- [ ] **Step 5: Build + lint**

```bash
npm run build && npm run lint
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add components/meridian/Icon.tsx components/meridian/icon-map.ts tests/meridian/Icon.test.tsx package.json package-lock.json
git commit -m "feat: meridian/Icon — lucide wrapper, monochrome, tokenised sizes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: `components/meridian/Card.tsx` — the standardised card + `CardHeader`

**Files:**
- Create: `components/meridian/Card.tsx`, `tests/meridian/Card.test.tsx`
- Modify: `app/globals.css` (add `.meridian .mcard*` rules; no removal of old card rules yet — that sweep is Part 2)

**Interfaces:**
- Consumes: `lib/motion.ts` (`SPRING_SOFT`), `components/meridian/Icon.tsx` (in `CardHeader` help slot wiring, later).
- Produces:
  - `export function Card(props: { children: ReactNode; className?: string; notch?: "none" | "block-start"; notchSlot?: ReactNode; interactive?: boolean; as?: "div" | "section" | "article" })` — a `.mcard` element; when `interactive` it lifts on hover via the one shared rule; when `notch !== "none"` it renders the carved-bay cut (`clip-path`) and places `notchSlot` in the opened space.
  - `export function CardHeader(props: { title: ReactNode; help?: ReactNode; actions?: ReactNode })` — `.mcard__head` with an optional trailing `help` slot and `actions` slot.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/meridian/Card.test.tsx
import { render } from "@testing-library/react";
import { Card, CardHeader } from "@/components/meridian/Card";

test("plain card has no notch and no interactive class", () => {
  const { container } = render(<Card>x</Card>);
  const el = container.querySelector(".mcard")!;
  expect(el).toBeTruthy();
  expect(el.classList.contains("mcard--notch")).toBe(false);
  expect(el.classList.contains("mcard--interactive")).toBe(false);
});

test("notch card renders its notchSlot content", () => {
  const { getByText, container } = render(
    <Card notch="block-start" notchSlot={<span>tabs</span>}>body</Card>,
  );
  expect(container.querySelector(".mcard--notch")).toBeTruthy();
  expect(getByText("tabs")).toBeTruthy();
});

test("CardHeader shows title and help slot", () => {
  const { getByText } = render(<CardHeader title="عنوان" help={<button>i</button>} />);
  expect(getByText("عنوان")).toBeTruthy();
  expect(getByText("i")).toBeTruthy();
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run tests/meridian/Card.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the component**

```tsx
// components/meridian/Card.tsx
import type { ReactNode } from "react";

export function Card({
  children, className = "", notch = "none", notchSlot, interactive = false, as = "div",
}: {
  children: ReactNode;
  className?: string;
  notch?: "none" | "block-start";
  notchSlot?: ReactNode;
  interactive?: boolean;
  as?: "div" | "section" | "article";
}) {
  const Tag = as;
  const cls = [
    "mcard",
    notch !== "none" && "mcard--notch",
    interactive && "mcard--interactive",
    className,
  ].filter(Boolean).join(" ");
  return (
    <Tag className={cls} data-notch={notch === "none" ? undefined : notch}>
      {notch !== "none" && <div className="mcard__notch">{notchSlot}</div>}
      {children}
    </Tag>
  );
}

export function CardHeader({
  title, help, actions,
}: { title: ReactNode; help?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mcard__head">
      <div className="mcard__title">{title}</div>
      {(help || actions) && (
        <div className="mcard__head-end">
          {actions}
          {help}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the CSS**

Append to `app/globals.css` (inside the `.meridian` scope region), values from tokens only:

```css
.meridian .mcard {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--elev-1);
  padding: var(--space-4);
}
.meridian .mcard--interactive {
  transition: transform var(--dur-base) var(--ease), box-shadow var(--dur-base) var(--ease);
}
.meridian .mcard--interactive:hover {
  transform: translateY(-2px);
  box-shadow: var(--elev-2);
}
@media (prefers-reduced-motion: reduce) {
  .meridian .mcard--interactive { transition: none; }
  .meridian .mcard--interactive:hover { transform: none; }
}
.meridian .mcard--notch {
  /* carved bay along the block-start edge; see MASTER.md "Carved bay card" */
  --notch-h: 34px;
  --notch-w: 44%;
  position: relative;
}
.meridian .mcard--notch .mcard__notch {
  position: absolute;
  inset-block-start: calc(var(--notch-h) * -1);
  inset-inline-start: var(--space-4);
  height: var(--notch-h);
  display: flex; align-items: center; gap: var(--space-2);
}
.meridian .mcard__head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.meridian .mcard__head-end { display: flex; align-items: center; gap: var(--space-2); }
```
If a token name above does not exist (`--elev-1`, `--radius-lg`, `--space-4`, `--dur-base`, `--ease`), grep `app/globals.css` for the real name and use it. Do **not** introduce a literal.

- [ ] **Step 5: Run it green + build**

```bash
npx vitest run tests/meridian/Card.test.tsx && npm run build && npm run lint
```
Expected: PASS (3), build exit 0.

- [ ] **Step 6: Commit**

```bash
git add components/meridian/Card.tsx tests/meridian/Card.test.tsx app/globals.css
git commit -m "feat: meridian/Card — standardised card, one hover rule, optional carved-bay notch

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `components/meridian/Counter.tsx` — animated metric

**Files:**
- Create: `components/meridian/Counter.tsx`, `tests/meridian/Counter.test.tsx`

**Interfaces:**
- Consumes: `framer-motion` (`useInView`, `animate`, `useMotionValue`), `lib/motion.ts` (`DUR`, `EASE`).
- Produces:
  - `export function Counter(props: { to: number; from?: number; format?: (n: number) => string; trigger?: "in-view" | "mount"; className?: string })` — renders a `<span>`; animates `from`→`to` on the chosen trigger; under `prefers-reduced-motion` renders `format(to)` immediately with no animation frame.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/meridian/Counter.test.tsx
import { render } from "@testing-library/react";
import { Counter } from "@/components/meridian/Counter";

// jsdom reports reduced-motion by default via our matchMedia mock; assert the
// endpoint is rendered synchronously.
test("renders the formatted target value", () => {
  const { getByText } = render(<Counter to={1234} format={(n) => `${Math.round(n)}`} />);
  expect(getByText("1234")).toBeTruthy();
});

test("uses an identity format by default", () => {
  const { getByText } = render(<Counter to={7} />);
  expect(getByText("7")).toBeTruthy();
});
```
Confirm `tests/` has a `matchMedia` mock that returns `matches: true` for `(prefers-reduced-motion: reduce)`; if not, add one to this test file's setup so the assertion is deterministic.

- [ ] **Step 2: Run it red**

Run: `npx vitest run tests/meridian/Counter.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { animate, useInView } from "framer-motion";
import { DUR, EASE } from "@/lib/motion";

const prefersReduced = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Counter({
  to, from = 0, format = (n) => `${n}`, trigger = "in-view", className,
}: {
  to: number;
  from?: number;
  format?: (n: number) => string;
  trigger?: "in-view" | "mount";
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const [text, setText] = useState(() => format(prefersReduced() ? to : from));

  useEffect(() => {
    if (prefersReduced()) { setText(format(to)); return; }
    const go = trigger === "mount" || inView;
    if (!go) return;
    const controls = animate(from, to, {
      duration: DUR.slow,
      ease: EASE.entrance,
      onUpdate: (v) => setText(format(v)),
    });
    return () => controls.stop();
  }, [inView, trigger, from, to, format]);

  return <span ref={ref} className={className}>{text}</span>;
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run tests/meridian/Counter.test.tsx`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add components/meridian/Counter.tsx tests/meridian/Counter.test.tsx
git commit -m "feat: meridian/Counter — count-up metric, in-view trigger, reduced-motion safe

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: `components/meridian/CardHelp.tsx` + help registry

**Files:**
- Create: `lib/help/types.ts`, `lib/help/index.ts`, `components/meridian/CardHelp.tsx`, `tests/meridian/CardHelp.test.tsx`

**Interfaces:**
- Consumes: `components/meridian/Icon.tsx` (`info`), `framer-motion` (`AnimatePresence`, `motion`), `lib/motion.ts`.
- Produces:
  - `lib/help/types.ts`: `export type HelpEntry = { id: string; title: string; what: string; how: string } | { id: string; todo: true }`
  - `lib/help/index.ts`: `export const HELP: Record<string, HelpEntry>`; `export function getHelp(id: string): HelpEntry` (returns `{ id, todo: true }` when unmapped); `export function todoHelpIds(): string[]`
  - `components/meridian/CardHelp.tsx`: `export function CardHelp(props: { id: string; className?: string })` — an `(i)` button that toggles a popover; when the entry is `todo` it shows «راهنمای این بخش به‌زودی».

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/meridian/CardHelp.test.tsx
import { render, fireEvent } from "@testing-library/react";
import { CardHelp } from "@/components/meridian/CardHelp";
import { getHelp, todoHelpIds } from "@/lib/help";

test("unmapped id resolves to a todo entry", () => {
  expect(getHelp("nope.nope")).toEqual({ id: "nope.nope", todo: true });
  expect(todoHelpIds()).toContain("nope.nope" as never); // only after it's referenced
});

test("clicking the trigger opens the popover", () => {
  const { getByRole, queryByRole } = render(<CardHelp id="dashboard.revenue" />);
  expect(queryByRole("dialog")).toBeNull();
  fireEvent.click(getByRole("button"));
  expect(getByRole("dialog")).toBeTruthy();
});
```
(Drop the `todoHelpIds` line if you do not track referenced-but-unmapped ids at runtime; keep the registry test simple — `getHelp` fallback is the load-bearing behaviour.)

- [ ] **Step 2: Run it red**

Run: `npx vitest run tests/meridian/CardHelp.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the registry**

```ts
// lib/help/types.ts
export type HelpEntry =
  | { id: string; title: string; what: string; how: string }
  | { id: string; todo: true };
```

```ts
// lib/help/index.ts
import type { HelpEntry } from "./types";

/** Contextual help copy, keyed by a stable id a card passes to <CardHelp id=…>.
 *  Persian. Unmapped ids render a "coming soon" line and are safe. */
export const HELP: Record<string, Exclude<HelpEntry, { todo: true }>> = {
  "dashboard.revenue": {
    id: "dashboard.revenue",
    title: "درآمد دوره",
    what: "جمع مبلغ سفارش‌های تأییدشده در بازهٔ انتخاب‌شده.",
    how: "با دورهٔ قبل مقایسه کنید؛ افت بیش از ۱۵٪ را بررسی کنید.",
  },
};

export function getHelp(id: string): HelpEntry {
  return HELP[id] ?? { id, todo: true };
}

export function todoHelpIds(): string[] {
  return []; // populated in Part 2 as cards register ids; kept for the debt report
}
```

```tsx
// components/meridian/CardHelp.tsx
"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/meridian/Icon";
import { DUR, EASE } from "@/lib/motion";
import { getHelp } from "@/lib/help";

export function CardHelp({ id, className }: { id: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const entry = getHelp(id);
  return (
    <span className={`mhelp ${className ?? ""}`}>
      <button
        type="button"
        className="mhelp__trigger"
        aria-expanded={open}
        aria-label="راهنما"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="info" size="sm" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="راهنما"
            className="mhelp__panel"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DUR.fast, ease: EASE.entrance } }}
            exit={{ opacity: 0, y: -4, transition: { duration: DUR.fast } }}
          >
            {"todo" in entry ? (
              <p className="mhelp__todo">راهنمای این بخش به‌زودی</p>
            ) : (
              <>
                <p className="mhelp__title">{entry.title}</p>
                <p className="mhelp__what">{entry.what}</p>
                <p className="mhelp__how">{entry.how}</p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
```

- [ ] **Step 4: Add minimal CSS**

Append to `app/globals.css` `.meridian` scope: `.mhelp` (relative), `.mhelp__trigger` (bare button, `color: var(--text-faint)`, hover `var(--text-muted)`), `.mhelp__panel` (absolute, `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-md)`, `box-shadow: var(--elev-2)`, `padding: var(--space-3)`, `max-width: 32ch`, `z-index` above cards). Token names verified against the file.

- [ ] **Step 5: Run it green + build**

```bash
npx vitest run tests/meridian/CardHelp.test.tsx && npm run build && npm run lint
```
Expected: PASS, build exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/help components/meridian/CardHelp.tsx tests/meridian/CardHelp.test.tsx app/globals.css
git commit -m "feat: meridian/CardHelp — (i) popover + keyed help registry with todo fallback

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: `lib/appNav.ts` — nav registry with the `field` group

**Files:**
- Rename: `lib/salesNav.ts` → `lib/appNav.ts`, `tests/salesNav.test.ts` → `tests/appNav.test.ts`
- Modify: every importer of `@/lib/salesNav` (grep: `app/sales/layout.tsx`, `components/meridian/TabPill.tsx`, and any others `grep -rl "lib/salesNav"` finds)

**Interfaces:**
- Consumes: `lib/roles.ts` (`Role`).
- Produces (superset of today's `salesNav.ts` API, renamed):
  - `export type AppGroupId = "day" | "sales" | "delivery" | "money" | "stock" | "admin" | "field"`
  - `export const APP_GROUPS: { id: AppGroupId; label: string }[]` — the six existing plus `{ id: "field", label: "میدان و نقشه" }`
  - `export type AppTab = { href: string; label: string; group: AppGroupId; ready: boolean }`
  - `export function appTabs(session: { role: Role }): AppTab[]` — today's `salesTabs` list plus, in `field`: `{ href: "/map", label: "نقشهٔ پوشش", group: "field", ready: true }`, `{ href: "/planner", label: "برنامه‌ریز مسیر", group: "field", ready: r !== "salesperson" }`, `{ href: "/leads", label: "سرنخ‌ها", group: "field", ready: isRepLead(r) }`; and in `money`: `{ href: "/report", label: "گزارش پوشش", group: "money", ready: true }`
  - `export function activeGroup(pathname: string, tabs: AppTab[]): AppGroupId` — today's `activeSalesGroup`, renamed
- Keep thin re-export `lib/salesNav.ts` **only if** `grep -rl "lib/salesNav"` shows importers outside the ones this task updates; otherwise delete it.

- [ ] **Step 1: Move the files, then update the test**

```bash
git mv lib/salesNav.ts lib/appNav.ts
git mv tests/salesNav.test.ts tests/appNav.test.ts
```
In `tests/appNav.test.ts`, update imports to `@/lib/appNav`, rename symbols (`SALES_GROUPS`→`APP_GROUPS`, `salesTabs`→`appTabs`, `activeSalesGroup`→`activeGroup`, `SalesGroupId`→`AppGroupId`, `SalesTab`→`AppTab`), and add:

```ts
test("every ready tab lands in exactly one known group", () => {
  const tabs = appTabs({ role: "owner" });
  const ids = new Set(APP_GROUPS.map((g) => g.id));
  for (const t of tabs.filter((t) => t.ready)) expect(ids.has(t.group)).toBe(true);
});

test("the field group carries map, planner, leads", () => {
  const hrefs = appTabs({ role: "owner" }).filter((t) => t.group === "field").map((t) => t.href);
  expect(hrefs).toEqual(expect.arrayContaining(["/map", "/planner", "/leads"]));
});

test("no visible tab points at the retired /analytics", () => {
  expect(appTabs({ role: "owner" }).some((t) => t.href.startsWith("/analytics"))).toBe(false);
});

test("no two visible tabs share a label or href", () => {
  const vis = appTabs({ role: "owner" }).filter((t) => t.ready);
  expect(new Set(vis.map((t) => t.href)).size).toBe(vis.length);
  expect(new Set(vis.map((t) => t.label)).size).toBe(vis.length);
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run tests/appNav.test.ts`
Expected: FAIL — symbols not renamed in the source yet.

- [ ] **Step 3: Rename symbols and add the `field` group in `lib/appNav.ts`**

Apply the renames from the Interfaces block. Add the `field` group to `APP_GROUPS`. In `appTabs`, append the four new tabs (`/map`, `/planner`, `/leads`, `/report`) with the `ready` predicates given. Keep `isManager` / `isRepLead` helpers as-is.

- [ ] **Step 4: Update importers**

```bash
grep -rl 'lib/salesNav\|salesTabs\|SALES_GROUPS\|activeSalesGroup' app components \
  | xargs sed -i -e 's#lib/salesNav#lib/appNav#g' -e 's/salesTabs/appTabs/g' \
      -e 's/SALES_GROUPS/APP_GROUPS/g' -e 's/activeSalesGroup/activeGroup/g' \
      -e 's/SalesGroupId/AppGroupId/g' -e 's/SalesTab/AppTab/g'
```
Then read each changed file and fix any now-wrong local naming (e.g. a variable literally named `salesTabs`).

- [ ] **Step 5: Green**

```bash
npx vitest run tests/appNav.test.ts && npm run build && npm test && npm run lint
```
Expected: all exit 0. `TabPill` still renders the six sales groups plus the new `field` group — that is fine; it becomes `HoverPill` in Part 2.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: lib/salesNav -> lib/appNav, add the field group (map/planner/leads/report)

Nav registry now covers the routes that join the shell in Part 2. Same
ready/role gating; invariants extended.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: Part 1 close-out — full green, visual pass, tag

**Files:** none (verification only)

- [ ] **Step 1: Full gate**

```bash
npm run build && npm test && npm run lint && npm run check:contrast
```
Expected: all exit 0.

- [ ] **Step 2: Manual visual pass**

Run `npm run dev`, open `/sales`, `/sales/dashboard`, `/sales/today` in both skins (toggle in the header). Confirm: the palette reads cold (no cream, no terracotta), the ocean accent is the default, cards and nav look unchanged in structure, entrance motion still plays. Note anything off in `docs/superpowers/plans/2026-09-09-app-shell-foundations-part1.md` under a "Deviations" heading.

- [ ] **Step 3: Tag the milestone**

```bash
git tag app-shell-foundations-part1
```

- [ ] **Step 4: Write Part 2**

Invoke `superpowers:writing-plans` for Sections 1, 2, 4, 5 of the spec, now that `Icon` / `Card` / `Counter` / `CardHelp` / `appNav` signatures are real and can be referenced verbatim.

---

## Self-Review

**Spec coverage (Sections 0 + primitive half of 3):**
- 0a rename → Task 2, Task 5, Task 11. ✓
- 0b warm→cold grounds → Task 3; default accent → Task 4; `check:contrast` gate → Tasks 3, 4, 12. ✓
- 0b thesis prose → Task 5. ✓
- Decision 11 (bare routes wear palette) → **not in Part 1** — it is a layout change, correctly deferred to Part 2 (route groups). Flagged here so it is not lost.
- `Icon` → Task 7; `Card` (+ notch, one hover) → Task 8; `Counter` → Task 9; `CardHelp` + registry → Task 10; `lib/motion.ts` → Task 6. ✓
- Nav registry + `field` group → Task 11. ✓
- Deps `lucide-react` + `framer-motion` → Task 1. ✓
- Whole-app icon/card/counter *rollout*, route groups, `AppShell`, header, `loading.tsx`, `/analytics` merge, `MASTER.md` map/motion section edits, `PageHeaderCard` → **Part 2** (by design).

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N". Token names in CSS steps carry a "grep for the real name, no literals" instruction because `app/globals.css` is the authority. `MASTER.md` colour-table numbers in Task 5 are "copy the solved values out of `app/globals.css`" — concrete once Task 4 runs, which precedes Task 5.

**Type consistency:** `IconName` defined in Task 7, consumed in Tasks 8/10. `DUR`/`EASE`/`SPRING_*`/`fadeInUp` defined in Task 6, consumed in Tasks 8/9/10. `getHelp`/`HelpEntry` defined in Task 10, consumed only there in Part 1. `AppTab`/`AppGroupId`/`appTabs`/`activeGroup` defined in Task 11, consumed in Part 2. `Card`/`CardHeader` props match between Task 8 impl and its test. No signature drift found.

**Ordering:** Task 3 (grounds) precedes Task 4 (accent regen) precedes Task 5 (MASTER.md tables copy solved values). Task 1 (deps) precedes every component task. Task 7 (`Icon`) precedes Task 8 and Task 10 (both import it). Correct.
