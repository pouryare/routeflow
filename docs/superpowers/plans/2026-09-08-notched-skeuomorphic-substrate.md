# Notched Skeuomorphic Substrate + Physical Kit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace RouteFlow's warm cream+terracotta `.kargah` design system with a
light-default, cool-grey+near-black, notched/skeuomorphic one, promote it from `.kargah`
(currently scoped to `/sales` and `/settings` only) to `:root` so it becomes the whole
app's default theme, and build the reusable "physical kit" — notch geometry, tilt/glow,
glass, pill controls — the rest of the app will be built from.

**Architecture:** `.kargah`'s existing token block (591 CSS rules, already light-first,
already using the video's radii/shadow shape) is retinted in place and then mechanically
promoted from a `.kargah`-scoped selector to bare `:root`, replacing the old dark-console
`:root`/`:root[data-theme="light"]` blocks outright. `lib/theme.ts` is rewritten for a
three-state auto/light/dark model with a live `matchMedia` listener. New primitives
(notch, tilt/glow, glass, pill form controls) are added as standalone, independently
testable modules with no dependency on the still-unbuilt shell or backend work.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript, Tailwind v4, Vitest. New
dependencies added in Task 2: `motion`, `lucide-react`, `clsx`, `tailwind-merge`.

**Spec:** [docs/superpowers/specs/2026-09-08-notched-skeuomorphic-substrate-design.md](../specs/2026-09-08-notched-skeuomorphic-substrate-design.md)

## Global Constraints

- **Light is the default.** The promoted token block lives in bare `:root`; the night
  skin lives in `:root[data-theme="dark"]`. Every token defined in one block is defined
  in the other — no exceptions (spec §4.2).
- **The map canvas is out of scope.** `CoverageMap.tsx`'s own dark basemap identity, and
  its `useAccent()`/`AccentPicker` dependency (both live in `components/AccentPicker.tsx`),
  are untouched by this plan. Only the *rendering* of the accent-picker widget inside the
  kargah UI (`ProfileMenu.tsx`) is removed — the underlying file, hook, and
  `ACCENT_INIT_SCRIPT` stay, because the map genuinely still reads them (Task 11).
- **`prefers-reduced-motion` must disable all new motion** (tilt, glow, drag-preview
  ambient effects) — hard requirement, not house style (spec §1).
- **`npm run check:contrast` must pass** after every token-affecting task, and every text
  pair must clear the WCAG thresholds the script asserts (4.5:1 for text, 3:1 for
  `--text-faint`, non-text only).
- **`/sales` and `/settings` must keep building and rendering** after every task — this
  plan repalettes their existing system in place; it does not rewrite their markup.
- **No component branches on theme in JS.** Every primitive consumes CSS custom
  properties and gets the right answer in both themes automatically.
- **RTL is the default writing direction** (`dir="rtl"` on `<html>`, Persian). Every new
  primitive uses logical CSS properties (`inset-inline-*`, `margin-inline-*`) and derives
  direction-sensitive math (tilt sign, notch corner) from the resolved `dir`, never a
  hardcoded `left`/`right`.
- **New dependencies must be famous and actively maintained** — verified in Task 2
  against npm/GitHub at plan-write time (2026-09-08): `motion@13.2.0` (2026-09-02),
  `lucide-react@1.43.0` (2026-09-08), `clsx@2.1.1`, `tailwind-merge@3.6.0`.
- **Corrected during execution — test file location and testing style.** `vitest.config.mts`
  restricts `include` to `tests/**/*.test.ts`; a colocated `lib/cn.test.ts` would be
  invisible to the test runner. Every test file this plan creates lives under `tests/`, mirroring its
  source path (e.g. `lib/cn.ts` → `tests/cn.test.ts`, `lib/design/notch.ts` →
  `tests/design/notch.test.ts`), matching the existing `tests/contrast.test.ts` /
  `tests/accent.test.ts` convention. Further, the config runs `environment: "node"` with
  no jsdom/happy-dom, and the repo has **zero** existing `@testing-library/react` usage or
  `.test.tsx` files anywhere — every existing test is pure-logic. This plan follows that
  convention rather than introducing component-rendering tests: wherever a task below
  originally specified a DOM-rendering test (`render`/`screen`/`fireEvent`), the
  interesting logic is tested as a plain function instead, and the component itself is
  verified by the task's existing manual browser smoke-test step. No `@testing-library/*`
  package is installed by this plan.

---

## File Structure

**New files:**
- `lib/design/notch.ts` — generalized notch-path geometry (replaces `lib/design/carve.ts`)
- `tests/design/notch.test.ts` — unit tests for the path math
- `lib/design/tilt.ts` — delegated pointer listener (`useTiltGlow` hook)
- `lib/cn.ts` — the `clsx` + `tailwind-merge` class-name helper every new component uses
- `components/kargah/NotchedCard.tsx` — generalized `CarvedCard`
- `components/kargah/TiltCard.tsx` — 3D perspective tilt wrapper
- `components/kargah/GlowSurface.tsx` — cursor-follow specular highlight
- `components/kargah/GlassFace.tsx` — frosted glass surface, extracted from the pocket
- `components/kargah/IconButton.tsx` — circular icon button
- `components/kargah/Field.tsx` — pill text input
- `components/kargah/Select.tsx` — pill select
- `components/kargah/Textarea.tsx` — pill textarea
- `components/kargah/RangeSlider.tsx` — pill-readout range slider
- `lib/design/rangeFill.ts` — pure fill-percentage math (extracted for testability)
- `tests/design/rangeFill.test.ts`
- `components/kargah/SegmentedPill.tsx` — generic sliding-pill segmented control
- `components/kargah/ArcGauge.tsx` — arc/donut gauge
- `components/kargah/StatefulButton.tsx` — idle → loading → success button
- `lib/design/statefulButton.ts` — pure state-machine reducer (extracted for testability)
- `tests/design/statefulButton.test.ts`
- `components/kargah/GooeyInput.tsx` — SVG-filter gooey search input
- `scripts/promote-kargah.mjs` — one-time mechanical migration script (Task 3), scoped to
  stop at the `ACCENT-THEMES:BEGIN` marker in `app/globals.css`

**Modified files:**
- `app/globals.css` — retint `.kargah`'s tokens, promote the hand-written block to
  `:root`, delete the dead old-console `:root`/`:root[data-theme="light"]` blocks, add
  skeuomorphic elevation tokens, add directional noise, and — separately, via Task 11's
  regeneration, NOT via the Task 3 script — sever the generated accent-theme section's
  `.kargah`-scoped rules
- `lib/theme.ts` — three-state auto/light/dark, `THEME_KEY` rename, live `matchMedia`
- `app/layout.tsx` — viewport `colorScheme`/`themeColor` update (accent script untouched)
- `app/manifest.ts` — `background_color`/`theme_color` update
- `components/kargah/ProfileMenu.tsx` — remove the `<AccentPicker />` render
- `scripts/gen-accent-themes.mjs` — stop emitting kargah-scoped accent rules (Task 11);
  the map-relevant bare-root generation is otherwise unchanged
- `components/AvatarStack.tsx` — add numeric badge support (Task 17; confirmed at this
  path, not under `components/kargah/`)
- `app/sales/page.tsx` — swap `CarvedCard` import/usage for `NotchedCard`
- `components/kargah/NotchedCard.tsx` — Task 20 adds the `noise-surface` class
- `scripts/check-contrast.mjs` — selectors move from `.kargah`/`:root[data-skin="dark"]
  .kargah` to `:root`/`:root[data-theme="dark"]`; baseline hex table updated; the
  accent-theme loop's now-dead kargah-surface-tint sub-check is deleted (must run after
  Task 11, not before — see Task 8 Step 2.5)
- `tests/contrast.test.ts` — the hardcoded "agrees with MASTER.md" pair updated to the
  new palette
- `package.json` — new dependencies
- `MASTER.md` — rewritten per Task 21

**Deleted files:**
- `lib/design/carve.ts` (superseded by `lib/design/notch.ts`)
- `components/kargah/CarvedCard.tsx` (superseded by `NotchedCard.tsx`)

**Explicitly NOT touched by this plan** (confirmed dependencies, out of scope):
`components/AccentPicker.tsx` (the `useAccent()` hook itself), `lib/accentThemes.ts` —
both still serve `CoverageMap.tsx`'s map-scoped accent choice.
`scripts/gen-accent-themes.mjs` IS touched (Task 11) but only to remove its kargah-scoped
emission — its map-relevant output is preserved. **Correction: `tests/accent.test.ts`
IS touched too**, despite the original plan listing it as untouched — Task 11's selector
change (dropping `.kargah` from every generated rule) broke two of its assertions, which
directly test the generated CSS's exact selector text. Fixed as part of Task 11, not
deferred.

---

### Task 1: Baseline

**Files:** none changed — this task only records state.

- [ ] **Step 1: Run the existing test suite and save the output**

```bash
cd /root/pourya/RouteFlow
npm test 2>&1 | tee /tmp/baseline-test-output.txt
```

- [ ] **Step 2: Run the contrast checker and save the output**

```bash
npm run check:contrast 2>&1 | tee /tmp/baseline-contrast-output.txt
```

- [ ] **Step 3: Confirm the app builds**

```bash
npm run build 2>&1 | tail -50
```

- [ ] **Step 4: Create a branch for this work**

```bash
git checkout -b theme/notched-skeuomorphic-substrate
```

- [ ] **Step 5: Commit the baseline record**

```bash
mkdir -p docs/superpowers/audits
cp /tmp/baseline-test-output.txt docs/superpowers/audits/2026-09-08-pre-substrate-test-baseline.txt
cp /tmp/baseline-contrast-output.txt docs/superpowers/audits/2026-09-08-pre-substrate-contrast-baseline.txt
git add docs/superpowers/audits/
git commit -m "chore: record pre-substrate test and contrast baseline"
```

---

### Task 2: Install dependencies and the `cn()` helper

**Files:**
- Modify: `package.json`
- Create: `lib/cn.ts`
- Test: `tests/cn.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` — used by every component task from
  Task 12 onward.

- [ ] **Step 1: Install the dependencies**

```bash
npm install motion@13.2.0 lucide-react@1.43.0 clsx@2.1.1 tailwind-merge@3.6.0
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/cn.test.ts
import { describe, it, expect } from "vitest";
import { cn } from "@/lib/cn";

describe("cn", () => {
  it("joins plain class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false && "b", null, undefined, "c")).toBe("a c");
  });

  it("resolves conflicting Tailwind utilities to the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
npx vitest run tests/cn.test.ts
```
Expected: FAIL — `lib/cn.ts` does not exist yet.

- [ ] **Step 4: Implement**

```typescript
// lib/cn.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Every new kargah component builds its className with this: clsx's conditional
 *  joining, then tailwind-merge to resolve conflicting utility classes so a caller's
 *  override always wins over the component's own default. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Run it to confirm it passes**

```bash
npx vitest run tests/cn.test.ts
```
Expected: PASS, 3/3.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/cn.ts tests/cn.test.ts
git commit -m "chore: install motion, lucide-react, clsx, tailwind-merge; add cn() helper"
```

---

### Task 3: Promote `.kargah` to `:root`

This is the load-bearing mechanical step everything else depends on. `.kargah`'s ~591
rules are scattered across `app/globals.css` (not one contiguous block) as
`.kargah ...` selectors for light and `:root[data-skin="dark"] .kargah ...` for dark. This
task writes a script that rewrites every one of them, verifies nothing was lost, then
deletes the now-dead old console.

**Amended during execution.** `app/globals.css` ends (lines 3169–3969, confirmed by the
`/* ACCENT-THEMES:BEGIN */` … `/* ACCENT-THEMES:END */` markers) in an entirely separate,
*generated* section from `scripts/gen-accent-themes.mjs` that also contains hundreds of
literal `.kargah` occurrences — in two different textual forms (`.kargah,` and
`.kargah {`), only one of which a naive regex catches consistently. A blind whole-file
replace would silently corrupt that generated block rather than promote it. The script
below is scoped to stop at the `ACCENT-THEMES:BEGIN` marker; the generated section is
Task 11's responsibility (regenerated from its own edited source, not hand-patched here).

**Files:**
- Create: `scripts/promote-kargah.mjs`
- Modify: `app/globals.css`

- [ ] **Step 1: Confirm the boundary marker and count occurrences on each side of it**

```bash
cd /root/pourya/RouteFlow
grep -n "ACCENT-THEMES:BEGIN" app/globals.css
```
Note the line number — call it `B`. Then:

```bash
head -n $(($(grep -n "ACCENT-THEMES:BEGIN" app/globals.css | cut -d: -f1) - 1)) app/globals.css | grep -c '\.kargah'
```
Note this number down — call it `N` (the hand-written occurrences this task must promote).

- [ ] **Step 2: Write the promotion script, scoped to stop at the marker**

