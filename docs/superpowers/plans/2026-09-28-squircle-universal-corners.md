# Squircle Corners, Everywhere — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user the same squircle corners, on every browser, and fix the fact that the corners currently shipped to Chromium are concave.

**Architecture:** One exported selector list in `lib/squircle.ts` is the single source of truth. CSS consumes it via a generated rule; the JS fallback consumes the same list and writes a `clip-path` on the ~29% of browsers without `corner-shape`. Chromium keeps the native path and pays zero JS.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, Tailwind v4 (CSS-first `@theme`), vitest 4 (node environment), Playwright + sharp (already devDependencies) for geometry calibration.

**Spec:** `docs/superpowers/specs/2026-09-28-squircle-universal-corners-design.md`

---

## Critical deviation from the spec — read before Task 1

The spec (locked decision 5) says the surface list becomes a `data-squircle` **attribute**. Research
during planning found that this is the wrong call in this codebase:

- The `card` class alone is used in **94 files** (199 occurrences). `sheet` 38, `kblock` 22.
- `pagehead` has **0** usages.
- Converting to an attribute means editing 94+ files for a purely presentational change.

The attribute also breaks the "one list, two consumers" goal rather than serving it: a class list in
CSS and an attribute list in TSX are *two* lists, and nothing keeps them in sync.

**This plan instead keeps the class selectors as the single source of truth** and exports them from
`lib/squircle.ts`. The CSS `@supports` block and the JS fallback both read that one list. Nothing in
`app/globals.css` or any `.tsx` needs to change to make a surface a squircle — it is already a
class. The diff is additive and confined to new files plus one edited CSS block.

**What is preserved from the spec:** the intent behind decision 5 (one declaration, read by both the
CSS engine and the JS) is fully honoured. The mechanism changes; the goal does not.

**What is deferred:** the attribute remains available as an *opt-in escape hatch* for any surface that
must squircle without carrying a listed class (Task 6), so nothing is lost.

### Environment facts (verified, not assumed)

| Fact | Value | How verified |
|---|---|---|
| `corner-shape` at `1.5` | 1.110× a true circle's corner area | rendered in Chromium 151, area integrated, sanity-checked to 100.0% vs the exact quarter-circle |
| Chromium available | 151.0.7922.34 | `playwright.chromium.launch()` in this repo |
| `sharp` | 0.35.x, installed | `require("sharp")` resolves |
| vitest env | `node` — **no DOM** | `vitest.config.mts` |
| smoke suite | separate config, browser + dev server | `vitest.smoke.mts` |
| `.meridian` wrapper | single class, `app/(shell)/layout.tsx:26` | read |
| box-shadow count in globals.css | 132 | `grep -c` |
| `card-drop` token | exists at 1648 (light) / 1776 (dark) | read |

Because the unit suite has **no DOM**, `lib/squircle.ts` is written DOM-free and testable in `node`.
Only the React component touches the DOM, and it is covered by the smoke suite.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `lib/squircle.ts` | **(new)** selector list (single source of truth), feature detect, pure path geometry, radius parsing | 1-4 |
| `lib/squircle.test.ts` | **(new)** unit tests for the pure surface | 2, 4 |
| `tests/smoke/squircle.test.ts` | **(new)** browser calibration + component behaviour | 5, 7 |
| `components/meridian/SquircleFallback.tsx` | **(new)** the only client component: observe, measure, write `--sq-clip` | 6 |
| `components/meridian/AppShell.tsx` | **(modify)** mount the fallback once | 6 |
| `app/globals.css` | **(modify)** `0.6` → `1.5`; generated selector rule; `--sq-clip` consume rule | 3, 6 |
| `MASTER.md` | **(modify)** the "Radii" superellipse paragraph is now factually wrong | 8 |

`lib/squircle.ts` is deliberately split from the component: geometry that can be unit-tested in
`node` without a DOM is worth more than geometry entangled with `ResizeObserver`.

---


### Task 1: The selector list and feature detect

**Files:**
- Create: `lib/squircle.ts`

- [ ] **Step 1: Create the file with the selector list and feature detect**

