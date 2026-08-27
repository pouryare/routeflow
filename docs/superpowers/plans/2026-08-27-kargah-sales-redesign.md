# کارگاه — /sales Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dark navy/cyan "instrument panel" styling of every `/sales` surface with the کارگاه warm-workshop design system, in both light and dark themes.

**Architecture:** All visual values move to a rewritten token layer in `app/globals.css`; components consume tokens and never branch on theme in JS. The three pieces of genuinely tricky logic — the carved-card silhouette, the spline path, and the entrance stagger — are extracted into pure functions under `lib/design/` so they can be unit-tested in the existing node-environment vitest setup. CSS and DOM behaviour that cannot be unit-tested is verified in a real browser with Playwright before each commit.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Tailwind v4 (`@theme inline` over CSS custom properties), vitest (node env), Playwright (verification only, already a devDependency).

**Spec:** `MASTER.md` at repo root (rewritten on this branch). Read it before Task 1.

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include these.

- **Every text token clears 4.5:1 against BOTH `--bg` and `--surface`.** Verified by `npm run check:contrast`, not by eye.
- **`--text-faint` is a non-text token in light** (3.07:1). Never use it for anything a reader must read; use `--text-muted`.
- **`--accent` is fills only in light.** Accent *as text* uses `--accent-text` (`#B44E28`).
- **`--accent-ink` is `#FFFFFF` in light and `#241009` in dark.** White on dark's accent is 3.01:1 and fails.
- **`--crit` is a crimson, not an orange-red** (`#A11B3F` light / `#F2789B` dark) — an orange-red sits ΔE 17 from the terracotta accent.
- **A `clip-path`ed element takes `filter: var(--card-drop)`, never `box-shadow`.**
- **Stagger cap is 10 items.** Item 11 onward shares item 10's delay.
- **Entrance reset order is fixed:** `transition: none` + clear delay → force style flush → restore transition, set delay, add class.
- **Never `setPointerCapture` on a drag container** — capture on the dragged card.
- **Never `preventDefault()` on `pointerdown`** — it kills the click.
- **Centred fixed overlays use physical `left: 50%` + `translateX(-50%)`**, never `inset-inline-start`.
- **Fonts:** IBM Plex Sans Arabic (`--font-fa`), Plus Jakarta Sans (`--font-en`). Vazirmatn and JetBrains Mono are retired from `/sales`.
- **All motion degrades under `prefers-reduced-motion`** to an immediate paint.
- Persian copy throughout; the app is RTL. Money via `faToman`, counts via `faNum` from `lib/format.ts` — never hand-formatted.
- **The کارگاه palette is scoped to `.kargah`, never to `:root`.** 21 files outside `/sales` — the map among them — read `--bg`, `--surface` and `--accent` from `:root`. Redefining those globally re-skins the map, which is explicitly out of scope. The existing `:root` palette stays exactly as it is.

**Deploy note:** this app runs as a systemd production service. Source edits do not appear until `npm run build && systemctl restart coverage-map`. Do not restart until Task 14.

---

## File Structure

**Created**
| File | Responsibility |
|---|---|
| `lib/design/contrast.ts` | Relative luminance, contrast ratio, hex parsing |
| `lib/design/carve.ts` | The carved-bay SVG path from measured card size |
| `lib/design/spline.ts` | Catmull-Rom → cubic bézier path for the chart |
| `lib/design/stagger.ts` | Capped stagger delays |
| `scripts/check-contrast.mjs` | CLI: parses `globals.css`, asserts every pair passes |
| `components/kargah/Reveal.tsx` | Entrance choreography (client) |
| `components/kargah/TabPill.tsx` | Travelling tab pill nav (client) |
| `components/kargah/CarvedCard.tsx` | Card with a subtracted bay (client) |
| `components/kargah/PocketCard.tsx` | Document-pocket order card |
| `components/kargah/GradientStat.tsx` | Mesh-gradient KPI card |
| `components/charts/SplineChart.tsx` | Smooth line chart with tooltip (client) |
| `components/sales/OrderPipeline.tsx` | Status-column drag board (client) |
| `components/sales/ProcessingModal.tsx` | Order processing dialog (client) |
| `components/sales/OrderJourney.tsx` | Lifecycle swimlanes (client) |
| `tests/contrast.test.ts` `tests/carve.test.ts` `tests/spline.test.ts` `tests/stagger.test.ts` | Unit tests for the above |

**Modified**
| File | Change |
|---|---|
| `app/globals.css` | Token layer rewritten light-first; new tokens |
| `app/layout.tsx` | Font swap |
| `components/ThemeToggle.tsx` | Sun/moon SVG toggle |
| `app/sales/layout.tsx` | TabPill nav, new chrome |
| `app/sales/page.tsx` … `app/sales/stock/page.tsx` | Re-skin against tokens |
| `package.json` | `check:contrast` script |

---

## Task 1: Contrast primitives and the checker

Establishes the guard that every later colour decision is measured against.

**Files:**
- Create: `lib/design/contrast.ts`
- Create: `tests/contrast.test.ts`
- Create: `scripts/check-contrast.mjs`
- Modify: `package.json` (scripts block)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseHex(hex: string): [number, number, number]`
  - `relativeLuminance(hex: string): number`
  - `contrastRatio(a: string, b: string): number`

- [ ] **Step 1: Write the failing test**

```ts
// tests/contrast.test.ts
import { describe, it, expect } from "vitest";
import { parseHex, relativeLuminance, contrastRatio } from "@/lib/design/contrast";