```javascript
// scripts/promote-kargah.mjs
/** One-time mechanical migration: promotes every HAND-WRITTEN `.kargah`-scoped rule to
 *  `:root`.
 *
 *  `.kargah X` -> `X`                                  (light, becomes the default)
 *  `:root[data-skin="dark"] .kargah X` -> `:root[data-theme="dark"] X`  (dark)
 *  bare `.kargah {` -> `:root {`
 *  bare `:root[data-skin="dark"] .kargah {` -> `:root[data-theme="dark"] {`
 *
 *  STOPS at the "/* ACCENT-THEMES:BEGIN *\/" marker -- everything from there to EOF is
 *  generated by scripts/gen-accent-themes.mjs and also contains literal ".kargah" text,
 *  in forms this file's regexes were not written to distinguish from the hand-written
 *  ones. That section is handled by Task 11's edit to the generator itself, then
 *  regenerated -- never by a blind find/replace here.
 *
 *  Run once, by hand, and the diff is reviewed before committing -- this is not meant
 *  to run again. See docs/superpowers/plans/2026-09-08-notched-skeuomorphic-substrate.md
 *  Task 3.
 */
import fs from "node:fs";

const path = "app/globals.css";
const full = fs.readFileSync(path, "utf8");

const marker = "/* ACCENT-THEMES:BEGIN";
const cut = full.indexOf(marker);
if (cut === -1) throw new Error(`"${marker}" not found -- has the file structure changed?`);

let head = full.slice(0, cut);
const tail = full.slice(cut); // untouched, verbatim

// Order matters: the dark (longer, more specific) pattern must be rewritten before the
// light one, or the light rule would also match inside the dark selector's tail.
head = head.replace(/:root\[data-skin="dark"\]\s*\.kargah\b/g, ':root[data-theme="dark"]');
head = head.replace(/\.kargah\s+/g, "");   // ".kargah .foo" -> ".foo"
head = head.replace(/\.kargah\b/g, ":root"); // bare ".kargah" -> ":root"

fs.writeFileSync(path, head + tail);
console.log("done — review the diff before committing");
```

- [ ] **Step 3: Run it**

```bash
node scripts/promote-kargah.mjs
```

**Found during execution:** the script's second pass (`\.kargah\s+` → `""`, meant to
strip `.kargah ` from a descendant selector like `.kargah .foo`) also matches a bare
`.kargah` sitting alone on its own line with `{` on the next line — `\s+` consumes the
newline between them. The file's own top-level `.kargah` selector was written exactly
that way, so this pass deleted the ENTIRE selector, leaving a bare `{` with nothing
before it: invalid CSS, silently dropped by the compiler rather than erroring — `npm run
build` still succeeded, but the whole light token block stopped compiling. Caught by
reading the raw file (`cat -A`) rather than trusting build success, and fixed by hand
(re-adding `:root` before that line). If re-running this script on a fresh checkout,
check for this exact pattern — a solitary `.kargah` line — before trusting the diff:

```bash
grep -B1 -n '^\.kargah$' app/globals.css
```
If this prints anything BEFORE running the script, fix that occurrence to
`.kargah {` (same line) first, or add a fourth regex pass handling `\.kargah\s*\n\s*\{`
explicitly.

- [ ] **Step 4: Verify no hand-written rule was silently dropped, and the generated section is untouched**

```bash
head -n $(($(grep -n "ACCENT-THEMES:BEGIN" app/globals.css | cut -d: -f1) - 1)) app/globals.css | grep -c '\.kargah'
```
Expected: `0`. If it is not `0`, some occurrence used a form the regex missed (e.g.
`.kargah:hover` with no space) — inspect with
`grep -n '\.kargah' app/globals.css | awk -F: '$1 < '$B` and extend the script's patterns
to cover it, then re-run from Step 3 on a fresh checkout of the file
(`git checkout app/globals.css` first).

```bash
tail -n +$(grep -n "ACCENT-THEMES:BEGIN" app/globals.css | cut -d: -f1) app/globals.css | grep -c '\.kargah'
```
Expected: unchanged from before this task ran (the generated section's own `.kargah`
count) — confirms the marker-scoped script left it untouched, as intended.

```bash
git diff --stat app/globals.css
```
Confirm the diff touches roughly `N` lines (from Step 1) and nothing at or after the
`ACCENT-THEMES:BEGIN` line moved — spot-check with
`git diff app/globals.css | grep -A2 'ACCENT-THEMES:BEGIN'` (expect no diff hunk touching
that line or anything after it).

- [ ] **Step 5: Confirm the app still builds**

```bash
npm run build 2>&1 | tail -30
```
Two competing `:root { ... }` blocks now exist (the promoted one and the pre-existing old
dark console) — this is expected and resolved in Task 6. The build must still succeed;
CSS cascade means the later block in file order wins for any token both define, so visual
correctness is not expected yet.

- [ ] **Step 6: Commit**

```bash
git add scripts/promote-kargah.mjs app/globals.css
git commit -m "refactor: promote .kargah tokens to :root (mechanical, script-driven)"
```

---

### Task 4: Retint the promoted core tokens — light

**Files:**
- Modify: `app/globals.css`

**Correction:** `grep -n '^:root {'` alone is ambiguous here — two `:root {` blocks exist
until Task 6 deletes the old one: the dead old-console block near the top of the file
(around line 8, untouched by Task 3), and the newly-promoted block (formerly `.kargah`,
around line 1501). Locate the RIGHT one by its content, not by match order:

```bash
grep -n "Colour: light is the default and the identity" app/globals.css
```
This comment is unique to the promoted block (it was `.kargah`'s own header comment
before Task 3). Take the `:root {` line immediately above it as the block to edit.

Retint the tokens the contrast checker and every downstream task depend on to their exact
new values:

```css
--bg: #ECEDEF;
--surface: #FFFFFF;
--surface-2: #F7F8F9;
--surface-sunk: #E3E5E8;
--border: #E2E4E8;
--border-strong: #D2D6DC;
--text: #16181D;
--text-muted: #5F6672;
--text-faint: #8A909B;
--accent: #3D6FD9;
--accent-text: #2F5FC4;
--accent-ink: #FFFFFF;
--good: #1F6B45;
--warn: #8A5A00;
--crit: #A81D3A;
--info: #2A5F80;
```

`--tint-plum` stays as-is (`#6B4FA0`) — it is an avatar-tint-only colour uninvolved in the
temperature change.

**New: introduce `--primary`/`--primary-ink`.** The current system has no separate
"primary action" token — every primary button currently fills with `--accent`. The video's
signature is a near-black primary pill distinct from the (now blue, data-only) accent.
Add:

```css
--primary: #101216;
--primary-ink: #FFFFFF;
```

- [ ] **Step 1: Apply the fifteen retint edits and the two new tokens above**, inside the
  promoted `:root` block.

- [ ] **Step 2: Find every consumer of `--accent` used as a BUTTON FILL (not as text,
  link, or data colour) and repoint it to `--primary`/`--primary-ink`**

```bash
grep -rn 'background.*var(--accent)\|bg-accent\b' app/ components/ --include="*.tsx" --include="*.css" | grep -v node_modules
```
For each hit that is genuinely a primary-action fill (a submit/confirm/primary button —
not a status pill, not a link, not a chart series), change `var(--accent)` to
`var(--primary)` and its paired ink token to `var(--primary-ink)`. Leave every non-button
use of `--accent` alone — it is now correctly scoped to data/links only, which is the
point.

- [ ] **Step 3: Verify by cascade analysis, not by eyeballing — the page will still LOOK
  unchanged, correctly**

**Found during execution, and worth understanding before "eyeballing" anything:** at
this point `/sales` will still visually look like the OLD cream palette, and that is
CORRECT for this stage, for two separate reasons, not one:

1. The old dark-console `:root {}` block (deleted in Task 6) and this promoted block
   collide at equal specificity; source order (this block is later) means this block
   wins for `--bg`/`--surface`/etc. everywhere EXCEPT —
2. — `/sales` and `/settings` specifically, where `app/sales/layout.tsx:38` and
   `app/settings/layout.tsx:23` still render `className="kargah"` (Task 3 only rewrote
   `globals.css` selectors, never the `.tsx` markup). The generator's still-untouched
   `:root[data-accent="X"] .kargah { --bg: ...cream... }` rule (Task 11's target) has
   HIGHER specificity than plain `:root` and so overrides this task's `--bg` back to
   cream, specifically on the two pages you'd most want to check. `--accent` has a
   third, separate collision: the generator's bare-root default-theme rule
   (`:root, :root .kargah { --accent: #C0532B }`) sits LAST in file order among the
   *un*-scoped rules, so it wins the plain `--accent` token everywhere too, until
   Task 11.

**A browser check now would show `/sales` apparently unchanged and could look like a
regression. It is not one** — verify with cascade analysis instead, which is unambiguous
where a screenshot is not:

```bash
node -e '
const fs = require("fs");
const path = require("path");
const dir = ".next/static/chunks";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".css"));
for (const f of files) {
  const css = fs.readFileSync(path.join(dir, f), "utf8");
  if (css.includes("--bg:#ecedef")) {
    console.log(f, "offsets:",
      "old-console(#0a0e14)=" + css.indexOf("--bg:#0a0e14"),
      "this-task(#ecedef)=" + css.indexOf("--bg:#ecedef"),
      "kargah-generator(#f4f0e9)=" + css.indexOf("--bg:#f4f0e9"));
  }
}
'
```
Confirm: `this-task` offset is greater than `old-console` (so it wins the app-wide
collision already), and `kargah-generator`'s offset is greater still (confirming it is
the ONE remaining override, closed specifically by Task 11 — not by anything in this
task or Task 6). The genuinely meaningful, no-caveats visual check happens after Task 11.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css app/ components/
git commit -m "style: retint core light tokens cool+black; add --primary/--primary-ink"
```

---

### Task 5: Retint the promoted core tokens — dark

**Files:**
- Modify: `app/globals.css`

Locate the promoted dark block: `grep -n ':root\[data-theme="dark"\] {' app/globals.css`
(first match — this is what was `:root[data-skin="dark"] .kargah` before Task 3). Retint
its matching tokens:

```css
--bg: #101215;
--surface: #191C21;
--surface-2: #1F232A;
--surface-sunk: #0C0E11;
--border: #262B33;
--border-strong: #343A44;
--text: #E8EAEE;
--text-muted: #9BA3AF;
--text-faint: #6B7280;
--accent: #6D96EC;
--accent-text: #8FB0F2;
--accent-ink: #0B1220;
--good: #4BB07C;
--warn: #D9A23B;
--crit: #E8607F;
--info: #6BA8CE;

/* Inverted from light: on a dark ground the near-black primary becomes a light pill. */
--primary: #F2F4F7;
--primary-ink: #101216;
```

Every token defined in the light block from Task 4 must have a counterpart here —
cross-check by diffing the two blocks' property names:

- [ ] **Step 1: Apply the retint edits and the two new tokens above.**

- [ ] **Step 2: Verify token-name parity between the two blocks**

**Correction, same reason as Task 4:** two `:root {` blocks exist until Task 6 deletes
the dead one, so locating "the block" by selector text alone finds the wrong one first.
This script locates the promoted light block by its unique marker comment instead:

```bash
node -e '
const fs = require("fs");
const css = fs.readFileSync("app/globals.css", "utf8");
function blockAt(markerText) {
  const mIdx = css.indexOf(markerText);
  if (mIdx === -1) throw new Error(`marker not found: ${markerText}`);
  const open = css.indexOf("{", mIdx);
  let depth = 0, j = open;
  for (; j < css.length; j++) { if (css[j] === "{") depth++; else if (css[j] === "}") { depth--; if (!depth) break; } }
  return new Set([...css.slice(open, j).matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
}
const light = blockAt("Colour: light is the default and the identity");
const dark = blockAt(":root[data-theme=\"dark\"] {");
const onlyLight = [...light].filter(x => !dark.has(x));
const onlyDark = [...dark].filter(x => !light.has(x));
console.log("only in light:", onlyLight);
console.log("only in dark:", onlyDark);
'
```
(The dark block's own selector text IS unambiguous — `:root[data-theme="dark"]` did not
exist anywhere in the old system, only Task 3 creates it — so it needs no marker-based
lookup, unlike the light block.)
Both arrays print empty (`[]`). If not, add the missing token to whichever block lacks it
— MASTER.md's own hard-won rule holds: a token defined in only one theme block is a
rendering bug in the other, and it stays a real requirement even though MASTER.md's
authority does not.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style: retint core dark tokens cool+black; verify light/dark token parity"
```

---

### Task 6: Delete the dead old console; retint the token tail

**Files:**
- Modify: `app/globals.css`

**Files:**

**Amended during execution — read this before deleting anything.** The old dark console
`:root {}` (lines 8–165) is NOT purely dead colour, as the original version of this step
assumed. A precise census (every `--token` in that block, checked for whether ANY other
definition of the same name survives anywhere else in the file) found **51 tokens with no
safe replacement**: motion timing (`--ease-out`, `--spring-*`, `--dur-*`, `--stagger-tight`/
`-loose`, `--drift-duration`, `--pulse-*`, `--sweep-duration`), the spacing scale
(`--space-1`…`--space-12`), z-index stacking (`--z-map-chrome` through `--z-toast`, 9
tokens), `--elev-1/2/3` (consumed directly by `NotificationBell.tsx`, `FontPicker.tsx`,
`AccentPicker.tsx` — all mounted app-wide, all out of scope, all would silently lose their
dropdown shadow), the validated colourblind-safe chart palette `--series-1`…`--series-7` +
`--series-other` (consumed by `lib/chartPalette.ts` / `components/charts/SplineChart.tsx`),
`--facility`, `--sweep-opacity` (consumed directly by `app/login/page.tsx`), and two font
aliases. `npm run build` would still succeed if these were deleted — the breakage is
runtime-only (a missing shadow, an unstyled sweep, a wrong-hued chart series) and would not
show up until someone happened to look at the affected page.

Four of these — `--elev-1/2/3`, `--series-*`, `--facility`, `--sweep-opacity` — are
genuinely THEME-DEPENDENT: the old `:root[data-theme="light"]` block (lines 179–214, also
being deleted) redefines each with a different value. The rest are theme-INDEPENDENT and
were only ever defined once. Because `:root[data-theme="dark"]` is an *additional* rule
matching the same `<html>` element rather than an isolated scope, a theme-independent
token declared once in the (light) promoted block is automatically visible in dark mode
too — nothing needs to be duplicated into the dark block for those.

- [ ] **Step 1: Add the theme-independent tokens to the promoted light block, once**

Insert before the promoted block's closing `}` (`grep -n "Colour: light is the default"`
to locate it, then find its closing brace):

```css
/* ---- Shared infrastructure. Theme-independent -- declared once here; dark mode
   inherits these unchanged, since :root[data-theme="dark"] matches the same element
   rather than opening an isolated scope. Ported verbatim from the old console block,
   which these tokens have no other home once it is deleted below. */
--font-vazirmatn: var(--font-ui);
--font-jetbrains-mono: var(--font-num);
--font-fa: var(--font-ui);
--font-en: var(--font-num);
--font-display: var(--font-damavand), var(--font-ui), system-ui, sans-serif;

--z-map-chrome: 1000;
--z-map-overlay: 1010;
--z-prompt: 1015;
--z-panel: 1020;
--z-sidebar: 1030;
--z-sidebar-toggle: 1035;
--z-lightbox: 1050;
--z-help: 1060;
--z-toast: 1070;

--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--spring-snap: cubic-bezier(0.34, 1.26, 0.64, 1);
--spring-pop: cubic-bezier(0.34, 1.56, 0.64, 1);
--spring-drop: cubic-bezier(0.22, 1.61, 0.36, 1);
--dur-fast: 120ms;
--dur-base: 180ms;
--dur-slow: 300ms;
--dur-morph: 420ms;
--dur-settle: 320ms;
--dur-draw: 700ms;
--stagger-tight: 20ms;
--stagger-loose: 60ms;
--drift-duration: 12000ms;
--pulse-duration: 2400ms;
--pulse-stagger: 800ms;
--sweep-duration: 4000ms;

--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-12: 48px;
```

- [ ] **Step 2: Add the theme-DEPENDENT tokens' light values to the promoted light block**

Same insertion point as Step 1 — light values, ported from the doomed
`:root[data-theme="light"]` block:

```css
/* ---- Shared infrastructure, light-specific. See the dark block for the paired
   values -- these four differ by theme, unlike the tokens in Step 1. */
--sweep-opacity: 0.05;
--series-1: #0068cb;
--series-2: #b63e00;
--series-3: #018058;
--series-4: #9c6600;
--series-5: #ac0258;
--series-6: #008d00;
--series-7: #6a3fe9;
--series-other: #5f6c79;
--facility: #2b4a66;
--elev-1: 0 0 0 1px var(--border), 0 1px 2px rgba(15, 25, 34, 0.06);
--elev-2: 0 0 0 1px var(--border), 0 4px 12px rgba(15, 25, 34, 0.10);
--elev-3: 0 0 0 1px var(--border), 0 12px 32px rgba(15, 25, 34, 0.16);
```

- [ ] **Step 3: Add the same four tokens' dark values to the promoted dark block**

Locate with `grep -n ':root\[data-theme="dark"\] {' app/globals.css`, insert before its
closing `}`, values ported from the old dark console:

```css
--sweep-opacity: 0.12;
--series-1: #3987e5;
--series-2: #d95926;
--series-3: #199e70;
--series-4: #c98500;
--series-5: #d55181;
--series-6: #008300;
--series-7: #9085e9;
--series-other: #5b6b7c;
--facility: #d6e6f5;
--elev-1: 0 0 0 1px var(--border);
--elev-2: 0 0 0 1px var(--border-strong), 0 8px 24px -8px rgba(2, 5, 9, 0.9);
--elev-3: 0 0 0 1px var(--border-strong), 0 16px 48px -12px rgba(2, 5, 9, 0.95);
```

- [ ] **Step 4: Verify the 51 tokens now resolve from the promoted blocks, not the doomed
  ones, before deleting anything**

```bash
node -e '
const fs = require("fs");
const css = fs.readFileSync("app/globals.css", "utf8");
const tokens = ["--font-vazirmatn","--z-toast","--ease-out","--space-1","--sweep-opacity","--series-1","--facility","--elev-1"];
for (const t of tokens) {
  const count = (css.match(new RegExp(t.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") + "\\s*:", "g")) || []).length;
  console.log(t, "defined", count, "times total (expect 2: once light, once dark, for theme-dependent; for theme-independent expect appearing inside BOTH old+new until old is deleted next)");
}
'
```
This is a sanity spot-check, not exhaustive — the real verification is Step 8 below,
after deletion, confirming zero regressions in the actual compiled output.

- [ ] **Step 5: NOW delete the old dark console `:root { ... }` block**

Locate it precisely by its unique old-dark-navy signature rather than by match order:

```bash
grep -n "bg: #0a0e14" app/globals.css
```
This value exists nowhere else in the file (Tasks 4–5 use `#ECEDEF`/`#101215`). It sits
inside the FIRST `:root {` in the file — confirm with
`grep -n '^:root {' app/globals.css` (this old block is always the first match; the
promoted block from Task 3 is the second, further down at whatever line the
`grep -n "Colour: light is the default"` marker from Task 4 pointed to). Delete the
entire old block, from its `:root {` line to its matching closing `}` — confirmed at line
165 by direct reading, not by an automated brace-counter (two earlier tasks in this plan
found automated brace-counting unreliable on this file; read the raw lines to confirm the
true closing `}` before deleting).

- [ ] **Step 6: Delete the old `:root[data-theme="light"] { ... }` block**

Same file, `grep -n ':root\[data-theme="light"\]' app/globals.css` — confirmed at lines
179–214 by direct reading. Delete it entirely — the promoted block now serves this role
at bare `:root`, and Steps 2–3 above already ported everything it uniquely held.

- [ ] **Step 7: Confirm exactly one `:root {` and one `:root[data-theme="dark"] {` block
  remain**

```bash
grep -n '^:root {' app/globals.css
grep -n ':root\[data-theme="dark"\] {' app/globals.css
```
Each command prints exactly one line.

- [ ] **Step 8: Retint the remaining secondary/decorative tokens in both blocks**

The promoted block also carries ~50 secondary tokens not covered by Tasks 4–5: soft pill
fills (`--accent-soft`, `--good-soft`, ...), gradient washes (`--wash-*`), map-chrome
compatibility aliases (`--surface-raised`, `--accent-dim`, `--neutral`), the "artifact"
duplicate naming set (`--card`, `--ink`, `--sunk`, `--muted`, `--faint`, `--line`,
`--sage`/`--amber`/`--plum`/`--sky` and their `-soft` pairs), and the `--gcard-*`/
`--island-*`/`--serie-b`/`--ev-*-ink` gradient-stat-card tokens. None of these are checked
by `scripts/check-contrast.mjs`, so there is no single correct numeric answer for each —
apply this rule and confirm by eye, not by transcribing a table:

> Every remaining warm hex (anything whose hue sits in the brown/terracotta family —
> roughly hex values where R > G > B with R−B > 40) desaturates and rotates toward the
> new cool family: shift its hue toward the blue-grey of `--border`/`--text-muted`
> (roughly 220°) while keeping its original lightness and the *role* it plays (a "soft"
> fill stays pale, an "ink" stays dark). `--sage`/`--amber`/`--plum`/`--sky` and their
> `-soft` pairs are the four gradient-stat hues (spec §8's `GradientStat`) — keep them
> visually distinct from each other and from `--accent`, since that distinctness is their
> whole job; only their warmth needs to leave, not their hue *variety*.

Apply the rule to every remaining warm literal in both the light and dark blocks. This is
a visual-judgement pass — after applying it:

- [ ] **Step 9: Smoke-test visually — with the known caveat from Task 4**

**`/sales` and `/settings` will still show cream, not grey, and this task does not fix
that** — see Task 4 Step 3's cascade analysis. This task removes the app-WIDE old console
(fixing every route except `/sales`/`/settings` themselves), but the kargah-scoped
generator override that specifically affects those two pages is untouched until Task 11.

```bash
npm run dev &
sleep 3
```
Open a NON-kargah route — `/today`, `/leads`, or `/report` — and confirm it now shows the
new cool grey ground (this is the meaningful check for THIS task). Open `/sales` and
confirm it is UNCHANGED from before this task (still cream) — that is the expected,
correct state until Task 11. The gradient-stat cards (dashboard) should still be visually
distinct from each other. Stop the dev server.

- [ ] **Step 10: Run the full build**

```bash
npm run build 2>&1 | tail -30
```
Expected: succeeds, no CSS parse errors.

- [ ] **Step 11: Commit**

```bash
git add app/globals.css
git commit -m "style: delete dead old-console token blocks; retint secondary/decorative tokens"
```

---

### Task 7: Skeuomorphic elevation — inset highlights, layered shadows

**Files:**
- Modify: `app/globals.css`

**Files:**

- [ ] **Step 1: Retint the elevation tokens and add the inset-highlight pair**

In the light (`:root`) block, replace the existing (still warm-brown) `--sh-1`/`--sh-2`/
`--sh-3`/`--sh-lift`/`--card-drop` with:

```css
/* ---- Elevation. Cool-tinted, layered: a tight contact shadow plus a wide soft one. */
--sh-1: 0 1px 2px rgba(24,28,38,.05), 0 4px 14px -6px rgba(24,28,38,.10);
--sh-2: 0 2px 5px rgba(24,28,38,.06), 0 14px 34px -12px rgba(24,28,38,.16);
--sh-3: 0 4px 10px rgba(24,28,38,.07), 0 28px 60px -18px rgba(24,28,38,.26);
--sh-lift: 0 10px 22px -8px rgba(24,28,38,.22), 0 30px 60px -24px rgba(24,28,38,.28);

/* The milled edge: a bright inner top highlight, so a white card on grey reads as
   physically cut rather than a flat rectangle. */
--edge-hi: inset 0 1px 0 rgba(255,255,255,.92);
--edge-lo: inset 0 -1px 0 rgba(24,28,38,.05);

/* drop-shadow form -- a clip-path'd (notched) element loses box-shadow entirely.
   Two stacked drop-shadows is the affordable ceiling; see spec §7 perf budget. */
--card-drop: drop-shadow(0 1px 2px rgba(24,28,38,.07)) drop-shadow(0 12px 26px rgba(24,28,38,.13));
```

In the dark (`:root[data-theme="dark"]`) block:

```css
--sh-1: 0 1px 2px rgba(0,0,0,.30), 0 4px 14px -6px rgba(0,0,0,.45);
--sh-2: 0 2px 5px rgba(0,0,0,.35), 0 14px 34px -12px rgba(0,0,0,.55);
--sh-3: 0 4px 10px rgba(0,0,0,.40), 0 28px 60px -18px rgba(0,0,0,.65);
--sh-lift: 0 10px 22px -8px rgba(0,0,0,.50), 0 30px 60px -24px rgba(0,0,0,.60);

/* A bright inner edge on a DARK surface reads as a rendering fault, not as light --
   drop the highlight to near-invisible and lean on the drop shadow instead. */
--edge-hi: inset 0 1px 0 rgba(255,255,255,.06);
--edge-lo: inset 0 -1px 0 rgba(0,0,0,.30);

--card-drop: drop-shadow(0 1px 2px rgba(0,0,0,.4)) drop-shadow(0 14px 30px rgba(0,0,0,.55));
```

- [ ] **Step 2: Bump the top of the radii scale**

In both blocks, change `--radius-2xl: 26px;` to `--radius-2xl: 28px;` (matches spec §4.4
— the video's cards read slightly rounder than the current scale's ceiling). Leave
`--radius-sm/-md/-lg/-xl`/`--radius-pill` unchanged; they already match.

- [ ] **Step 3: Do NOT retrofit `--edge-hi` onto an existing card rule — confirmed during
  execution**

The two candidates for "the base card rule every plain card inherits from" both turned
out wrong to touch. `.pocket__card` ([globals.css:167](../../app/globals.css#L167)) is
the sacred pocket pattern — Task 19 later verifies it has exactly 3 palette-dependent
declarations (background, border, radial wash), and adding a new `box-shadow` layer here
would be a fourth, undermining that verification and risking the pattern the user
explicitly protected. `.cradlecard` ([globals.css:2036](../../app/globals.css#L2036)) is
being superseded outright by Task 13's `NotchedCard`, which already declares its own
`.notch-edge` using `--edge-hi`/`--edge-lo` — retrofitting the doomed class would be
wasted, conflicting work.

The tokens from Steps 1–2 are the deliverable of this task; their consumption is correctly
Task 13's (`NotchedCard`) and Task 16's (`IconButton`, already written using
`shadow-[var(--edge-hi),var(--sh-1)]`) job, not this one's. No CSS rule is modified in
this step.

- [ ] **Step 4: Confirm build and visual smoke test**

```bash
npm run build 2>&1 | tail -20
npm run dev &
sleep 3
```
Open `/sales`, confirm cards show a subtle bright top edge. Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css
git commit -m "style: cool-tint elevation shadows; add inset-highlight edge tokens; radius-2xl to 28px"
```

---

### Task 8: Update the contrast checker and its test for the new palette

**Found running the checker for real:** two of Task 4/6's proposed hex values did not
clear their required thresholds. `--text-faint: #8A909B` (Task 4) was 2.74:1 against
`--bg`, below the 3.0 floor — corrected to `#7E8490` (3.21:1 vs `--bg`, 3.76:1 vs
`--surface`, still well under 4.5 so it stays distinguishable from `--text-muted`).
`--wash-ink-muted: #5E6470` (Task 6's light secondary-token pass) was 4.30–4.40:1 against
two of the four gradient washes, below 4.5 — corrected to `#565C68` (4.86–5.30:1 across
all four washes). Both already applied directly to `app/globals.css`; this task's own
work (the checker/test updates below) is what caught them. If executing this plan fresh,
apply the corrected values in Tasks 4 and 6 directly rather than the plan's original text.

**Files:**
- Modify: `scripts/check-contrast.mjs`
- Modify: `tests/contrast.test.ts`

**Interfaces:**
- Consumes: `lib/design/contrast.ts`'s `parseHex`/`relativeLuminance`/`contrastRatio`
  (unchanged from Task 1's baseline).

- [ ] **Step 1: Update the checker's selectors**

In `scripts/check-contrast.mjs`, the selector pairs loop currently reads:

```javascript
for (const [theme, selector] of [
  ["light", ".kargah"],
  ["dark", ':root[data-skin="dark"] .kargah'],
]) {
```

Change to:

```javascript
for (const [theme, selector] of [
  ["light", ":root"],
  ["dark", ':root[data-theme="dark"]'],
]) {
```

- [ ] **Step 2: Update the hardcoded baseline hex table**

Find (around the script's line 163-164, confirm with
`grep -n 'text-faint.*#' scripts/check-contrast.mjs`):

```javascript
light: { "--text": ["#231C16", 7], "--text-muted": ["#776C60", 4.5], "--text-faint": ["#91887C", 3] },
dark: { "--text": ["#F3EEE7", 7], "--text-muted": ["#9B8F81", 4.5], "--text-faint": ["#8A8278", 3] },
```

Replace with the values from Tasks 4–5:

```javascript
light: { "--text": ["#16181D", 7], "--text-muted": ["#5F6672", 4.5], "--text-faint": ["#8A909B", 3] },
dark: { "--text": ["#E8EAEE", 7], "--text-muted": ["#9BA3AF", 4.5], "--text-faint": ["#6B7280", 3] },
```

**Do this step only after Task 11 has run** (its generator change is a prerequisite —
the check below asserts kargah no longer has per-accent surface blocks, which is only
true once Task 11 lands):

- [ ] **Step 2.5: Remove the now-dead kargah-surface accent check**

The script's accent-theme loop (below the `THEME_IDS` array, roughly lines 130–245 at
plan-write time — confirm with `grep -n 'SURFACE_CREAM\|SURFACE_INK\|THEME_GROUND'
scripts/check-contrast.mjs`) checks a `:root[data-accent="X"] .kargah` surface-tint block
against hardcoded `SURFACE_CREAM`/`SURFACE_INK` cream-palette baselines. Task 11 makes the
generator stop emitting that block entirely, so this whole surface-tint sub-check
(the `try { surf = block(...) } catch { ... }` section and its nested loop over
`SURFACE_CREAM[skin]`/`SURFACE_INK[skin]`) now always fails — not because a colour
regressed, but because the CSS it looks for no longer exists by design. Delete that
sub-section (the `let surf; try { ... } catch { ... } for (const [g, cream] of
Object.entries(...))` block) along with the now-unused `SURFACE_CREAM` and `SURFACE_INK`
constant declarations above the loop.

Keep everything else in the accent-theme loop — the `need(...)` calls checking
`--accent-ink` on `--accent`, `--accent-text` on `--bg`/`--surface`/`--accent-soft`,
`--ev-a-ink` on `--surface`, the wash-peach checks, the cluster/badge composed checks,
and the `--map-*` checks — all of these still read the bare-root form of the shared rule,
which Task 11 preserves.

- [ ] **Step 3: Run it**

```bash
npm run check:contrast
```
Expected: every line prints `✓`. If any prints `✗`, the reported ratio and required
minimum tell you which token to darken/lighten — go back to Task 4 or 5 and adjust that
one token's hex until it clears the threshold, then re-run this step.

- [ ] **Step 4: Update the hardcoded pinned-figures test**

In `tests/contrast.test.ts`, find:

```typescript
it("agrees with the figures MASTER.md publishes", () => {
  expect(contrastRatio("#231C16", "#F4F0E9")).toBeCloseTo(14.8, 1);
  expect(contrastRatio("#241009", "#E8734A")).toBeCloseTo(6.06, 1);
  // the two failures that shaped the palette
  expect(contrastRatio("#C0532B", "#F4F0E9")).toBeLessThan(4.5);
  expect(contrastRatio("#FFFFFF", "#E8734A")).toBeLessThan(4.5);
```

Replace the body with a check against the new palette's actual figures. First compute the
real ratio so the test asserts a true value rather than a guess:

```bash
node -e '
function ch(v){const s=v/255;return s<=0.03928?s/12.92:Math.pow((s+0.055)/1.055,2.4);}
function lum(hex){const h=hex.replace("#","");const p=i=>parseInt(h.slice(i,i+2),16);return 0.2126*ch(p(0))+0.7152*ch(p(2))+0.0722*ch(p(4));}
function ratio(a,b){const x=lum(a),y=lum(b);const[hi,lo]=x>y?[x,y]:[y,x];return(hi+0.05)/(lo+0.05);}
console.log("text/bg", ratio("#16181D","#ECEDEF").toFixed(2));
console.log("text/surface", ratio("#16181D","#FFFFFF").toFixed(2));
'
```

Use the printed values in the test:

```typescript
it("agrees with the substrate spec's published figures", () => {
  expect(contrastRatio("#16181D", "#ECEDEF")).toBeCloseTo(<value from text/bg>, 1);
  expect(contrastRatio("#16181D", "#FFFFFF")).toBeCloseTo(<value from text/surface>, 1);
});
```
(Replace `<value from ...>` with the actual printed numbers before committing — this is
the one spot in this plan where a number is generated at execution time rather than
supplied up front, because it depends on Task 4's exact final hex choices.)

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```
Expected: all pass, including the updated `contrast.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-contrast.mjs tests/contrast.test.ts
git commit -m "test: update contrast checker and pinned figures for the cool+black palette"
```

---

### Task 9: Rewrite `lib/theme.ts` — auto/light/dark, key rename

**Files:**
- Modify: `lib/theme.ts`
- Test: `tests/theme.test.ts` (new)

**Interfaces:**
- Produces: `type Theme = "auto" | "light" | "dark"`, `THEME_KEY = "routeflow-theme"`,
  `THEME_INIT_SCRIPT` (string, unchanged role), `resolveTheme(stored: Theme \| null,
  prefersLight: boolean, isDriverRoute: boolean): "light" \| "dark"` — the pure function
  Task 10 and the header toggle (a future task) both call.

- [ ] **Step 1: Write the failing test for the pure resolution function**

```typescript
// tests/theme.test.ts
import { describe, it, expect } from "vitest";
import { resolveTheme } from "@/lib/theme";

describe("resolveTheme", () => {
  it("auto follows the OS preference", () => {
    expect(resolveTheme("auto", true, false)).toBe("light");
    expect(resolveTheme("auto", false, false)).toBe("dark");
  });

  it("an explicit choice overrides the OS preference", () => {
    expect(resolveTheme("light", false, false)).toBe("light");
    expect(resolveTheme("dark", true, false)).toBe("dark");
  });

  it("no stored value defaults to auto behaviour", () => {
    expect(resolveTheme(null, true, false)).toBe("light");
    expect(resolveTheme(null, false, false)).toBe("dark");
  });

  it("driver routes ignore auto and pin to the explicit choice, defaulting dark", () => {
    expect(resolveTheme("auto", true, true)).toBe("dark");
    expect(resolveTheme(null, true, true)).toBe("dark");
    expect(resolveTheme("light", true, true)).toBe("light");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx vitest run tests/theme.test.ts
```
Expected: FAIL — `resolveTheme` is not exported yet.

- [ ] **Step 3: Read the current file in full before rewriting**

```bash
cat lib/theme.ts
```
(So the rewrite preserves everything not covered by this task — e.g. the
`THEME_CHANGE_EVENT` cross-tab-sync mechanism referenced in its comments.)

- [ ] **Step 4: Rewrite**

```typescript
// lib/theme.ts
/** Theme selection, persisted per browser.
 *
 *  Three stored states, not two. "auto" follows the OS live via matchMedia; "light" and
 *  "dark" pin explicitly. Light is the resolved default when nothing is stored and the
 *  OS has no preference either, per the substrate spec -- this app's identity inverted
 *  from dark-default to light-default in the 2026-09-08 redesign.
 *
 *  /driver is the one exception: a moving vehicle must not have its screen change theme
 *  because the OS flipped under the driver's thumb, so it ignores "auto" and pins to
 *  whatever was explicitly chosen, defaulting to dark if nothing was.
 */
export type Theme = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "routeflow-theme";
export const THEME_CHANGE_EVENT = "routeflow-theme-change";

export function isTheme(v: unknown): v is Theme {
  return v === "auto" || v === "light" || v === "dark";
}

/** Pure resolution: given what is stored, what the OS currently prefers, and whether
 *  this route is /driver, decides the actual light/dark to render. No I/O -- the caller
 *  (the init script, and any live matchMedia listener) supplies the inputs. */
export function resolveTheme(
  stored: Theme | null,
  prefersLight: boolean,
  isDriverRoute: boolean,
): ResolvedTheme {
  const effective: Theme = stored ?? "auto";
  if (isDriverRoute && effective === "auto") return "dark";
  if (effective === "light") return "light";
  if (effective === "dark") return "dark";
  return prefersLight ? "light" : "dark";
}

/** Runs before first paint, from a blocking inline script in the root layout. The
 *  attribute has to land on <html> before the browser paints or a load starting in dark
 *  flashes light first (or vice-versa). Re-reads matchMedia on every load rather than
 *  freezing a first-run guess, because "auto" is meant to track the OS live -- the one
 *  carve-out is /driver, detected here via pathname, which never auto-follows. */
export const THEME_INIT_SCRIPT = `(function(){try{
var k=${JSON.stringify(THEME_KEY)},s=localStorage.getItem(k);
if(s!=="auto"&&s!=="light"&&s!=="dark")s="auto";
var isDriver=location.pathname.indexOf("/driver")===0;
var prefersLight=matchMedia("(prefers-color-scheme: light)").matches;
var resolved=(isDriver&&s==="auto")?"dark":(s==="light"?"light":(s==="dark"?"dark":(prefersLight?"light":"dark")));
document.documentElement.setAttribute("data-theme",resolved);
var m=document.querySelector('meta[name="theme-color"]');
if(m)m.setAttribute("content",resolved==="light"?"#ECEDEF":"#101215");
}catch(e){}})();`;

/** Writes the choice and tells every mounted consumer in this tab. localStorage fires no
 *  storage event in the tab that wrote it, so without the custom event a toggle in the
 *  header would not reach a second copy of the control in settings. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // private-window localStorage throw -- a theme preference is never worth a blank page
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
}

export function readTheme(): Theme {
  try {
    const s = localStorage.getItem(THEME_KEY);
    return isTheme(s) ? s : "auto";
  } catch {
    return "auto";
  }
}
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
npx vitest run tests/theme.test.ts
```
Expected: PASS, 6/6.

- [ ] **Step 6: Find every consumer of the old `Theme`/`DEFAULT_THEME`/`SKIN_KEY` exports
  and update them**

```bash
grep -rln 'from "@/lib/theme"\|DEFAULT_THEME\|SKIN_KEY' --include="*.tsx" --include="*.ts" . | grep -v node_modules
```
For each file found (expect `components/ThemeToggle.tsx`, `components/kargah/SkinToggle.tsx`
at minimum), update its imports to the new exports (`resolveTheme`/`setTheme`/
`readTheme`/`Theme`) and its logic to the three-state model. Read each file's current
`useTheme()` hook implementation first — this task does not prescribe the hook's exact
shape since it depends on what each file already does; the constraint is that both
toggles end up driving the same `THEME_KEY`/`THEME_CHANGE_EVENT` this file now exports.

- [ ] **Step 7: Confirm build**

```bash
npm run build 2>&1 | tail -30
```

- [ ] **Step 8: Commit**

```bash
git add lib/theme.ts tests/theme.test.ts components/
git commit -m "feat: rewrite lib/theme.ts for auto/light/dark, rename THEME_KEY, live matchMedia"
```

---

### Task 10: Update `app/layout.tsx` viewport and `app/manifest.ts`

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/manifest.ts`

**Files:**

- [ ] **Step 1: Update the viewport export in `app/layout.tsx`**

Find:

```typescript
export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: "#0a0e14",
};
```

Replace with:

```typescript
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: "#ECEDEF",
};
```

The order flips too — `"light dark"` states light as the preferred/default scheme, matching
the identity inversion; `THEME_INIT_SCRIPT` (Task 9) still rewrites the live
`theme-color` meta tag to match the resolved theme after first paint.

- [ ] **Step 2: Confirm `ACCENT_INIT_SCRIPT` is untouched**

```bash
grep -n "ACCENT_INIT_SCRIPT" app/layout.tsx
```
It must still be present and still rendered — the map's `useAccent()` depends on the
`data-accent` attribute it sets. This plan does not remove it (see Global Constraints).

- [ ] **Step 3: Update the stale `<title>` and description while here**

```typescript
export const metadata: Metadata = {
  title: "RouteFlow — پخش و فروش",
  description: "سامانه فروش، پخش و مدیریت مسیر",
};
```
(Matches `app/manifest.ts`'s existing `name`/`description`, which are already correct —
only the root layout's `<title>` was stale.)

- [ ] **Step 4: Update `app/manifest.ts` colours**

```typescript
background_color: "#ECEDEF",
theme_color: "#ECEDEF",
```

- [ ] **Step 5: Confirm build and no flash-of-wrong-theme on load**

```bash
npm run build && npm start &
sleep 3
```
Open the app in a browser with the OS set to light mode; reload several times, confirming
no dark flash. Then switch the OS to dark mode and repeat. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx app/manifest.ts
git commit -m "chore: viewport/manifest colours to the light-default palette; fix stale title"
```

---

### Task 11: Remove the accent-picker widget; sever kargah from accent theming

**Amended during execution.** The original version of this task assumed
`scripts/gen-accent-themes.mjs` only affected the map. Reading the actual generated CSS
during Task 1's baseline pass found otherwise: each accent theme emits a rule
`:root[data-accent="X"] .kargah, :root[data-accent="X"] { --accent: ...; }` — a selector
that matches BOTH the kargah scope and bare `:root`, joined as one rule. Since
`ACCENT_INIT_SCRIPT` always sets `data-accent` to some value (there is a default, not just
an opt-in), this rule's later position in `app/globals.css`'s source order means it
currently overrides whatever `--accent` Task 4 sets at bare `:root` — kargah's colour
would silently stay accent-theme-dependent even after every other task in this plan lands.
Each theme also emits a SECOND, kargah-only rule that re-tints `--bg`/`--surface`/`--border`
etc. per accent — pure kargah surface variation, unrelated to the map.

The fix stays narrow and consistent with the "retire it" decision: the generator stops
emitting anything kargah-scoped, for every theme and both skins, while the bare-root
map-relevant declarations (`--map-*`, and whatever else the map itself reads) keep being
generated exactly as before.

**Files:**
- Modify: `components/kargah/ProfileMenu.tsx`
- Modify: `scripts/gen-accent-themes.mjs`
- Modify: `app/globals.css` (regenerated output, not hand-edited)
- Modify: `scripts/check-contrast.mjs` (its accent-theme loop, in Task 8 — cross-reference)

- [ ] **Step 1: Read the current render and remove the widget**

```bash
grep -n "AccentPicker" components/kargah/ProfileMenu.tsx
```
Delete the `import AccentPicker from "@/components/AccentPicker";` line and the
`<AccentPicker />` JSX it renders. **Do not** delete `components/AccentPicker.tsx` itself,
`lib/accentThemes.ts`, or `scripts/gen-accent-themes.mjs` — `CoverageMap.tsx` imports
`useAccent` from the same file and is out of scope for this plan.

- [ ] **Step 2: Read the generator's current output shape for one theme, to ground the edit**

```bash
grep -n 'data-accent="terracotta"' app/globals.css | head -6
```
Confirms two emitted forms per theme per skin: the shared rule
(`:root[data-accent="X"] .kargah, :root[data-accent="X"] { ... }`, carrying `--accent`,
`--accent-ink`, `--accent-text`, `--accent-soft`, `--accent-2`, `--accent-dim`,
`--wash-peach`, `--ev-a-ink`, the `--map-*` tokens, `--series-single`) and the kargah-only
surface rule (`:root[data-accent="X"] .kargah { --bg, --surface, ... }`).

- [ ] **Step 3: Read the generator script in full**

```bash
cat scripts/gen-accent-themes.mjs
```

- [ ] **Step 4: Edit the generator so it emits ONLY the bare-root, map-relevant form**

Locate the template-string or object literal that builds the shared selector
(search for `.kargah` inside the file — `grep -n '\.kargah' scripts/gen-accent-themes.mjs`).
Change the shared-rule selector from `:root[data-accent="${id}"] .kargah,
:root[data-accent="${id}"]` to just `:root[data-accent="${id}"]` (drop the `.kargah`
half of the comma list). Then find and delete entirely the block that emits the
kargah-only surface-retint rule (`:root[data-accent="${id}"] .kargah { --bg: ...`) for
both skins — kargah no longer varies its surface by accent at all; it is one fixed
cool+black palette from Tasks 4–5.

Kargah-only tokens that were part of the shared rule but have no map consumer
(`--accent-soft`, `--accent-2`, `--accent-dim`, `--wash-peach`, `--ev-a-ink`,
`--series-single`) can stay in the bare-root emission — they land as unused custom
properties outside `.kargah`, which is harmless, and removing them requires tracing each
one's actual map usage individually for no real benefit. Only the two structural changes
above (drop `.kargah` from the shared selector; delete the kargah-only surface block)
are required.

- [ ] **Step 5: Regenerate**

```bash
node scripts/gen-accent-themes.mjs
git diff --stat app/globals.css
```
Confirm the diff removes every `:root[data-accent="X"] .kargah {` rule (the surface
block) and every `.kargah` occurrence inside the shared-rule selectors, for all ten
theme ids and both skins.

- [ ] **Step 6: Confirm no `.kargah` accent-scoping remains**

```bash
grep -c 'data-accent.*\.kargah\|\.kargah.*data-accent' app/globals.css
```
Expected: `0`.

- [ ] **Step 7: Confirm the map still builds and still reads the accent**

```bash
grep -n "useAccent" components/CoverageMap.tsx | head -3
npm run build 2>&1 | tail -20
```

**Found regenerating and verifying — a second, deeper collision Step 4's removal alone
does not close.** Dropping `.kargah` from the generator's selectors (Steps 4–5) makes
every per-theme rule bare `:root[data-accent="X"]` — but the map's "no accent chosen yet"
default is ALSO bare `:root` (unconditional, so the map has a colour before any choice
exists), and a user's *explicit* accent choice is `:root[data-accent="X"]`, which is
**more specific than anything kargah can declare at plain `:root`**. Concretely: kargah's
own `:root { --accent: #3D6FD9 }` (Task 4) has specificity (0,1,0); the generator's
default and every per-theme rule are (0,1,0) or (0,2,0) — equal or higher. Picking a map
accent theme would silently repaint kargah's links, badges and chart-single-series too,
which is the exact coupling this task exists to sever, unresolved by Steps 1–5 alone.

- [ ] **Step 8: Add a `.kargah`-scoped guard for the 8 tokens the generator can still
  reach**

Only 8 tokens are at risk — every other kargah token has no competing generator rule.
Confirm the set by reading the generator's token-object construction:

```bash
grep -n '"--accent":\|"--accent-ink":\|"--accent-text":\|"--accent-soft":\|"--accent-2":\|"--accent-dim":\|"--wash-peach":\|"--ev-a-ink":' scripts/gen-accent-themes.mjs | head -20
```

Append, at the TRUE end of `app/globals.css` (after `/* ACCENT-THEMES:END */`), a guard
re-asserting kargah's fixed values for exactly these 8, using `:root .kargah` (light) and
`:root[data-theme="dark"] .kargah` (dark). `.kargah` still exists on
`app/sales/layout.tsx` and `app/settings/layout.tsx`'s wrapper divs — Task 3 promoted the
CSS scope, never removed the class from the markup, which is what this guard relies on.

```css
/* kargah accent guard -- re-asserts the 8 tokens the map's still-active accent-theme
   generator can reach, scoped to .kargah, positioned last. :root .kargah and
   :root[data-theme="dark"] .kargah are EQUAL specificity to the generator's
   :root[data-accent="X"] / :root[data-accent="X"][data-skin="dark"] rules -- position,
   not specificity, is what makes this win; :root .kargah beats bare :root by
   specificity regardless of position for the no-accent-chosen default case. */
:root .kargah {
  --accent: <Task 4's light value>;
  --accent-text: <Task 4's light value>;
  --accent-ink: <Task 4's light value>;
  --accent-soft: <Task 6's light value>;
  --accent-2: <Task 6's light value>;
  --accent-dim: <Task 6's light value>;
  --wash-peach: <Task 6's light value>;
  --ev-a-ink: <Task 6's light value>;
}
:root[data-theme="dark"] .kargah {
  /* same 8 tokens, Task 5/6's dark values */
}
```
(Pull the exact hex values from the running file — `grep -n '^\s*--accent:'
app/globals.css` etc. — rather than retyping them from this plan, since Tasks 4–8 may
have adjusted them since this section was written.)

- [ ] **Step 9: Verify empirically, not by reasoning alone**

Cascade collisions at equal specificity are easy to get backwards on paper. Build a
minimal standalone page against the REAL compiled CSS and read `getComputedStyle` with
Playwright (already a devDependency) rather than trusting a re-derivation of the
specificity rules:

```javascript
// a throwaway script — set data-accent/data-skin/data-theme on document.documentElement
// (NOT a descendant div: :root only ever matches the actual root element), then read
// getComputedStyle(...).getPropertyValue("--accent") on both the root and a
// class="kargah" child, for: no accent chosen, an explicit accent, and that accent's
// dark variant with data-theme="dark" also set (kargah's own scope discriminator).
```
Expected results: the root element's `--accent` follows whichever map accent state you
set; the `.kargah` child's `--accent` stays exactly your light/dark kargah value
(`#3D6FD9` / `#6D96EC` at plan-write time) in EVERY scenario, never drifting toward the
map's chosen hue. If any scenario shows drift, the guard's selector or position is wrong
— fix and re-verify before proceeding, since this is the entire point of Task 11.

- [ ] **Step 10: Confirm `/sales`'s colour no longer shifts with the map's accent choice**

```bash
npm run build
```
The compiled-output/Playwright verification in Step 7 is the real proof here — `npm run
dev` plus eyeballing a browser is a weaker check for a cascade-specificity question and
is not required if Step 7 passed cleanly.

- [ ] **Step 11: Confirm `/sales`'s profile menu renders without the picker**

Read `components/kargah/ProfileMenu.tsx` and confirm the `<AccentPicker />` import and
JSX are gone, and the surrounding menu structure (skin toggle, font picker) is intact.

- [ ] **Step 12: Commit**

```bash
git add components/kargah/ProfileMenu.tsx scripts/gen-accent-themes.mjs app/globals.css
git commit -m "fix: sever kargah from accent theming — generator emits bare-root/map tokens only"
```

---

### Task 12: Generalize notch geometry

**Files:**
- Create: `lib/design/notch.ts`
- Create: `tests/design/notch.test.ts`
- Delete: `lib/design/carve.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `notchedCardPath(w: number, h: number, opts?: NotchOpts): string \| null`,
  `type NotchSide = "start" \| "end"`, `type NotchEdge = "top" \| "bottom"` — consumed by
  Task 13's `NotchedCard`.

- [ ] **Step 1: Read the existing implementation in full**

```bash
cat lib/design/carve.ts
```

- [ ] **Step 2: Write the failing tests**

```typescript
// tests/design/notch.test.ts
import { describe, it, expect } from "vitest";
import { notchedCardPath } from "@/lib/design/notch";

describe("notchedCardPath", () => {
  it("returns null below the minimum width", () => {
    expect(notchedCardPath(300, 200)).toBeNull();
  });

  it("returns a path string at a normal card size", () => {
    const d = notchedCardPath(400, 240);
    expect(d).not.toBeNull();
    expect(d).toMatch(/^M /);
    expect(d).toMatch(/Z$/);
  });

  it("the notch sits on the end side by default under ltr", () => {
    const d = notchedCardPath(400, 240, { dir: "ltr" });
    // end-side (ltr: right) notch means the path's first horizontal run is short of
    // the full width -- i.e. it turns down before reaching w.
    expect(d).toContain("H 400");  // shoulder still reaches the far edge
  });

  it("mirrors to the start side under rtl without the caller doing math", () => {
    const ltr = notchedCardPath(400, 240, { dir: "ltr", side: "end" });
    const rtl = notchedCardPath(400, 240, { dir: "rtl", side: "end" });
    // "end" resolves to a different physical corner in each direction, so the two
    // paths must differ.
    expect(ltr).not.toBe(rtl);
  });

  it("respects a custom notch width and height", () => {
    const d = notchedCardPath(500, 300, { notchWidth: 200, notchHeight: 50 });
    expect(d).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run tests/design/notch.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement, generalizing the existing RTL-hardcoded version**

```typescript
// lib/design/notch.ts
/** The silhouette of a card with a rounded rectangle SUBTRACTED from one corner -- the
 *  notch, RouteFlow's core visual identity (spec §5). Generalizes the previous
 *  lib/design/carve.ts, which hardcoded the notch to /sales's RTL top-inline-start
 *  corner. This version takes side/edge/dir explicitly so any surface, in either writing
 *  direction, can carve the same shape without duplicating the path math.
 *
 *  Written as a path rather than a mask image because the notch keeps a fixed size while
 *  the card is fluid: a mask sized in percentages stretches the corner radii as the card
 *  grows. Consumers pass their own measured box and set the result as
 *  `clip-path: path("...")`.
 */
export type NotchSide = "start" | "end";
export type NotchEdge = "top" | "bottom";

export type NotchOpts = {
  side?: NotchSide;
  edge?: NotchEdge;
  dir?: "rtl" | "ltr";
  notchWidth?: number;
  notchHeight?: number;
  radius?: number;
  innerRadius?: number;
  minWidth?: number;
};

/** "start"/"end" resolve to a physical corner using `dir`, exactly the way CSS logical
 *  properties do -- inline-start is the LEFT edge under ltr and the RIGHT edge under rtl. */
function resolvePhysicalSide(side: NotchSide, dir: "rtl" | "ltr"): "left" | "right" {
  if (dir === "ltr") return side === "start" ? "left" : "right";
  return side === "start" ? "right" : "left";
}

export function notchedCardPath(w: number, h: number, opts: NotchOpts = {}): string | null {
  const {
    side = "start",
    edge = "top",
    dir = "rtl",
    notchHeight: nh = 62,
    radius: R = 28,
    innerRadius: r = 20,
    minWidth = 360,
  } = opts;

  if (!(w > 0) || !(h > 0) || w < minWidth) return null;

  const nw = Math.max(190, Math.min(opts.notchWidth ?? 272, w - 120));
  const physicalSide = resolvePhysicalSide(side, dir);
  const flipX = physicalSide === "right";
  const flipY = edge === "bottom";

  // Build the path in a canonical "top-left notch" space, then mirror the x/y
  // coordinates afterward for the other three side/edge combinations -- this keeps the
  // path-construction logic itself written exactly once.
  const px = (x: number) => (flipX ? w - x : x);
  const py = (y: number) => (flipY ? h - y : y);
  const p = (x: number, y: number) => `${px(x).toFixed(2)},${py(y).toFixed(2)}`;

  // Sweep flags invert under either mirror axis (an odd number of flips reverses
  // path winding), so xor the two flags to pick the correct arc direction.
  const sweepOut = flipX !== flipY ? 0 : 1;
  const sweepIn = flipX !== flipY ? 1 : 0;

  return [
    `M ${p(R, 0)}`,
    `L ${p(w - nw - r, 0)}`,
    `A ${r} ${r} 0 0 ${sweepOut} ${p(w - nw, r)}`,
    `L ${p(w - nw, nh - r)}`,
    `A ${r} ${r} 0 0 ${sweepIn} ${p(w - nw + r, nh)}`,
    `L ${p(w - R, nh)}`,
    `A ${R} ${R} 0 0 ${sweepOut} ${p(w, nh + R)}`,
    `L ${p(w, h - R)}`,
    `A ${R} ${R} 0 0 ${sweepOut} ${p(w - R, h)}`,
    `L ${p(R, h)}`,
    `A ${R} ${R} 0 0 ${sweepOut} ${p(0, h - R)}`,
    `L ${p(0, R)}`,
    `A ${R} ${R} 0 0 ${sweepOut} ${p(R, 0)}`,
    "Z",
  ].join(" ");
}
```

- [ ] **Step 5: Run to confirm pass**

```bash
npx vitest run tests/design/notch.test.ts
```
Expected: PASS, 5/5. If the mirroring test fails because the two paths are accidentally
identical, double check `resolvePhysicalSide`'s truth table against the four
`side`×`dir` combinations by hand before adjusting the sweep-flag logic.

- [ ] **Step 6: Do NOT delete `lib/design/carve.ts` yet — confirmed during execution**

`components/kargah/CarvedCard.tsx` still imports it and is not replaced until Task 13;
deleting it here breaks `npm run build` immediately (a missing-module error, not a subtle
one). Confirm the remaining consumers instead:

```bash
grep -rln "lib/design/carve\|carvedCardPath" --include="*.tsx" --include="*.ts" . | grep -v node_modules
```
Two hits are expected: `components/kargah/CarvedCard.tsx` (Task 13 replaces it) and
`tests/carve.test.ts` — an existing test this plan's earlier drafting missed, covering the
same path-generation math `notch.test.ts` now covers more generally. Delete just the test
file now, since nothing depends on it and its coverage is superseded:

```bash
rm tests/carve.test.ts
```
`lib/design/carve.ts` itself is deleted in Task 13, in the same commit that removes its
last real consumer.

- [ ] **Step 7: Commit**

```bash
git add lib/design/notch.ts tests/design/notch.test.ts
git rm tests/carve.test.ts
git commit -m "feat: generalize notch geometry to any side/edge/direction (lib/design/notch.ts)"
```

---

### Task 13: `NotchedCard` — the border/highlight problem, solved

**Files:**
- Create: `components/kargah/NotchedCard.tsx`
- Delete: `components/kargah/CarvedCard.tsx`
- Modify: `app/sales/page.tsx`

**Interfaces:**
- Consumes: `notchedCardPath` from Task 12.
- Produces: `<NotchedCard side? edge? notchWidth? notchHeight? shoulder? avatars? children>`
  — the component every later notched surface (page headers, icon-bearing cards) is built
  from.

**No component-rendering test** (see Global Constraints — this repo has no
`@testing-library/react` and no jsdom environment). The geometry this component wraps is
already covered by `tests/design/notch.test.ts` (Task 12); this component's own
correctness — that avatars render as a sibling of the clipped element, not a descendant —
is verified by direct DOM inspection in Step 5's browser smoke test instead of an
automated render test.

- [ ] **Step 1: Read the existing `CarvedCard.tsx` in full**

```bash
cat components/kargah/CarvedCard.tsx
```

- [ ] **Step 2: Implement**

```typescript
// components/kargah/NotchedCard.tsx
"use client";

import { useCallback, useEffect, useRef } from "react";
import { notchedCardPath, type NotchEdge, type NotchSide } from "@/lib/design/notch";
import { cn } from "@/lib/cn";

/** A card with a rounded rectangle subtracted from one corner, with content (an icon,
 *  an avatar cluster, sub-navigation) seated in the bay that removal opens -- spec §5,
 *  the app's core visual identity. Generalizes the previous CarvedCard: side, edge and
 *  notch size are all props instead of one hardcoded shape.
 *
 *  THE BORDER PROBLEM: clip-path removes box-shadow AND border from a clipped element.
 *  This card solves both with a stacked ::before technique -- an absolutely-positioned
 *  sibling layer carrying the SAME clip-path, coloured as the border, inset by 1px on a
 *  second nested clip so only a 1px ring shows. See the `data-notch-clip` element and its
 *  adjacent `.notch-edge` sibling below.
 *
 *  THE SHADOW PROBLEM: solved the same way CarvedCard solved it -- `filter: var(--card-drop)`
 *  (stacked drop-shadow, which DOES follow a clipped outline) on the OUTER wrapper, never
 *  box-shadow on the clipped element itself.
 *
 *  Avatars/shoulder content are SIBLINGS of the clipped element, never descendants --
 *  clip-path clips descendants too, so content placed inside would be erased by the very
 *  notch meant to hold it.
 */
export default function NotchedCard({
  side = "start",
  edge = "top",
  notchWidth,
  notchHeight,
  shoulder,
  avatars,
  className,
  children,
}: {
  side?: NotchSide;
  edge?: NotchEdge;
  notchWidth?: number;
  notchHeight?: number;
  shoulder?: React.ReactNode;
  avatars: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const card = useRef<HTMLDivElement | null>(null);
  const wrapper = useRef<HTMLDivElement | null>(null);

  const carve = useCallback(() => {
    const el = card.current;
    const wrap = wrapper.current;
    if (!el || !wrap) return;
    const dir = getComputedStyle(wrap).direction === "ltr" ? "ltr" : "rtl";
    const d = notchedCardPath(el.offsetWidth, el.offsetHeight, {
      side,
      edge,
      dir,
      notchWidth,
      notchHeight,
    });
    const clip = d ? `path("${d}")` : "";
    el.style.clipPath = clip;
    el.classList.toggle("notched", Boolean(d));
    wrap.style.setProperty("--notch-clip-path", clip);
  }, [side, edge, notchWidth, notchHeight]);

  useEffect(() => {
    carve();
    const ro = new ResizeObserver(carve);
    const el = card.current;
    if (el) ro.observe(el);
    // The card's height depends on the Persian glyphs inside it, so the box measured
    // before the webfont lands is not the box it ends up with.
    document.fonts?.ready.then(carve).catch(() => {});
    return () => ro.disconnect();
  }, [carve]);

  return (
    <div ref={wrapper} className={cn("notch-wrap", className)}>
      {/* The border/highlight ring: same clip-path as the card, inset 1px via a second
          nested clip, coloured as border + edge-highlight. Purely decorative, so it is
          aria-hidden. */}
      <div className="notch-edge" aria-hidden />
      <div ref={card} data-notch-clip className="notch-card">
        {children}
      </div>
      {shoulder}
      <div className="notch-avatars">{avatars}</div>
    </div>
  );
}
```

Add the matching CSS to `app/globals.css` (append near the other kargah component rules):

```css
.notch-wrap {
  position: relative;
  filter: var(--card-drop);
}

.notch-card {
  position: relative;
  z-index: 2;
  background: var(--surface);
  border-radius: var(--radius-2xl);
}
.notch-card.notched {
  border-radius: 0; /* the clip-path is the only thing describing the shape once carved */
}

/* The border/highlight ring: an absolutely-positioned layer painted with the border
   colour, clipped to the SAME notch path (written to --notch-clip-path by the component),
   then inset 1px via a second clip so only a thin ring is visible -- the notched
   equivalent of a 1px border, since a real `border` property is clipped away with
   everything else outside a clip-path'd shape. */
.notch-edge {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(var(--edge-hi), var(--edge-lo)), var(--border-strong);
  clip-path: var(--notch-clip-path, none);
}
.notch-edge::after {
  content: "";
  position: absolute;
  inset: 1px;
  background: var(--surface);
  clip-path: var(--notch-clip-path, none);
}

.notch-avatars {
  position: absolute;
  z-index: 3;
  /* Positioned in the bay -- exact inset tuned per consumer via a modifier class,
     since notch position (side/edge) varies by usage. */
  inset-inline-end: var(--space-4);
  top: var(--space-3);
}
```

- [ ] **Step 3: Update `app/sales/page.tsx`'s call site**

```bash
grep -n "CarvedCard" app/sales/page.tsx
```
Replace the import and JSX usage: `CarvedCard` → `NotchedCard`, keeping the same props
(`shoulder`, `avatars`, `children`) — the prop signature is unchanged from `CarvedCard`,
only the new `side`/`edge`/`notchWidth`/`notchHeight` are additive.

- [ ] **Step 4: Delete both superseded files**

`lib/design/carve.ts` deferred deletion from Task 12 lands here too — this is the commit
that removes its last real consumer, so it is the correct place to delete both together:

```bash
git rm components/kargah/CarvedCard.tsx lib/design/carve.ts
```

- [ ] **Step 5: Confirm build and visual smoke test — including the sibling-not-descendant check**

```bash
npm run build 2>&1 | tail -30
npm run dev &
sleep 3
```
Open `/sales`, find the page that used `CarvedCard`, confirm: the notch still renders with
a visible border/highlight ring following its outline, and the avatars are visible (not
clipped away — open devtools, confirm the `.notch-avatars` element is a SIBLING of the
`[data-notch-clip]` element in the DOM tree, not nested inside it). Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add components/kargah/NotchedCard.tsx app/globals.css app/sales/page.tsx
git commit -m "feat: NotchedCard generalizes CarvedCard; solves the clip-path border problem"
```

---

### Task 14: Delegated tilt + glow architecture

**Files:**
- Create: `lib/design/tilt.ts`
- Create: `tests/design/tilt.test.ts`
- Create: `components/kargah/TiltCard.tsx`
- Create: `components/kargah/GlowSurface.tsx`

**Interfaces:**
- Produces: `useTiltGlow(containerRef: RefObject<HTMLElement>): void` — attaches the
  single delegated listener; `<TiltCard>`, `<GlowSurface>` — consumed by every later
  interactive card.

- [ ] **Step 1: Write the failing test for the pure math**

```typescript
// tests/design/tilt.test.ts
import { describe, it, expect } from "vitest";
import { normalizedPointerPosition, tiltDirection } from "@/lib/design/tilt";

describe("normalizedPointerPosition", () => {
  it("returns 0.5,0.5 at the exact center of the box", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
    expect(normalizedPointerPosition(50, 50, rect)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps outside the box to 0..1", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
    expect(normalizedPointerPosition(-10, 200, rect)).toEqual({ x: 0, y: 1 });
  });
});

describe("tiltDirection", () => {
  it("is 1 under ltr and -1 under rtl -- rotateY sign flips with writing direction", () => {
    expect(tiltDirection("ltr")).toBe(1);
    expect(tiltDirection("rtl")).toBe(-1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run tests/design/tilt.test.ts
```

- [ ] **Step 3: Implement the pure math and the delegated hook**

```typescript
// lib/design/tilt.ts
"use client";

import { useEffect } from "react";

/** Pointer position within a box, normalized to 0..1 on each axis and clamped -- used by
 *  both the tilt (rotateX/Y) and the glow (radial-gradient position) math. */
export function normalizedPointerPosition(
  clientX: number,
  clientY: number,
  rect: DOMRect | { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const x = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const y = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/** rotateY's sign must flip under RTL or a card tilts away from the cursor instead of
 *  toward it -- spec §6.2. Written to the --tilt-dir custom property once per direction
 *  change, not recomputed per pointer move. */
export function tiltDirection(dir: "ltr" | "rtl"): 1 | -1 {
  return dir === "ltr" ? 1 : -1;
}

/** ONE delegated pointermove listener per container, updating CSS custom properties on
 *  whichever single descendant is currently under the pointer -- never per-card React
 *  state, never one listener per card. At 40 cards on screen this is still exactly one
 *  listener and, per frame, exactly one element's style getting two properties written --
 *  see spec §6.2 and §7's perf budget.
 *
 *  Touch/coarse pointers get nothing: there is no hover on a phone, and tilt/glow are
 *  desktop-only per spec §6.2. prefers-reduced-motion disables it entirely.
 */
export function useTiltGlow(containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || reduced.matches) return;

    let active: HTMLElement | null = null;
    let rafId: number | null = null;
    let pendingEvent: PointerEvent | null = null;

    const release = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.removeProperty("--mx");
      el.style.removeProperty("--my");
      el.style.willChange = "";
    };

    const applyFrame = () => {
      rafId = null;
      const e = pendingEvent;
      if (!e || !active) return;
      const rect = active.getBoundingClientRect();
      const { x, y } = normalizedPointerPosition(e.clientX, e.clientY, rect);
      active.style.setProperty("--mx", String(x));
      active.style.setProperty("--my", String(y));
    };

    const onMove = (e: PointerEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-tilt]");
      if (target !== active) {
        release(active);
        active = target;
        if (active) active.style.willChange = "transform";
      }
      if (!active) return;
      pendingEvent = e;
      if (rafId == null) rafId = requestAnimationFrame(applyFrame);
    };

    const onLeave = () => {
      release(active);
      active = null;
    };

    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    return () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      if (rafId != null) cancelAnimationFrame(rafId);
      release(active);
    };
  }, [containerRef]);
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
npx vitest run tests/design/tilt.test.ts
```
Expected: PASS, 3/3.

- [ ] **Step 5: Add the CSS the hook's custom properties drive**

Append to `app/globals.css`:

```css
:root { --tilt-dir: -1; }      /* rtl default */
[dir="ltr"] { --tilt-dir: 1; }

[data-tilt] {
  --mx: 0.5;
  --my: 0.5;
  --tilt-max: 8deg;
  transform: perspective(900px)
    rotateX(calc((0.5 - var(--my)) * var(--tilt-max)))
    rotateY(calc((var(--mx) - 0.5) * var(--tilt-max) * var(--tilt-dir)));
  transition: transform var(--dur-base, 180ms) var(--ease-out, ease-out);
}

[data-glow] {
  position: relative;
  isolation: isolate;
}
[data-glow]::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  border-radius: inherit;
  background: radial-gradient(
    220px circle at calc(var(--mx, 0.5) * 100%) calc(var(--my, 0.5) * 100%),
    color-mix(in srgb, var(--accent) 22%, transparent),
    transparent 70%
  );
  mix-blend-mode: plus-lighter;
  opacity: 0;
  transition: opacity var(--dur-base, 180ms) var(--ease-out, ease-out);
}
[data-tilt]:hover[data-glow]::after,
[data-glow]:hover::after {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  [data-tilt] { transform: none !important; }
  [data-glow]::after { display: none !important; }
}
```

- [ ] **Step 6: Implement `TiltCard` and `GlowSurface`**

```typescript
// components/kargah/TiltCard.tsx
"use client";

import { useRef } from "react";
import { useTiltGlow } from "@/lib/design/tilt";
import { cn } from "@/lib/cn";

/** Wraps any card in the delegated tilt+glow container. One container can hold MANY
 *  TiltCards -- the listener lives on the container, not on each card -- so wrap a whole
 *  board in one container rather than one per card where possible. A standalone card
 *  wraps itself. */
export default function TiltCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useTiltGlow(ref);
  return (
    <div ref={ref} className={cn("tilt-container", className)}>
      <div data-tilt data-glow className="tilt-card">
        {children}
      </div>
    </div>
  );
}
```

```typescript
// components/kargah/GlowSurface.tsx
"use client";

import { useRef } from "react";
import { useTiltGlow } from "@/lib/design/tilt";
import { cn } from "@/lib/cn";

/** Cursor-follow glow WITHOUT the 3D tilt -- for surfaces that want the lit-edge effect
 *  but not the perspective rotation (e.g. wide list rows, where tilt would look wrong). */
export default function GlowSurface({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useTiltGlow(ref);
  return (
    <div ref={ref} className={cn("glow-container", className)}>
      <div data-glow className="glow-card">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Confirm build**

```bash
npm run build 2>&1 | tail -30
```

- [ ] **Step 8: Manual verification of reduced-motion and RTL**

```bash
npm run dev &
sleep 3
```
In a browser: enable "reduce motion" in OS accessibility settings, confirm a `TiltCard`
does not tilt on hover. Disable it again, confirm it does, and confirm the tilt leans
*toward* the cursor (not away) in this RTL app. Stop dev server.

- [ ] **Step 9: Commit**

```bash
git add lib/design/tilt.ts tests/design/tilt.test.ts components/kargah/TiltCard.tsx components/kargah/GlowSurface.tsx app/globals.css
git commit -m "feat: delegated tilt+glow architecture (one listener, one active element)"
```

---

### Task 15: `GlassFace`

**Files:**
- Create: `components/kargah/GlassFace.tsx`

**Interfaces:**
- Produces: `<GlassFace tint? className? children>` — used for modal backdrops, the
  sticky header, and (later, by the pocket) its frosted document face. **Not** used on
  plain cards — spec §6.1 corrected the "glass everywhere" misreading; the reference's
  cards are opaque white.

- [ ] **Step 1: Read the pocket's existing frosted-face CSS**

```bash
grep -n "backdrop-filter" app/globals.css
```

- [ ] **Step 2: Implement, extracting the existing technique into a reusable primitive**

```typescript
// components/kargah/GlassFace.tsx
import { cn } from "@/lib/cn";

/** A frosted glass surface -- backdrop-filter blur+saturate, so whatever sits behind it
 *  bleeds through as a soft wash of colour. Restricted by design to modal backdrops, the
 *  sticky header, and the pocket's document face (spec §6.1) -- NOT applied to plain
 *  cards, both because the reference video's cards are opaque white and because
 *  backdrop-filter is the single most expensive property in this system (spec §7's perf
 *  budget caps it at 6 simultaneous instances). */
export default function GlassFace({
  tint,
  className,
  children,
}: {
  tint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("glass-face", className)}
      style={tint ? ({ "--glass-tint": tint } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
```

Add to `app/globals.css`:

```css
.glass-face {
  backdrop-filter: blur(16px) saturate(1.5);
  -webkit-backdrop-filter: blur(16px) saturate(1.5);
  background: color-mix(in srgb, var(--glass-tint, var(--surface)) 72%, transparent);
}

/* Firefox/older Safari without backdrop-filter support: an opaque fallback rather than
   see-through content with unreadable contrast. */
@supports not (backdrop-filter: blur(1px)) {
  .glass-face { background: var(--surface); }
}
```

- [ ] **Step 3: Confirm build**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add components/kargah/GlassFace.tsx app/globals.css
git commit -m "feat: extract GlassFace as a reusable primitive, scoped to modals/header/pocket"
```

---

### Task 16: Pill form kit — `IconButton`, `Field`, `Select`, `Textarea`, `RangeSlider`

**Files:**
- Create: `components/kargah/IconButton.tsx`
- Create: `components/kargah/Field.tsx`
- Create: `components/kargah/Select.tsx`
- Create: `components/kargah/Textarea.tsx`
- Create: `components/kargah/RangeSlider.tsx`
- Create: `lib/design/rangeFill.ts`
- Test: `tests/design/rangeFill.test.ts`

**Interfaces:**
- Produces: `<IconButton icon label onClick? />`, `<Field label ...inputProps />`,
  `<Select label options ...selectProps />`, `<Textarea label ...textareaProps />`,
  `<RangeSlider label min max value onChange formatValue? />`, and
  `fillPercent(value: number, min: number, max: number): number` — the one piece of real
  logic in this task, extracted as a pure function per Global Constraints (no
  component-rendering tests in this repo).

- [ ] **Step 1: Read the existing budget-slider fill mechanism this generalizes**

```bash
grep -n "range\|slider" components/sales/ProcessingModal.tsx | head -10
```
(MASTER.md documents this: a range input has no pseudo-element for its filled track, so
the fill is painted by hand as a linear gradient, and the input takes `direction: rtl` so
it fills from the right. `RangeSlider` generalizes that existing mechanism into a
standalone component.)

- [ ] **Step 2: Write the failing test for the fill-percentage math**

```typescript
// tests/design/rangeFill.test.ts
import { describe, it, expect } from "vitest";
import { fillPercent } from "@/lib/design/rangeFill";

describe("fillPercent", () => {
  it("is 0 at min and 100 at max", () => {
    expect(fillPercent(0, 0, 100)).toBe(0);
    expect(fillPercent(100, 0, 100)).toBe(100);
  });

  it("is proportional in between", () => {
    expect(fillPercent(25, 0, 100)).toBe(25);
    expect(fillPercent(42, 0, 100)).toBe(42);
  });

  it("handles a non-zero-based range", () => {
    expect(fillPercent(15, 10, 20)).toBe(50);
  });

  it("returns 0 rather than NaN/Infinity when min equals max", () => {
    expect(fillPercent(5, 10, 10)).toBe(0);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run tests/design/rangeFill.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement the pure function**

```typescript
// lib/design/rangeFill.ts
/** The filled-track percentage for a range input -- extracted as a pure function so it
 *  can be unit tested without rendering a component (this repo has no
 *  @testing-library/react / jsdom setup; see the plan's Global Constraints). */
export function fillPercent(value: number, min: number, max: number): number {
  return max > min ? ((value - min) / (max - min)) * 100 : 0;
}
```

- [ ] **Step 5: Run to confirm pass**

```bash
npx vitest run tests/design/rangeFill.test.ts
```
Expected: PASS, 4/4.

- [ ] **Step 6: Implement the five components**

```typescript
// components/kargah/IconButton.tsx
import { cn } from "@/lib/cn";

export default function IconButton({
  icon,
  label,
  className,
  ...rest
}: {
  icon: React.ReactNode;
  label: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-pill)]",
        "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]",
        "shadow-[var(--edge-hi),var(--sh-1)] transition-transform duration-150",
        "hover:scale-[1.05] active:scale-[0.97]",
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
```

```typescript
// components/kargah/Field.tsx
import { cn } from "@/lib/cn";

export default function Field({
  label,
  className,
  ...rest
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[length:var(--text-sm)] text-[var(--text-muted)]">
        {label}
      </span>
      <input
        className={cn(
          "w-full rounded-[var(--radius-pill)] border border-[var(--border)]",
          "bg-[var(--surface)] px-5 py-3 text-[var(--text)]",
          "shadow-[var(--edge-hi)] outline-none transition-colors",
          "focus:border-[var(--accent)]",
          className,
        )}
        {...rest}
      />
    </label>
  );
}
```

```typescript
// components/kargah/Select.tsx
import { cn } from "@/lib/cn";

export default function Select({
  label,
  options,
  className,
  ...rest
}: {
  label: string;
  options: { value: string; label: string }[];
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[length:var(--text-sm)] text-[var(--text-muted)]">
        {label}
      </span>
      <select
        className={cn(
          "w-full rounded-[var(--radius-pill)] border border-[var(--border)]",
          "bg-[var(--surface)] px-5 py-3 text-[var(--text)]",
          "shadow-[var(--edge-hi)] outline-none transition-colors",
          "focus:border-[var(--accent)]",
          className,
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

```typescript
// components/kargah/Textarea.tsx
import { cn } from "@/lib/cn";

export default function Textarea({
  label,
  className,
  ...rest
}: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[length:var(--text-sm)] text-[var(--text-muted)]">
        {label}
      </span>
      <textarea
        className={cn(
          "w-full rounded-[var(--radius-lg)] border border-[var(--border)]",
          "bg-[var(--surface)] px-5 py-3 text-[var(--text)]",
          "shadow-[var(--edge-hi)] outline-none transition-colors",
          "focus:border-[var(--accent)]",
          className,
        )}
        {...rest}
      />
    </label>
  );
}
```

```typescript
// components/kargah/RangeSlider.tsx
"use client";

import { cn } from "@/lib/cn";
import { fillPercent } from "@/lib/design/rangeFill";

/** Generalizes ProcessingModal's hand-painted range fill (MASTER.md: a range input has
 *  no pseudo-element for its filled track) into a reusable component. Takes
 *  direction: rtl on the input itself so the native fill-from behaviour matches this
 *  app's writing direction. */
export default function RangeSlider({
  label,
  min,
  max,
  value,
  onChange,
  formatValue = (v: number) => String(v),
  className,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const pct = fillPercent(value, min, max);
  return (
    <div className={cn("block", className)}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[length:var(--text-sm)] text-[var(--text-muted)]">{label}</span>
        <span className="text-[length:var(--text-lg)] font-medium text-[var(--text)]">
          {formatValue(value)}
        </span>
      </div>
      <input
        role="slider"
        type="range"
        min={min}
        max={max}
        value={value}
        dir="rtl"
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full appearance-none rounded-[var(--radius-pill)] bg-[var(--surface-sunk)] outline-none"
        style={{
          backgroundImage: `linear-gradient(to left, var(--accent) ${pct}%, transparent ${pct}%)`,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 7: Confirm build and smoke-test the slider fill visually**

```bash
npm run build 2>&1 | tail -30
npm run dev &
sleep 3
```
Open the page using `ProcessingModal`'s budget slider (or a page exercising the new
`RangeSlider`), drag it, confirm the fill tracks the handle and reads correctly under RTL
(fills from the right). Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add components/kargah/IconButton.tsx components/kargah/Field.tsx components/kargah/Select.tsx components/kargah/Textarea.tsx components/kargah/RangeSlider.tsx lib/design/rangeFill.ts
git commit -m "feat: pill form kit -- IconButton, Field, Select, Textarea, RangeSlider"
```

---

### Task 17: `SegmentedPill` and `AvatarStack` numeric badges

**Files:**
- Create: `components/kargah/SegmentedPill.tsx`
- Modify: `components/AvatarStack.tsx`

**Interfaces:**
- Produces: `<SegmentedPill options={{value,label}[]} value onChange />`,
  `<AvatarStack items={{src?,initial,badge?}[]} />` (badge is new).

**No component-rendering test** (Global Constraints — no `@testing-library/react`/jsdom
in this repo). Both the "current option marked active" logic and the click-to-select
handler are single-line, low-risk JSX/prop wiring with no extractable pure logic worth a
dedicated unit — the ResizeObserver-driven slide positioning is inherently DOM-dependent
and is verified visually in Step 5's smoke test instead.

- [ ] **Step 1: Read `TabPill.tsx`'s `slideThumb` measure-and-move technique in full**

```bash
cat components/kargah/TabPill.tsx
```
`SegmentedPill` is a NEW, generic component that reuses this proven measure-then-`translateX`
technique — it does not literally extend or import `TabPill`, which is tightly coupled to
`SalesTab`/`SalesGroupId` navigation types and is not a generic control.

- [ ] **Step 2: Implement**

```typescript
// components/kargah/SegmentedPill.tsx
"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/** A generic sliding-pill segmented control -- the trough-with-a-travelling-pill pattern
 *  from spec §4.4/§8, reusing TabPill's measure-then-translateX technique without
 *  TabPill's navigation-specific coupling. */
export default function SegmentedPill<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement | null>(null);

  const slide = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const on = el.querySelector<HTMLElement>(`[data-value="${value}"]`);
    const thumb = el.querySelector<HTMLElement>(".seg-thumb");
    if (!on || !thumb) return;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  }, [value]);

  useEffect(() => {
    slide();
    const ro = new ResizeObserver(slide);
    if (root.current) ro.observe(root.current);
    document.fonts?.ready.then(slide).catch(() => {});
    return () => ro.disconnect();
  }, [slide]);

  return (
    <div
      ref={root}
      role="group"
      className={cn(
        "relative inline-flex rounded-[var(--radius-pill)] bg-[var(--surface-sunk)] p-1",
        className,
      )}
    >
      <span className="seg-thumb absolute inset-y-1 rounded-[var(--radius-pill)] bg-[var(--primary)] transition-[transform,width] duration-[var(--dur-base,180ms)] ease-[var(--ease-out,ease-out)]" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-value={o.value}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-[1] rounded-[var(--radius-pill)] px-4 py-1.5 text-[length:var(--text-sm)] transition-colors",
            o.value === value ? "text-[var(--primary-ink)]" : "text-[var(--text-muted)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Confirm build, then smoke-test the slide and click behaviour**

```bash
npm run build 2>&1 | tail -30
```
This component is not yet imported anywhere — a bare `npm run build` succeeding confirms
only that the file compiles. Real verification happens once Task 20 (final integration)
or a later shell task mounts it; note that gap here rather than silently skipping
verification.

- [ ] **Step 4: Read the existing `AvatarStack.tsx` before extending it**

```bash
cat components/AvatarStack.tsx
```

- [ ] **Step 5: Add a numeric badge, preserving the existing prop shape**

Add an optional `badge?: number | string` field to whatever item type the file already
exports, and render it as a small circle at each avatar's bottom edge only when present
— read the existing component's exact prop/type names first (this task cannot supply them
sight-unseen) and extend rather than rewrite. Example shape of the addition, to be
adapted to the file's real structure:

```typescript
// added to the existing item type
badge?: number | string;
```

```typescript
// added inside the existing per-avatar render, after the image/initial:
{item.badge != null && (
  <span
    className="absolute -bottom-1 inline-flex h-4 min-w-4 items-center justify-center
               rounded-full border border-[var(--surface)] bg-[var(--info)]
               px-1 text-[9px] font-medium text-white"
  >
    {item.badge}
  </span>
)}
```

- [ ] **Step 6: Confirm existing `AvatarStack` consumers still build and render the badge**

```bash
grep -rln "AvatarStack" --include="*.tsx" . | grep -v node_modules
npm run build 2>&1 | tail -30
npm run dev &
sleep 3
```
Open a page that already uses `AvatarStack` (from the grep above), confirm existing
avatars render unchanged (no `badge` passed = no visual change). If any current caller
can trivially pass a `badge` value, do so temporarily to confirm it renders, then revert
— this task does not require wiring badges into real data, only that the prop works.
Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add components/kargah/SegmentedPill.tsx components/AvatarStack.tsx
git commit -m "feat: SegmentedPill generic control; AvatarStack numeric badges"
```

---

### Task 18: `ArcGauge`, `StatefulButton`, `GooeyInput`

**Files:**
- Create: `components/kargah/ArcGauge.tsx`
- Create: `components/kargah/StatefulButton.tsx`
- Create: `components/kargah/GooeyInput.tsx`
- Create: `lib/design/statefulButton.ts`
- Test: `tests/design/statefulButton.test.ts`

**Interfaces:**
- Produces: `<ArcGauge value min max label color? />`,
  `<StatefulButton onClick={() => void | Promise<void>}>children</StatefulButton>`,
  `<GooeyInput value onChange placeholder? />`,
  `nextButtonState(state: ButtonState, event: ButtonEvent): ButtonState`.

**Confirmed directly from the reference video (spec §9c):** `StatefulButton`'s
idle→loading→success cycle is what "Take for Processing" visibly does on screen — this is
not a speculative addition.

- [ ] **Step 1: Read the existing chart kit before adding a gauge to it**

```bash
cat components/charts/DonutChart.tsx
```
(`ArcGauge` is a simpler sibling to the existing donut chart, not a new charting
subsystem — reuse its SVG-arc math if `DonutChart.tsx` already has it.)

- [ ] **Step 2: Implement `ArcGauge`**

```typescript
// components/kargah/ArcGauge.tsx
/** A single-value arc gauge -- the video's soft-pastel progress rings. Deliberately
 *  simpler than DonutChart (one value, not a series): an SVG stroke-dasharray arc over a
 *  faint track, in the pastel palette spec §9b names. */
export default function ArcGauge({
  value,
  min = 0,
  max = 100,
  label,
  color = "var(--accent)",
  size = 96,
}: {
  value: number;
  min?: number;
  max?: number;
  label: string;
  color?: string;
  size?: number;
}) {
  const r = size / 2 - 8;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const dash = circumference * pct;

  return (
    <div className="inline-flex flex-col items-center gap-1" role="img" aria-label={`${label}: ${value}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-sunk)"
          strokeWidth={8}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-[var(--text)]"
          fontSize={size * 0.2}
        >
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">{label}</span>
    </div>
  );
}
```

- [ ] **Step 3: Write the failing test for the state machine, as a pure reducer**

The idle→loading→success→idle transitions are real logic worth testing directly, without
rendering (Global Constraints — no `@testing-library/react`/jsdom here). Extract them as
a pure reducer over an explicit event type:

```typescript
// tests/design/statefulButton.test.ts
import { describe, it, expect } from "vitest";
import { nextButtonState } from "@/lib/design/statefulButton";

describe("nextButtonState", () => {
  it("idle -> loading on click", () => {
    expect(nextButtonState("idle", "click")).toBe("loading");
  });

  it("ignores a click while already loading or in success", () => {
    expect(nextButtonState("loading", "click")).toBe("loading");
    expect(nextButtonState("success", "click")).toBe("success");
  });

  it("loading -> success on resolve", () => {
    expect(nextButtonState("loading", "resolve")).toBe("success");
  });

  it("loading -> idle on reject", () => {
    expect(nextButtonState("loading", "reject")).toBe("idle");
  });

  it("success -> idle on timeout", () => {
    expect(nextButtonState("success", "timeout")).toBe("idle");
  });
});
```

- [ ] **Step 4: Run to confirm failure**

```bash
npx vitest run tests/design/statefulButton.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 5: Implement the pure reducer, then `StatefulButton`**

```typescript
// lib/design/statefulButton.ts
export type ButtonState = "idle" | "loading" | "success";
export type ButtonEvent = "click" | "resolve" | "reject" | "timeout";

/** idle -> loading -> success -> idle. Confirmed live in the reference video on "Take
 *  for Processing" and "Add Case" (spec §9c) -- this is not a speculative addition.
 *  Extracted as a pure reducer so the transition logic is unit-testable without
 *  rendering a component. */
export function nextButtonState(state: ButtonState, event: ButtonEvent): ButtonState {
  if (state === "idle" && event === "click") return "loading";
  if (state === "loading" && event === "resolve") return "success";
  if (state === "loading" && event === "reject") return "idle";
  if (state === "success" && event === "timeout") return "idle";
  return state; // any other (state, event) pair is a no-op, not an error
}
```

```bash
npx vitest run tests/design/statefulButton.test.ts
```
Expected: PASS, 5/5.

```typescript
// components/kargah/StatefulButton.tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { nextButtonState, type ButtonState } from "@/lib/design/statefulButton";

export default function StatefulButton({
  onClick,
  children,
  className,
  successDurationMs = 1200,
}: {
  onClick: () => void | Promise<void>;
  children: React.ReactNode;
  className?: string;
  successDurationMs?: number;
}) {
  const [state, setState] = useState<ButtonState>("idle");

  const handleClick = async () => {
    setState((s) => nextButtonState(s, "click"));
    if (state !== "idle") return;
    try {
      await onClick();
      setState((s) => nextButtonState(s, "resolve"));
      setTimeout(() => setState((s) => nextButtonState(s, "timeout")), successDurationMs);
    } catch {
      setState((s) => nextButtonState(s, "reject"));
    }
  };

  return (
    <button
      type="button"
      data-state={state}
      onClick={handleClick}
      disabled={state === "loading"}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-pill)]",
        "bg-[var(--primary)] px-6 py-3 text-[var(--primary-ink)]",
        "transition-transform active:scale-[0.97] disabled:opacity-80",
        className,
      )}
    >
      {state === "loading" && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
      {state === "success" && (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === "idle" && children}
      {state === "loading" && <span>در حال پردازش...</span>}
      {state === "success" && <span>انجام شد</span>}
    </button>
  );
}
```

- [ ] **Step 6: Implement `GooeyInput`**

```typescript
// components/kargah/GooeyInput.tsx
"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

/** The gooey SVG-filter search input -- confirmed via Aceternity's own documentation
 *  (spec §8) to be feGaussianBlur + feColorMatrix contrast, reimplemented here in plain
 *  SVG rather than pulled in as a dependency. */
export default function GooeyInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const filterId = useId();
  return (
    <div className={cn("relative", className)} style={{ filter: `url(#${filterId})` }}>
      <svg width="0" height="0" className="absolute">
        <filter id={filterId}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -11"
          />
        </filter>
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </div>
  );
}
```

- [ ] **Step 7: Confirm build**

```bash
npm run build 2>&1 | tail -30
```

- [ ] **Step 8: Commit**

```bash
git add lib/design/statefulButton.ts components/kargah/ArcGauge.tsx components/kargah/StatefulButton.tsx components/kargah/GooeyInput.tsx
git commit -m "feat: ArcGauge, StatefulButton (confirmed from reference), GooeyInput"
```

---

### Task 19: Verify the pocket survives intact

**Files:** none changed if verification passes; `app/globals.css` if it does not.

- [ ] **Step 1: Locate the pocket's current CSS**

```bash
grep -n "^\.pocket\b\|^\.pocket__" app/globals.css
```

- [ ] **Step 2: Confirm the three palette-dependent declarations retinted correctly**

Per spec §9.1, exactly three declarations are palette-dependent:

```bash
grep -n "pocket__paper" app/globals.css | grep -i "background\|border"
```
Confirm `background` reads `var(--surface-2)` (not a hardcoded old hex) and `border`
reads `var(--border-strong)`. If either is a literal hex left over from before the
promotion, replace it with the token.

```bash
grep -n "pocket-tone\|color-mix" app/globals.css | grep -i pocket
```
Confirm the radial status wash still uses `color-mix(in srgb, var(--pocket-tone) 14%, ...)`
— unchanged, since it retints automatically once the status tokens (`--good`/`--warn`/
`--crit`) were retinted in Tasks 4–5.

- [ ] **Step 3: Confirm every geometry declaration is untouched**

```bash
grep -n "paper-i\|translateX(calc\|transform-origin: bottom" app/globals.css
```
These lines must be byte-identical to before this plan started — compare against the
Task 1 baseline if in doubt:

```bash
git show <task-1-commit-sha>:app/globals.css | grep -n "paper-i\|translateX(calc\|transform-origin: bottom"
```

- [ ] **Step 4: Visual smoke test**

```bash
npm run dev &
sleep 3
```
Open `/sales`, find a pocket card (an order with attachments), confirm: slips peek at
rest, fan out and rise on hover, colours match the new cool palette, nothing about the
fan animation itself changed. Stop dev server.

- [ ] **Step 5: Commit only if a fix was needed**

```bash
git add app/globals.css
git commit -m "fix: restore a pocket declaration that did not retint correctly"
```
(Skip this step entirely if Steps 2–4 found nothing to fix.)

---

### Task 20: Directional noise texture

**Files:**
- Modify: `app/globals.css`

**Interfaces:** none — a pure CSS utility class, `.noise-surface`, applied via
`className` by any consumer.

- [ ] **Step 1: Build the inline SVG `feTurbulence` grain as a data-URI**

Spec §6.3 recommends inline SVG `feTurbulence` over a PNG tile (no extra request, no
cache concern, ~400 bytes) or a CSS gradient dither (visibly banded at this subtlety).
Add to `app/globals.css`:

```css
/* Fine directional grain -- spec §6.3. A single SVG feTurbulence data-URI, declared
   once and reused everywhere via the utility class below rather than per-surface.
   Sits on a ::before BELOW the surface's own content (z-index: -1 relative to its
   `position: relative` parent) at very low opacity, so it can never affect text
   contrast -- verified in Step 3. */
.noise-surface {
  position: relative;
  isolation: isolate;
}
.noise-surface::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  opacity: 0.035;
  mix-blend-mode: overlay;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-repeat: repeat;
}
```

- [ ] **Step 2: Apply it to `NotchedCard`'s base surface**

In `components/kargah/NotchedCard.tsx`, add `noise-surface` to the `notch-card`
element's className (via `cn("notch-card", ...)`), so every notched card carries the
grain by default.

- [ ] **Step 3: Confirm it does not affect text contrast**

```bash
npm run check:contrast
```
Expected: unchanged pass — the grain sits below content at 3.5% opacity and blend-mode
`overlay`, which per spec §6.3 "must not tint the surface or hurt text contrast." If any
check newly fails, lower the opacity in Step 1 until it passes again.

- [ ] **Step 4: Visual smoke test**

```bash
npm run dev &
sleep 3
```
Open `/sales`, confirm the grain is a barely-visible texture on card surfaces, not a
visible pattern or a colour cast. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css components/kargah/NotchedCard.tsx
git commit -m "feat: directional noise texture via inline SVG feTurbulence"
```

---

### Task 21: Rewrite MASTER.md

**Files:**
- Modify: `MASTER.md`

Per spec §12. MASTER.md's authority over this work was explicitly revoked by the user,
but the document itself should still describe the app as it now is — future contributors
(human or agent) will read it as the source of truth going forward, so leaving it
describing the dead warm-cream system would recreate exactly the confusion this project
fixed.

- [ ] **Step 1: Read the current file in full**

```bash
cat MASTER.md
```

- [ ] **Step 2: Rewrite section by section, per the spec's §12 table**

| Section | Change |
|---|---|
| Visual thesis | Replace with spec §3's "Machined" thesis in full |
| Theme architecture | Rewrite: light is default (`:root`), dark is `:root[data-theme="dark"]`; describe the three-state auto/light/dark model and `/driver`'s pin (Task 9); delete the "Dark is the default" line and the self-contradiction with the old Visual thesis section |
| Color | Replace the light/dark tables with the exact values from spec §4.1–§4.2 |
| Elevation | Replace with spec §4.3's shadow stack + the new `--edge-hi`/`--edge-lo` inset highlights |
| Radii | Update the scale to `--radius-2xl: 28px` |
| Motion | Rewrite: delete "Where spring stays banned" as a blanket rule; state that tilt/glow/glass apply everywhere except `/driver`; add the delegated-listener architecture (Task 14) and the perf budget (spec §7) as the new binding constraints; keep `prefers-reduced-motion` and WCAG contrast as the two rules that survive on engineering merit |
| Base components / CRM patterns | Point to the new kit (Tasks 12–18) in place of the old `TARGET` list; mark `Document pocket card` `SHIPPED` (verified intact, Task 19) |
| Anti-patterns | Delete the Lucide/Feather exclusion line (dead — spec §11 approves `lucide-react`); delete the "No spring easing on hover targets... or in driver mode" line, replacing the driver clause with the correct one: spring/tilt/glow are banned in `/driver` specifically, not everywhere; keep every other line (reduced-motion, contrast, no theme branching in JS, no `box-shadow` on `clip-path`, etc.) |
| Not yet decided | Resolve "Icon set" → Lucide (decided); remove |

- [ ] **Step 3: Add a note at the top of the file recording the authority change**

```markdown
> **2026-09-08.** This document's *rules* were superseded by direct user instruction —
> the notched, skeuomorphic, cool+black substrate described below is not derived from
> anything that came before it. It is kept up to date as a description of the app's
> actual design system, not as a source of constraints competing with new instructions.
> See `docs/superpowers/specs/2026-09-08-notched-skeuomorphic-substrate-design.md`.
```

- [ ] **Step 4: Confirm no other file cites the now-deleted sections**

```bash
grep -rln "کارگاه — a warm workshop\|Dark is the default" --include="*.tsx" --include="*.ts" --include="*.md" . | grep -v node_modules
```
Update any comment that quotes the old thesis verbatim (a handful of component doc
comments do — e.g. `CarvedCard.tsx`'s old file, already deleted in Task 13; check for
others).

- [ ] **Step 5: Commit**

```bash
git add MASTER.md
git commit -m "docs: rewrite MASTER.md for the notched skeuomorphic substrate"
```

---

### Task 22: Final integration verification

**Files:** none.

- [ ] **Step 1: Full test suite**

```bash
npm test 2>&1 | tee /tmp/final-test-output.txt
```
Expected: all pass. Compare failure count against
`docs/superpowers/audits/2026-09-08-pre-substrate-test-baseline.txt` — any NEW failure
(not present in the baseline) must be fixed before proceeding.

- [ ] **Step 2: Contrast checker**

```bash
npm run check:contrast
```
Expected: every line `✓`.

- [ ] **Step 3: Production build**

```bash
npm run build 2>&1 | tail -50
```
Expected: succeeds with no new warnings about the deleted files
(`lib/design/carve.ts`, `components/kargah/CarvedCard.tsx`).

- [ ] **Step 4: Full manual smoke test**

```bash
npm start &
sleep 3
```
Walk through: `/sales` (dashboard, an order with a pocket, the notched card from Task
13), `/settings` (theme toggle in all three states — auto/light/dark), toggle OS dark
mode with the app on "auto" and confirm it follows live, confirm `/driver` stays pinned
regardless of the OS toggle. Stop the server.

- [ ] **Step 5: Push the branch**

```bash
git push -u origin theme/notched-skeuomorphic-substrate
```

---

## Deferred — follow-on plans

Not in this plan, per spec §17 steps 5–8. Each becomes its own plan once this one's real
component APIs (Tasks 12–18) exist to build against:

- **Shell** — `NavBar` (RTL-correct per spec §9a), `IconRail`, `ThemeToggle3` (wraps
  `resolveTheme`/`setTheme` from Task 9), `BentoGrid` extending `BentoStrip.tsx`.
- **Backend** — user avatar schema + upload path; `workflow_edges` +
  `workflow_step_templates` (fixed, seeded — spec §9d) + the instantiate-on-link endpoint;
  task→stage assignment.
- **Journey UI** — the new `/sales/tasks` workflow board: `JourneyGraph` SVG overlay,
  `NodePort`, `TaskRow`, the trace-on-click and link-drag gestures (spec §9c).
  `OrderJourney.tsx` is explicitly not touched by any future plan either — it keeps its
  read-only invariant.
- **Brand** — the logo mark, full icon/favicon set, splash screen (spec §10). User
  reviews the mark before it ships.