```ts
/** Squircle corners: one shape for every user, on every browser.
 *
 *  CSS `corner-shape: superellipse()` shipped in Chrome 139 but is still unlanded in
 *  Firefox and only in Safari's Technology Preview, so roughly 29% of users never see
 *  it. The fallback is a clip-path, which costs box-shadow and clips descendants -- so
 *  the list below is deliberately the *only* place a surface becomes a squircle, and it
 *  is consumed by both the CSS rule and the JS fallback so the two cannot drift.
 *
 *  Every selector is prefixed `.meridian` because that is a single wrapper class in
 *  app/(shell)/layout.tsx:26. The prefix costs nothing and keeps a stray `card` in
 *  another skin out of the clip.
 *
 *  `pagehead` has no usage today. It stays because PageHeaderCard is clearly waiting for
 *  it; dropping it would make adding that surface a second, disconnected edit.
 */

/** Every surface that gets a squircle. One list, two consumers. */
export const SQUIRCLE_SELECTORS = [
  ".meridian .kblock",
  ".meridian .card",
  ".meridian .gcard",
  ".meridian .face",
  ".meridian .pocketed__face",
  ".meridian .modal",
  ".meridian .sheet",
  ".meridian .island",
  ".meridian .mwork",
  ".meridian .mapside",
  ".meridian .prow",
  ".meridian .ptile",
  ".meridian .pagehead",
  ".meridian .seg-item > a",
] as const;

/** The exponent every surface squircle is drawn at.
 *
 *  Measured by rendering corners in Chromium 151 and integrating the corner's area: this
 *  exponent yields a corner 1.110x the area of a true circle, which reads as a deliberate
 *  squircle rather than a lozenge. Named here because the CSS and the JS fallback must
 *  agree, and a magic number duplicated in two files is a magic number that drifts. */
export const SUPERELLIPSE_N = 1.5;

/** The value the native path uses. Kept beside the exponent so the @supports probe in
 *  CSS and the probe in JS are testing for the same feature, not merely a similar one. */
export const CORNER_SHAPE_VALUE = `superellipse(${SUPERELLIPSE_N})`;

/** True where the browser draws the corner itself and we do no work at all.
 *
 *  Guarded on `typeof CSS` because the unit suite runs in node, where CSS is undefined --
 *  asking a bare `CSS.supports` there is a ReferenceError, not a false. */
export function supportsCornerShape(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("corner-shape", CORNER_SHAPE_VALUE)
  );
}
```

- [ ] **Step 2: Verify the file typechecks**

Run: `npx tsc --noEmit`

### Task 2: The pill rule — deciding what is NOT a squircle

**Files:**
- Modify: `lib/squircle.ts` (append)
- Create: `lib/squircle.test.ts`

The existing comment at `app/globals.css:4750` already argues this: at 999px the corner is a full
semicircle and a squircle is invisible. But "999px" is not the real test — a radius of half the
shorter side is the same shape wearing a different number, and `border-radius: 50%` exists. Decide
it once, here, and test it.

- [ ] **Step 1: Write the failing test**