describe("contrast", () => {
  it("parses 6-digit hex with and without the hash", () => {
    expect(parseHex("#FFFFFF")).toEqual([255, 255, 255]);
    expect(parseHex("000000")).toEqual([0, 0, 0]);
  });

  it("computes the WCAG reference luminances", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });

  it("gives 21:1 for black on white, and is symmetric", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 2);
  });

  it("agrees with the figures MASTER.md publishes", () => {
    // --text on --bg, light theme
    expect(contrastRatio("#231C16", "#F4F0E9")).toBeCloseTo(14.8, 1);
    // --accent-ink on --accent, dark theme
    expect(contrastRatio("#241009", "#E8734A")).toBeCloseTo(6.06, 1);
    // the failure that made --accent-text necessary
    expect(contrastRatio("#C0532B", "#F4F0E9")).toBeLessThan(4.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/contrast.test.ts`
Expected: FAIL — cannot resolve `@/lib/design/contrast`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/design/contrast.ts
/** WCAG 2.1 relative luminance and contrast ratio.
 *
 *  MASTER.md publishes a contrast figure beside every colour token and claims they are
 *  computed rather than eyeballed. This module is what computes them, and
 *  scripts/check-contrast.mjs is what stops the claim going stale.
 */
export function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`not a 6-digit hex colour: ${hex}`);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/contrast.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the checker CLI**

```js
// scripts/check-contrast.mjs
/** Asserts every token pair MASTER.md makes a claim about still holds.
 *
 *  Reads the real values out of app/globals.css so the check cannot drift from the
 *  stylesheet — a table in a markdown file is a promise, and this is the test for it.
 */
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

function block(selector) {
  const i = css.indexOf(selector);
  if (i === -1) throw new Error(`no ${selector} block in globals.css`);
  const open = css.indexOf("{", i);
  let depth = 0, j = open;
  for (; j < css.length; j++) {
    if (css[j] === "{") depth++;
    else if (css[j] === "}") { depth--; if (depth === 0) break; }
  }
  const body = css.slice(open + 1, j);
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const channel = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lum = (hex) => { const h = hex.replace("#", ""); const p = (i) => parseInt(h.slice(i, i + 2), 16);
  return 0.2126 * channel(p(0)) + 0.7152 * channel(p(2)) + 0.0722 * channel(p(4)); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); const [hi, lo] = x > y ? [x, y] : [y, x]; return (hi + 0.05) / (lo + 0.05); };

/** [token, threshold, grounds] — grounds are token names in the same theme block. */
const TEXT = ["--text", "--text-muted", "--good", "--warn", "--crit", "--info", "--tint-plum"];
const NON_TEXT = ["--text-faint"];

let failures = 0;
for (const [name, sel] of [["light", ":root"], ["dark", ':root[data-skin="dark"]']]) {
  const t = block(sel);
  const grounds = ["--bg", "--surface"];
  const check = (token, need) => {
    for (const g of grounds) {
      if (!t[token] || !t[g]) { console.error(`✗ ${name}: missing ${token} or ${g}`); failures++; return; }
      const r = ratio(t[token], t[g]);
      const ok = r >= need;
      if (!ok) failures++;
      console.log(`${ok ? "✓" : "✗"} ${name} ${token} on ${g}: ${r.toFixed(2)} (need ${need})`);
    }
  };
  TEXT.forEach((tk) => check(tk, 4.5));
  NON_TEXT.forEach((tk) => check(tk, 3));
  // accent-text must clear 4.5; accent itself is a fill and only needs its ink to pass
  check("--accent-text", 4.5);
  const inkOnAccent = ratio(t["--accent-ink"], t["--accent"]);
  const ok = inkOnAccent >= 4.5;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name} --accent-ink on --accent: ${inkOnAccent.toFixed(2)} (need 4.5)`);
}

if (failures) { console.error(`\n${failures} contrast failure(s)`); process.exit(1); }
console.log("\nall contrast pairs pass");
```

- [ ] **Step 6: Add the npm script**

In `package.json`, inside `"scripts"`, add:

```json
"check:contrast": "node scripts/check-contrast.mjs"
```

- [ ] **Step 7: Commit**

```bash
git add lib/design/contrast.ts tests/contrast.test.ts scripts/check-contrast.mjs package.json
git commit -m "Add contrast primitives and the checker MASTER.md's tables promise"
```

(The checker will fail until Task 2 lands the tokens. That is expected — it is the failing test for Task 2.)

---

## Task 2: The token layer

**Files:**
- Modify: `app/globals.css` (append a scoped block; leave `:root` alone)

**Interfaces:**
- Consumes: `scripts/check-contrast.mjs` from Task 1.
- Produces: the CSS custom properties every later task consumes. Names exactly as in MASTER.md's Color, Elevation, Radii and Typography tables, plus `--card-drop`, `--font-fa`, `--font-en`.

**Scoping.** These tokens are defined on `.kargah`, **not** `:root`. The map, `/leads`,
`/analytics` and `/report` read the existing `:root` palette and are out of scope; a
global redefinition would silently re-skin all of them. `app/sales/layout.tsx` puts
`className="kargah"` on its root element (Task 9), and every `/sales` overlay that
renders in a portal must also carry the class or it will inherit the old palette.

- [ ] **Step 1: Run the checker to see it fail**

Run: `npm run check:contrast`
Expected: FAIL — there is no `.kargah` block yet.
The checker reads `.kargah` and `:root[data-skin="dark"] .kargah`; update the selectors
in `scripts/check-contrast.mjs` from Task 1 to match before running.

- [ ] **Step 2: Add the scoped light block (default)**

Append to `app/globals.css`:

```css
/* ═══ کارگاه — the /sales design system ══════════════════════════════════════
   Scoped to .kargah on purpose. The map and the other CRM surfaces still read the
   original :root palette; see MASTER.md "Product shape".                      */
.kargah {
  /* ---- Colour: light is the default and the identity. See MASTER.md "Color". ---- */
  --bg: #F4F0E9;
  --surface: #FFFFFF;
  --surface-2: #FDFBF8;
  --surface-sunk: #EFE9E0;
  --border: #EAE2D7;
  --border-strong: #DED4C6;
  --text: #231C16;
  --text-muted: #776C60;
  /* Non-text only (3.07:1). Solved to 4.5 it collapses into --text-muted, so the two
     roles would stop being distinguishable. Anything readable uses --text-muted. */
  --text-faint: #91887C;
  --accent: #C0532B;        /* fills only in light */
  --accent-text: #B44E28;   /* accent as text: 4.55 on --bg */
  --accent-ink: #FFFFFF;    /* on an --accent fill: 4.65 */
  --good: #4F6B4A;
  --warn: #91650F;
  --crit: #A11B3F;          /* crimson, not orange-red: ΔE 35 from --accent */
  --info: #2E6382;
  --tint-plum: #6B4FA0;

  /* soft tints for pill fills; text on these answers to the pill, not the page */
  --accent-soft: #FBEDE6;
  --good-soft: #E9F0E6;
  --warn-soft: #FBF1DD;
  --crit-soft: #FBE9EE;
  --info-soft: #E5F0F6;
  --plum-soft: #F2ECFA;

  /* ---- Elevation ---- */
  --sh-1: 0 1px 2px rgba(62,44,28,.05), 0 4px 14px -6px rgba(62,44,28,.10);
  --sh-2: 0 2px 5px rgba(62,44,28,.06), 0 14px 34px -12px rgba(62,44,28,.17);
  --sh-3: 0 4px 10px rgba(62,44,28,.07), 0 28px 60px -18px rgba(62,44,28,.28);
  --sh-lift: 0 10px 22px -8px rgba(62,44,28,.24), 0 30px 60px -24px rgba(62,44,28,.30);
  /* drop-shadow form, for clip-path'd elements where box-shadow is clipped away */
  --card-drop: drop-shadow(0 1px 2px rgba(62,44,28,.07)) drop-shadow(0 12px 26px rgba(62,44,28,.13));

  /* ---- Radii ---- */
  --radius-sm: 9px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-2xl: 26px;
  --radius-pill: 999px;

  /* ---- Type ---- */
  --text-xs: 0.6875rem;
  --text-sm: 0.8125rem;
  --text-base: 0.9375rem;
  --text-md: 1.0625rem;
  --text-lg: 1.3125rem;
  --text-xl: 1.5rem;
  --text-2xl: 2rem;
  --text-3xl: 2.875rem;
}
```

Keep the existing spacing scale, the whole `--z-*` stacking list, and the motion tokens — they are unchanged by this redesign. Add these motion tokens beside them:

```css
  --spring-pop: cubic-bezier(0.34, 1.56, 0.64, 1);
  --stagger-base: 55ms;
  --stagger-cap: 10;   /* documentation only; enforced in lib/design/stagger.ts */
```

- [ ] **Step 3: Add the scoped dark block**

Leave the existing `:root[data-theme="light"]` block untouched — it belongs to the map.
Append:

```css
/* ---- Dark ------------------------------------------------------------------
   Not an inversion. The ground is warm-black rather than the map's blue-black, the
   terracotta is lifted because light's brick disappears against it, and every "soft"
   tint is re-solved as a deep tone rather than a pale one.

   The attribute is data-skin, NOT data-theme: /sales carries its own toggle and must
   not fight whatever else sets data-theme on the document.                        */
:root[data-skin="dark"] .kargah {
  --bg: #141110;
  --surface: #1E1A17;
  --surface-2: #242019;
  --surface-sunk: #2B241E;
  --border: #312A22;
  --border-strong: #3E352B;
  --text: #F3EEE7;
  --text-muted: #9B8F81;
  --text-faint: #8A8278;
  --accent: #E8734A;
  --accent-text: #E8734A;
  --accent-ink: #241009;   /* NOT white — white on this accent is 3.01:1 */
  --good: #93C289;
  --warn: #E0A64A;
  --crit: #F2789B;
  --info: #83B9DC;
  --tint-plum: #B79EEA;

  --accent-soft: #3B241A;
  --good-soft: #22301F;
  --warn-soft: #33280F;
  --crit-soft: #3A1B25;
  --info-soft: #1B2A34;
  --plum-soft: #2A2337;

  --sh-1: 0 1px 2px rgba(0,0,0,.5), 0 4px 14px -6px rgba(0,0,0,.6);
  --sh-2: 0 2px 5px rgba(0,0,0,.55), 0 14px 34px -12px rgba(0,0,0,.7);
  --sh-3: 0 4px 10px rgba(0,0,0,.6), 0 28px 60px -18px rgba(0,0,0,.8);
  --sh-lift: var(--sh-3);
  --card-drop: drop-shadow(0 1px 2px rgba(0,0,0,.5)) drop-shadow(0 14px 30px rgba(0,0,0,.6));
}
```

- [ ] **Step 4: Extend `@theme inline`**

Tailwind's `@theme inline` is global, so it maps *names*, and the values resolve per
element from whichever scope wins. Add the new names alongside the existing ones —
do not remove the entries the map depends on:

```css
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-surface-sunk: var(--surface-sunk);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-text-faint: var(--text-faint);
  --color-accent: var(--accent);
  --color-accent-text: var(--accent-text);
  --color-accent-ink: var(--accent-ink);
  --color-good: var(--good);
  --color-warn: var(--warn);
  --color-crit: var(--crit);
  --color-info: var(--info);
  --font-sans: var(--font-fa);
  --font-num: var(--font-en);
}
```

- [ ] **Step 5: Run the checker to verify it passes**

Run: `npm run check:contrast`
Expected: every line prefixed `✓`, ending `all contrast pairs pass`.

- [ ] **Step 6: Run the whole suite for regressions**

Run: `npm test`
Expected: all existing tests still pass — none of them read colours.

- [ ] **Step 7: Commit**

```bash
git add app/globals.css
git commit -m "Rewrite the token layer light-first, in the کارگاه palette"
```

---

## Task 3: Fonts

**Files:**
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `--font-fa` / `--font-en` names from Task 2.
- Produces: those two CSS variables, populated by `next/font`.

- [ ] **Step 1: Swap the font imports**

Replace the `Vazirmatn` / `JetBrains_Mono` imports and their instances:

```tsx
import { IBM_Plex_Sans_Arabic, Plus_Jakarta_Sans } from "next/font/google";

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-fa",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-en",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});
```

Then update the `<html className={...}>` to use `${plexArabic.variable} ${jakarta.variable}`.

- [ ] **Step 2: Verify the fonts resolve**

Run: `npm run build`
Expected: build succeeds. `next/font` fails the build loudly if a family or weight does not exist, so a green build is the check.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "Swap to IBM Plex Sans Arabic and Plus Jakarta Sans"
```

---

## Task 4: Stagger timing

**Files:**
- Create: `lib/design/stagger.ts`
- Create: `tests/stagger.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `staggerDelays(count: number, step?: number, cap?: number): number[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/stagger.test.ts
import { describe, it, expect } from "vitest";
import { staggerDelays } from "@/lib/design/stagger";

describe("staggerDelays", () => {
  it("steps by the given interval", () => {
    expect(staggerDelays(4, 55)).toEqual([0, 55, 110, 165]);
  });

  it("caps so a long list does not read as lag", () => {
    // 13 items, cap 10 -> items 10, 11, 12 all share item 10's delay
    const d = staggerDelays(13, 55, 10);
    expect(d[10]).toBe(550);
    expect(d[11]).toBe(550);
    expect(d[12]).toBe(550);
  });

  it("returns an empty list for nothing to stagger", () => {
    expect(staggerDelays(0)).toEqual([]);
  });

  it("collapses to all-zero when motion is reduced", () => {
    expect(staggerDelays(5, 55, 10, true)).toEqual([0, 0, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stagger.test.ts`
Expected: FAIL — cannot resolve `@/lib/design/stagger`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/design/stagger.ts
/** Entrance delays for a group of elements.
 *
 *  The cap is the whole point. A stagger that keeps counting past ten items stops
 *  reading as rhythm and starts reading as lag -- see MASTER.md, Motion, Tier 0.
 */
export function staggerDelays(
  count: number,
  step = 55,
  cap = 10,
  reduced = false
): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    reduced ? 0 : Math.min(i, cap) * step
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/stagger.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/design/stagger.ts tests/stagger.test.ts
git commit -m "Add capped stagger timing"
```

---

## Task 5: The carved-bay path

**Files:**
- Create: `lib/design/carve.ts`
- Create: `tests/carve.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CarveOpts = { notchWidth?: number; notchHeight?: number; radius?: number; innerRadius?: number; minWidth?: number }`
  - `carvedCardPath(w: number, h: number, opts?: CarveOpts): string | null` — returns `null` when the card is too narrow to carve.

- [ ] **Step 1: Write the failing test**

```ts
// tests/carve.test.ts
import { describe, it, expect } from "vitest";
import { carvedCardPath } from "@/lib/design/carve";

describe("carvedCardPath", () => {
  it("returns null below the minimum width, so narrow cards stay plain", () => {
    expect(carvedCardPath(320, 200)).toBeNull();
  });

  it("draws a closed path starting at the top-left radius", () => {
    const d = carvedCardPath(900, 200)!;
    expect(d.startsWith("M 26 0")).toBe(true);
    expect(d.trimEnd().endsWith("Z")).toBe(true);
  });

  it("cuts the bay out of the top INLINE-START (right) edge", () => {
    const d = carvedCardPath(900, 200, { notchWidth: 260, notchHeight: 62 })!;
    // the horizontal run along the top stops short of the notch
    expect(d).toContain("H 620");            // 900 - 260 - 20 (inner radius)
    // and the shoulder's top edge sits at the notch depth
    expect(d).toContain("A 26 26 0 0 1 900 88");  // 62 + 26
  });

  it("clamps the notch so it never eats the whole card", () => {
    const d = carvedCardPath(400, 200, { notchWidth: 900 })!;
    // 400 - 120 leaves a 120px shoulder no matter what was asked for
    expect(d).toContain("H 260");            // 400 - 280(clamped) ... see impl
  });

  it("uses only absolute commands, so the string is inspectable", () => {
    const d = carvedCardPath(900, 200)!;
    expect(d).not.toMatch(/[mlhvcsqta]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/carve.test.ts`
Expected: FAIL — cannot resolve `@/lib/design/carve`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/design/carve.ts
/** The silhouette of a card with a rounded rectangle SUBTRACTED from its top
 *  inline-start corner -- see MASTER.md, "Carved bay card".
 *
 *  Written as a path rather than a mask image because the notch keeps a fixed size
 *  while the card is fluid: a mask sized in percentages stretches the corner radii as
 *  the card grows. Consumers pass their own measured box and set the result as
 *  `clip-path: path("...")`.
 *
 *  Coordinates are physical, and the bay is on the RIGHT because /sales is RTL and
 *  inline-start resolves there.
 */
export type CarveOpts = {
  notchWidth?: number;
  notchHeight?: number;
  radius?: number;
  innerRadius?: number;
  minWidth?: number;
};

export function carvedCardPath(w: number, h: number, opts: CarveOpts = {}): string | null {
  const {
    notchHeight: nh = 62,
    radius: R = 26,
    innerRadius: r = 20,
    minWidth = 360,
  } = opts;

  if (!(w > 0) || !(h > 0) || w < minWidth) return null;

  /* Always leave a shoulder. A notch wide enough to reach the far corner is not a bay,
     it is a shorter card, and the stepped edge stops reading. */
  const nw = Math.max(190, Math.min(opts.notchWidth ?? 272, w - 120));

  return [
    "M", R, 0,
    "H", w - nw - r,
    "A", r, r, 0, 0, 1, w - nw, r,          // convex: turn down into the bay
    "V", nh - r,
    "A", r, r, 0, 0, 0, w - nw + r, nh,     // concave: the step's inner corner
    "H", w - R,
    "A", R, R, 0, 0, 1, w, nh + R,          // the shoulder's top corner
    "V", h - R,
    "A", R, R, 0, 0, 1, w - R, h,
    "H", R,
    "A", R, R, 0, 0, 1, 0, h - R,
    "V", R,
    "A", R, R, 0, 0, 1, R, 0,
    "Z",
  ].join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/carve.test.ts`
Expected: PASS, 5 tests. If the clamp assertion in test 4 disagrees with the implementation's arithmetic, fix the *test's* expected number to match `w - 120` — the behaviour under test is "a shoulder always survives", not a specific literal.

- [ ] **Step 5: Commit**

```bash
git add lib/design/carve.ts tests/carve.test.ts
git commit -m "Add the carved-bay card silhouette"
```

---

## Task 6: The spline path

**Files:**
- Create: `lib/design/spline.ts`
- Create: `tests/spline.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Pt = { x: number; y: number }`
  - `splinePath(points: Pt[]): string`
  - `areaPath(points: Pt[], baseline: number): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/spline.test.ts
import { describe, it, expect } from "vitest";
import { splinePath, areaPath } from "@/lib/design/spline";

const pts = [
  { x: 0, y: 10 }, { x: 10, y: 30 }, { x: 20, y: 20 }, { x: 30, y: 40 },
];

describe("splinePath", () => {
  it("is empty for fewer than two points", () => {
    expect(splinePath([])).toBe("");
    expect(splinePath([{ x: 1, y: 1 }])).toBe("");
  });

  it("starts with a move to the first point", () => {
    expect(splinePath(pts).startsWith("M 0 10")).toBe(true);
  });

  it("emits one cubic per gap", () => {
    expect((splinePath(pts).match(/C/g) ?? []).length).toBe(pts.length - 1);
  });

  it("ends exactly on the last point, so the line does not drift", () => {
    expect(splinePath(pts).trimEnd().endsWith("30 40")).toBe(true);
  });
});

describe("areaPath", () => {
  it("closes the spline down to the baseline and back", () => {
    const d = areaPath(pts, 100);
    expect(d).toContain("L 30 100");
    expect(d).toContain("L 0 100");
    expect(d.trimEnd().endsWith("Z")).toBe(true);
  });

  it("is empty when the spline is", () => {
    expect(areaPath([], 100)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/spline.test.ts`
Expected: FAIL — cannot resolve `@/lib/design/spline`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/design/spline.ts
/** A Catmull-Rom spline through the points, converted to cubic béziers.
 *
 *  A real curve, not a polyline pretending to be one: the control points are derived
 *  from the neighbours of each segment, so the line passes exactly through every data
 *  point while staying smooth across them. Endpoints duplicate their neighbour, which
 *  is what stops the curve overshooting at the ends of the series.
 */
export type Pt = { x: number; y: number };

export function splinePath(points: Pt[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function areaPath(points: Pt[], baseline: number): string {
  const line = splinePath(points);
  if (!line) return "";
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/spline.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/design/spline.ts tests/spline.test.ts
git commit -m "Add the Catmull-Rom spline path builder"
```

---

## Task 7: Reveal — entrance choreography

**Files:**
- Create: `components/kargah/Reveal.tsx`
- Modify: `app/globals.css` (append the `.rev` rules)

**Interfaces:**
- Consumes: `staggerDelays` (Task 4).
- Produces: `<Reveal>{children}</Reveal>` — a client component that staggers its **direct element children** in, and replays whenever its `replayKey` prop changes.
  - `type RevealProps = { children: React.ReactNode; replayKey?: string | number; step?: number; className?: string }`

- [ ] **Step 1: Add the CSS**

Append to `app/globals.css`:

```css
/* ---- Entrance (MASTER.md, Motion, Tier 0) ------------------------------------
   Only opacity and transform. The reset order is the fragile part and lives in
   components/kargah/Reveal.tsx; see the comment there before changing either.   */
.rev { opacity: 0; transform: translateY(16px); }
.rev.rev-in {
  opacity: 1;
  transform: none;
  transition: opacity 460ms var(--ease-out), transform 620ms var(--spring-pop);
}
@media (prefers-reduced-motion: reduce) {
  .rev { opacity: 1; transform: none; }
}
```

- [ ] **Step 2: Write the component**

```tsx
// components/kargah/Reveal.tsx
"use client";

import { useEffect, useRef } from "react";
import { staggerDelays } from "@/lib/design/stagger";

type RevealProps = {
  children: React.ReactNode;
  /** Change this to replay the entrance -- e.g. the active tab's name. */
  replayKey?: string | number;
  step?: number;
  className?: string;
};

export default function Reveal({ children, replayKey, step = 55, className }: RevealProps) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const items = Array.from(root.children) as HTMLElement[];
    if (!items.length) return;

    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delays = staggerDelays(items.length, step, 10, reduced);

    /* The reset must not itself be delayed. A zero-duration transition that carries a
       DELAY still holds the old value for the length of that delay -- so leaving the
       stagger on here postpones the reset past the moment we switch the entrance back
       on, and only the first item (delay 0) ever animates. Clear it, flush, restore. */
    for (const el of items) {
      el.classList.add("rev");
      el.classList.remove("rev-in");
      el.style.transition = "none";
      el.style.transitionDelay = "";
    }
    void document.body.offsetHeight; // force the start state to be computed

    items.forEach((el, i) => {
      el.style.transition = "";
      el.style.transitionDelay = `${delays[i]}ms`;
      el.classList.add("rev-in");
    });
  }, [replayKey, step]);

  return (
    <div ref={host} className={className}>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Verify in a browser**

Create `/tmp/reveal-check.mjs` and run it against a dev server (`npm run dev` on port 3001, so the production service on 3000 is untouched):

```js
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto("http://127.0.0.1:3001/sales", { waitUntil: "networkidle" });
const s = await p.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 120));
    out.push([...document.querySelectorAll(".rev")].map((e) => +(+getComputedStyle(e).opacity).toFixed(2)));
  }
  return out;
});
console.log(s);
await b.close();
```

Expected: the first sample shows a **descending** run of opacities (e.g. `[0.9, 0.7, 0.4, 0.1]`) — that descent is the stagger. If every value is `1`, the reset regressed; re-read the comment in Step 2.

- [ ] **Step 4: Commit**

```bash
git add components/kargah/Reveal.tsx app/globals.css
git commit -m "Add the entrance choreography, with the reset order that makes it replay"
```

---

## Task 8: TabPill and ThemeToggle

**Files:**
- Create: `components/kargah/TabPill.tsx`
- Modify: `components/ThemeToggle.tsx`
- Modify: `app/globals.css` (append `.seg` rules)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Tab = { href: string; label: string; ready: boolean }`
  - `<TabPill tabs={Tab[]} active={string} />`
  - `ThemeToggle` — writes `data-skin` on `<html>`, persists to `localStorage["kargah-skin"]`.

- [ ] **Step 1: Add the CSS**

```css
/* ---- Travelling tab pill ---------------------------------------------------- */
.seg { position: relative; display: flex; gap: 4px; background: var(--surface-sunk);
       border-radius: var(--radius-pill); padding: 5px; overflow-x: auto; scrollbar-width: none; }
.seg::-webkit-scrollbar { display: none; }
.seg .thumb { position: absolute; top: 5px; bottom: 5px; left: 0; width: 0;
              border-radius: var(--radius-pill); background: var(--surface);
              box-shadow: var(--sh-1); pointer-events: none; z-index: 0; }
.seg.seg-ready .thumb { transition: transform 520ms var(--spring-pop), width 520ms var(--spring-pop); }
.seg a, .seg span { position: relative; z-index: 1; flex: none; padding: 9px 18px;
                    border-radius: var(--radius-pill); font-size: var(--text-sm);
                    color: var(--text-muted); text-decoration: none; white-space: nowrap; }
.seg a[aria-current="page"] { color: var(--text); font-weight: 600; }
```

- [ ] **Step 2: Write TabPill**

```tsx
// components/kargah/TabPill.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";

export type Tab = { href: string; label: string; ready: boolean };

export default function TabPill({ tabs, active }: { tabs: Tab[]; active: string }) {
  const seg = useRef<HTMLElement | null>(null);

  const move = useCallback(() => {
    const root = seg.current;
    if (!root) return;
    const on = root.querySelector<HTMLElement>('[aria-current="page"]');
    const thumb = root.querySelector<HTMLElement>(".thumb");
    if (!on || !thumb) return;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  }, []);

  useEffect(() => {
    /* Place it BEFORE enabling the transition, or it flies in from x=0 on first paint. */
    move();
    const id = requestAnimationFrame(() => {
      move();
      seg.current?.classList.add("seg-ready");
    });
    const ro = new ResizeObserver(move);
    if (seg.current) ro.observe(seg.current);
    /* Persian glyph widths change when the webfont lands, which moves every tab. */
    document.fonts?.ready.then(move);
    return () => { cancelAnimationFrame(id); ro.disconnect(); };
  }, [move, active]);

  return (
    <nav className="seg" ref={seg as React.RefObject<HTMLElement>}>
      <span className="thumb" aria-hidden="true" />
      {tabs.map((t) =>
        t.ready ? (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.href === active ? "page" : undefined}
          >
            {t.label}
          </Link>
        ) : (
          <span key={t.href} aria-disabled className="text-[var(--text-faint)]">
            {t.label}
          </span>
        )
      )}
    </nav>
  );
}
```

- [ ] **Step 3: Rewrite ThemeToggle**

Read the existing file first; keep its export name and the place it is mounted. Replace its body with a `data-skin` toggle carrying inline sun/moon SVGs (MASTER.md bans emoji as icons):

```tsx
"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [skin, setSkin] = useState<"light" | "dark">("light");

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("kargah-skin"); } catch {}
    const initial =
      saved === "dark" || saved === "light"
        ? (saved as "light" | "dark")
        : matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setSkin(initial);
    document.documentElement.setAttribute("data-skin", initial);
  }, []);

  function flip() {
    const next = skin === "dark" ? "light" : "dark";
    setSkin(next);
    document.documentElement.setAttribute("data-skin", next);
    try { localStorage.setItem("kargah-skin", next); } catch {}
  }

  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={skin === "dark"}
      aria-label="تغییر پوستهٔ روشن و تاریک"
      className="themeToggle"
    >
      <svg className="sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4" />
      </svg>
      <svg className="moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7z" />
      </svg>
    </button>
  );
}
```

Add the matching CSS (sun visible in light, moon in dark, both stroked from `--text-muted`, 19px, rotating swap on `--spring-pop`).

- [ ] **Step 4: Verify in a browser**

With the dev server on 3001, load `/sales`, click the toggle, and assert:

```js
await p.click(".themeToggle");
console.log(await p.evaluate(() => ({
  skin: document.documentElement.getAttribute("data-skin"),
  bg: getComputedStyle(document.body).backgroundColor,
})));
```

Expected: `{ skin: "dark", bg: "rgb(20, 17, 16)" }`. Reload and confirm it stays dark (localStorage).

- [ ] **Step 5: Commit**

```bash
git add components/kargah/TabPill.tsx components/ThemeToggle.tsx app/globals.css
git commit -m "Add the travelling tab pill and the sun/moon skin toggle"
```

---

## Task 9: Sales shell

**Files:**
- Modify: `app/sales/layout.tsx`

**Interfaces:**
- Consumes: `TabPill` (Task 8), `ThemeToggle` (Task 8), `Reveal` (Task 7).
- Produces: the chrome every `/sales` page renders inside.

- [ ] **Step 1: Replace the header and nav**

Keep the existing session guard and the `tabs` array untouched — the redirect logic and the `ready` flags are authorisation and routing, not design. Replace only the markup below them: the brand mark, the title block, `ThemeToggle`, the map link, and `<TabPill tabs={tabs} active={...} />` in place of the hand-rolled `<Link>` row. Add `مسیر سفارش` to the tabs array pointing at `/sales/journey`, `ready: false` for now (Task 13 turns it on) — an unready tab renders as a `<span>` and is not prefetched, which is why the array carries the flag.

Container: `mx-auto min-h-screen w-full max-w-[1240px] px-[var(--space-4)] py-[var(--space-5)]`.

- [ ] **Step 2: Verify**

Run: `npm run dev -- -p 3001`, load `/sales`, confirm the pill sits under the active tab and moves when you click another.

- [ ] **Step 3: Commit**

```bash
git add app/sales/layout.tsx
git commit -m "Re-skin the sales shell around the tab pill"
```

---

## Task 10: GradientStat, PocketCard, CarvedCard

**Files:**
- Create: `components/kargah/GradientStat.tsx`
- Create: `components/kargah/PocketCard.tsx`
- Create: `components/kargah/CarvedCard.tsx`
- Modify: `app/globals.css`
- Modify: `components/sales/OrderPocketCard.tsx` (re-export from PocketCard, or delete once no page imports it)

**Interfaces:**
- Consumes: `carvedCardPath` (Task 5).
- Produces:
  - `<GradientStat tone="peach"|"mint"|"sand" label={string} value={ReactNode} note?={ReactNode} icon?={ReactNode} />`
  - `<PocketCard href={string} customer={string} meta={string} amount={string} status={{label:string; tone:"good"|"warn"|"neutral"}} docs={{label:string; value:string; bars:number[]; tone:string}[]} />`
  - `<CarvedCard shoulder={ReactNode} avatars={ReactNode}>{children}</CarvedCard>`

- [ ] **Step 1: Write the CSS**

Port the `.gcard`, `.pocket` / `.docs` / `.doc` / `.face`, and `.cradle*` rule sets from the prototype, substituting tokens for every literal. Non-negotiables, each already paid for once:
- `.pockets` needs `padding-top: 22px` — rotation and scale push a fanned document ~12px above its pocket box, and the section clips.
- documents translate **down** at rest and to `translateY(0)` on hover, never negative.
- `.pocket:hover { z-index: 5 }` and `.pocket:hover .docs { z-index: 3 }` — the fan overhangs by design.
- `.cradlecard { filter: var(--card-drop) }` and **no** `box-shadow`.

- [ ] **Step 2: Write CarvedCard**

```tsx
"use client";

import { useCallback, useEffect, useRef } from "react";
import { carvedCardPath } from "@/lib/design/carve";

export default function CarvedCard({
  shoulder, avatars, children,
}: { shoulder?: React.ReactNode; avatars: React.ReactNode; children: React.ReactNode }) {
  const card = useRef<HTMLDivElement | null>(null);

  const carve = useCallback(() => {
    const el = card.current;
    if (!el) return;
    const d = carvedCardPath(el.offsetWidth, el.offsetHeight);
    el.style.clipPath = d ? `path("${d}")` : "";
    el.classList.toggle("carved", Boolean(d));
  }, []);

  useEffect(() => {
    carve();
    const ro = new ResizeObserver(carve);
    if (card.current) ro.observe(card.current);
    document.fonts?.ready.then(carve);
    return () => ro.disconnect();
  }, [carve]);

  return (
    <div className="cradlewrap">
      {/* The avatars MUST be a sibling: clip-path clips descendants, so avatars placed
          inside the card are erased by the bay that exists to hold them. */}
      <div className="cradle">{avatars}</div>
      <div className="cradlecard" ref={card}>
        {shoulder ? <div className="shoulder">{shoulder}</div> : null}
        <div className="cradlebody">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write GradientStat and PocketCard**

Both are server components (no interactivity beyond CSS hover). Port markup from the prototype; every colour from a token.

- [ ] **Step 4: Verify in a browser**

Load `/sales/dashboard`, hover a pocket card, and assert both documents clear the face and neither is clipped:

```js
const r = await p.evaluate(() => {
  const pk = document.querySelector(".pocket");
  const blk = pk.closest(".block").getBoundingClientRect();
  const docs = [...pk.querySelectorAll(".doc")].map((d) => d.getBoundingClientRect());
  return { clipped: docs.some((d) => d.top < blk.top),
           overlap: Math.max(0, Math.min(docs[0].right, docs[1].right) - Math.max(docs[0].left, docs[1].left)) };
});
```

Expected: `clipped: false`, `overlap` under ~25px.

- [ ] **Step 5: Commit**

```bash
git add components/kargah/ app/globals.css
git commit -m "Add the gradient stat, document pocket and carved bay cards"
```

---

## Task 11: SplineChart

**Files:**
- Create: `components/charts/SplineChart.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `splinePath`, `areaPath` (Task 6); `ChartFrame` (existing).
- Produces: `<SplineChart series={{label:string; values:number[]}[]} labels={string[]} max?={number} />`

- [ ] **Step 1: Write the component**

Wrap in the existing `ChartFrame` so the legend and the `<details>` data table come for free — MASTER.md requires both and `ChartFrame` is where they live. In RTL the oldest point is on the **right**, so `x(i) = W - PAD - i * step`. Points get `r: 0px` → `r: 4.6px` transitions with per-point delays.

- [ ] **Step 2: Verify the entrance replays**

Assert the dots' computed `r` values are **partially** filled mid-flight, which is what proves they land one at a time:

```js
// ~700ms after entering the tab
[...document.querySelectorAll(".dot-p")].map((d) => parseFloat(getComputedStyle(d).r))
// expect something like [4.6, 4.2, 2.3, 0, 0, 0, 0] — a descending ramp, not all-equal
```

- [ ] **Step 3: Commit**

```bash
git add components/charts/SplineChart.tsx app/globals.css
git commit -m "Add the spline chart with a landing-points entrance"
```

---

## Task 12: OrderPipeline and ProcessingModal

**Files:**
- Create: `components/sales/OrderPipeline.tsx`
- Create: `components/sales/ProcessingModal.tsx`
- Modify: `app/globals.css`
- Reference: `components/sales/AssignmentBoard.tsx` (same endpoint, `POST /api/sales/runs/[id]/stops`) — read it before writing; do **not** add a new endpoint or a new authorisation surface.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `<OrderPipeline stages={{key:string; label:string; tone:string}[]} orders={PipelineOrder[]} onMove={(id, stage) => void} />`
  - `<ProcessingModal order={PipelineOrder | null} people={Person[]} onClose={() => void} onConfirm={(p: {assignee: string; collected: number}) => void} />`

- [ ] **Step 1: Write the drag layer**

Pointer events only. The three rules, each of which cost a debugging cycle in the prototype:
1. `card.setPointerCapture(e.pointerId)` — **on the card**. Capturing on the board retargets the whole gesture, click included, so a tap can never say which card it hit.
2. **No `preventDefault()` in `pointerdown`** — it suppresses the compatibility mouse events and the click never fires. Guard selection with `user-select: none` on `.board` and `touch-action: none` on `.task`.
3. A finished drag sets `suppressClick = true` for ~60ms so the drop does not also open the modal.

- [ ] **Step 2: Write the modal**

Centred with physical `left: 50%` + `translate(-50%, -50%)`. The amount slider takes `direction: rtl` so it fills from the right, and its filled track is painted as `linear-gradient(to left, var(--accent) 0 X%, var(--surface-sunk) X% 100%)` — a range input offers no pseudo-element for it.

- [ ] **Step 3: Verify in a browser**

Drag a card from column 0 to column 1 and assert the counts moved, the island announced it, and the modal did **not** open:

```js
// before: [1,2,2,2]  after: [0,3,2,2]
// document.getElementById("proc").classList.contains("on") === false
```

Then tap a card and assert the modal opens with that card's customer and total.

- [ ] **Step 4: Commit**

```bash
git add components/sales/OrderPipeline.tsx components/sales/ProcessingModal.tsx app/globals.css
git commit -m "Add the order pipeline and its processing modal"
```

---

## Task 13: OrderJourney and the remaining pages

**Files:**
- Create: `components/sales/OrderJourney.tsx`
- Create: `app/sales/journey/page.tsx`
- Modify: `app/sales/page.tsx`, `dashboard/page.tsx`, `orders/page.tsx`, `orders/[id]/page.tsx`, `orders/new/page.tsx`, `products/page.tsx`, `runs/page.tsx`, `stock/page.tsx`, `commission/page.tsx`
- Modify: `app/sales/layout.tsx` (flip the journey tab's `ready` to `true`)

**Interfaces:**
- Consumes: every component from Tasks 7–12.
- Produces: no new exports.

- [ ] **Step 1: Convert the pages, one commit each**

For each page: replace `var(--surface)`/`var(--border)` card chrome with the new `.block` treatment, wrap the top-level card group in `<Reveal>`, and swap any `--accent`-as-text for `--accent-text`. `app/sales/page.tsx` still claims the section is unbuilt — rewrite that copy; the sales system shipped in `81c158d`.

- [ ] **Step 2: Grep for retired tokens**

Run: `grep -rn 'accent-dim\|surface-raised\|--facility\|text-faint' app/sales components/sales components/kargah`
Expected: no hits for `--accent-dim` or `--surface-raised` (both retired), and every `--text-faint` hit is on a non-text element. Fix any that are not.

- [ ] **Step 3: Run the suite and the checker**

Run: `npm test && npm run check:contrast && npm run lint`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add app/sales components/sales
git commit -m "Convert every sales page to the کارگاه system"
```

---

## Task 14: Build, deploy, verify

**Files:** none.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: succeeds. This app has previously needed `scripts/build-with-swap.sh` on a memory-tight box — use it if the plain build is OOM-killed.

- [ ] **Step 2: Restart the service**

```bash
sudo systemctl restart coverage-map
systemctl is-active coverage-map
```

Expected: `active`.

- [ ] **Step 3: Verify the deployed pages**

Load every `/sales/*` route in a browser at desktop and phone width, in both skins. Assert per page: no horizontal overflow (`scrollWidth - clientWidth === 0`), no console errors, and the entrance plays.

- [ ] **Step 4: Final commit and push**

```bash
git add -A
git commit -m "Deploy the کارگاه redesign of /sales"
git push -u origin redesign/kargah
```

---

## Self-Review

**Spec coverage.** Visual thesis → Tasks 2, 9–13. Colour → Tasks 1–2. Elevation → Task 2. Typography → Task 3. Radii → Task 2. Motion Tier 0 → Tasks 4, 7, 11. Document pocket → Task 10. Carved bay → Tasks 5, 10. Travelling pill → Task 8. Pipeline → Task 12. Processing modal → Task 12. Journey → Task 13. Gradient stat → Task 10. Spline chart → Tasks 6, 11. Island / bento strip → re-skinned by the token layer in Task 2, no component change. Anti-patterns → guarded by Task 1's checker and Task 13's grep.

**Gaps accepted deliberately.** `/leads`, `/analytics`, `/report` and the map keep the
original `:root` palette. Scoping the new tokens to `.kargah` (Task 2) is what makes that
true rather than merely hoped for. The consequence is that the app carries two design
systems at once until those surfaces get their own pass — deliberate, and the reason
`.kargah` is a class rather than a rewrite.

**Types.** `Tab` (Task 8) is consumed by Task 9. `PipelineOrder` and `Person` are defined in Task 12 and used only there and in Task 13. `Pt` (Task 6) is consumed by Task 11. `CarveOpts` (Task 5) by Task 10.