Create `lib/squircle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SQUIRCLE_SELECTORS,
  SUPERELLIPSE_N,
  supportsCornerShape,
  isPillRadius,
  parseCornerRadius,
} from "@/lib/squircle";

describe("the squircle surface list", () => {
  it("is non-empty and every entry is meridian-scoped", () => {
    expect(SQUIRCLE_SELECTORS.length).toBeGreaterThan(0);
    for (const sel of SQUIRCLE_SELECTORS) {
      expect(sel.startsWith(".meridian ")).toBe(true);
    }
  });

  it("holds no duplicates -- a repeat silently doubles the work", () => {
    expect(new Set(SQUIRCLE_SELECTORS).size).toBe(SQUIRCLE_SELECTORS.length);
  });
});

describe("SUPERELLIPSE_N", () => {
  it("is the measured 1.5, not the 0.6 that shipped", () => {
    // 0.6 measured 0.878x a true circle's corner area -- concave, a scoop, not a squircle.
    expect(SUPERELLIPSE_N).toBe(1.5);
    expect(SUPERELLIPSE_N).toBeGreaterThan(1);
  });
});

describe("supportsCornerShape", () => {
  it("returns false rather than throwing where CSS is undefined", () => {
    // The unit suite is node; this is the whole reason the typeof guard exists.
    expect(typeof CSS).toBe("undefined");
    expect(supportsCornerShape()).toBe(false);
  });
});

describe("isPillRadius", () => {
  it("calls 999px a pill, because a squircle there is invisible", () => {
    expect(isPillRadius(999, 300, 200)).toBe(true);
  });

  it("calls a radius at half the shorter side a pill -- same shape, other number", () => {
    expect(isPillRadius(100, 200, 200)).toBe(true); // 100 === 200/2
    expect(isPillRadius(101, 200, 200)).toBe(false);
  });

  it("calls 50% of the element a pill, via the percentage branch", () => {
    expect(isPillRadius("50%", 200, 200)).toBe(true);
  });

  it("keeps a normal card radius", () => {
    expect(isPillRadius(26, 400, 300)).toBe(false);
    expect(isPillRadius("26px", 400, 300)).toBe(false);
  });

  it("never treats an unreadable or zero radius as a pill", () => {
    // A zero radius is a square corner: it needs the full path, and calling it a pill
    // would leave it on a live arc beside clipped neighbours.
    expect(isPillRadius(0, 400, 300)).toBe(false);
    expect(isPillRadius("none", 400, 300)).toBe(false);
    expect(isPillRadius(null, 400, 300)).toBe(false);
  });
});

describe("parseCornerRadius", () => {
  it("reads a single px value", () => {
    expect(parseCornerRadius("26px")).toBe(26);
  });

  it("reads the shorthand form border-radius can return", () => {
    expect(parseCornerRadius("10px 10px")).toBe(10);
    expect(parseCornerRadius("10px 10px 10px 10px")).toBe(10);
  });

  it("returns null for anything it cannot read, rather than guessing zero", () => {
    expect(parseCornerRadius("auto")).toBeNull();
    expect(parseCornerRadius("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/squircle.test.ts`
Expected: FAIL — `isPillRadius` and `parseCornerRadius` are not exported.

- [ ] **Step 3: Add the two functions**

Append to `lib/squircle.ts`:

```ts
/** A corner radius as CSS hands it back: a length, a percentage, or unreadable. */
export type CornerRadius = number | string | null;

/** The 999px convention, named so the number is not retyped as a literal. */
export const PILL_RADIUS_PX = 999;

/** True when the radius makes the shape a pill -- 999px, `50%`, or half the shorter side.
 *
 *  A pill is the one shape where a squircle is not a refinement but an impossibility: at
 *  a full semicircle the superellipse and the circular arc are the same curve, so
 *  clipping one buys nothing and costs the box-shadow. Pills keep plain radii.
 *
 *  Zero is explicitly NOT a pill. A zero radius is a square corner that still needs the
 *  full path, and dropping it would leave it on an arc beside clipped neighbours. */
export function isPillRadius(
  radius: CornerRadius,
  width: number,
  height: number,
): boolean {
  if (radius === null || radius === "none" || radius === "") return false;

  if (typeof radius === "string" && radius.trim().endsWith("%")) {
    const pct = Number.parseFloat(radius);
    if (!Number.isFinite(pct)) return false;
    return pct >= 50;
  }

  const px = typeof radius === "number" ? radius : Number.parseFloat(radius);
  if (!Number.isFinite(px) || px <= 0) return false;

  if (px >= PILL_RADIUS_PX) return true; // the 999px convention
  return px >= Math.min(width, height) / 2;
}

/** Pull a single usable pixel radius out of whatever getComputedStyle returned.
 *
 *  Returns null rather than 0 when the value cannot be read, so the caller can leave the
 *  element alone; a 0 would silently produce a square-cornered clip. */
export function parseCornerRadius(raw: string): number | null {
  if (!raw) return null;
  const first = raw.trim().split(/\s+/)[0];
  const px = Number.parseFloat(first);
  return Number.isFinite(px) ? px : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/squircle.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/squircle.ts lib/squircle.test.ts
git commit -m "feat(squircle): the pill rule, so pills keep plain circles on every browser"
```

---

Expected: PASS, no output.

If unrelated errors appear, confirm they pre-exist with `git stash` before continuing.

- [ ] **Step 3: Commit**

```bash
git add lib/squircle.ts
git commit -m "feat(squircle): the selector list both the CSS and the fallback will read"
```

---
