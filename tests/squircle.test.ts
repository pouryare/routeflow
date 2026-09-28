import { describe, expect, it } from "vitest";
import {
  SQUIRCLE_SELECTORS,
  SUPERELLIPSE_N,
  supportsCornerShape,
  isPillRadius,
  parseCornerRadius,
  superellipsePath,
  cornerAreaRatio,
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
    // Anything at or past half the shorter side IS a pill, so 101 is too.
    expect(isPillRadius(101, 200, 200)).toBe(true);
    // Just under the threshold is a real corner and must be squirled.
    expect(isPillRadius(99, 200, 200)).toBe(false);
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

describe("superellipsePath", () => {
  it("emits a closed path with four corners", () => {
    const d = superellipsePath(400, 300, 26);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
    expect((d.match(/C /g) ?? []).length).toBe(4);
  });

  it("returns an empty string for a degenerate box, rather than a broken path", () => {
    expect(superellipsePath(0, 0, 0)).toBe("");
    expect(superellipsePath(100, 100, 0)).toBe("");
  });

  it("stays inside the box -- a control point outside means a self-intersecting path", () => {
    const d = superellipsePath(400, 300, 26);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (const n of nums) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(400);
    }
  });
});

describe("cornerAreaRatio", () => {
  it("is 1.000 for a true circle, proving the area maths is right", () => {
    // 0.5522847498 is the exact cubic-bezier control factor for a quarter circle, so its
    // area ratio must be ~1. This is the self-check the fitted constant rests on.
    expect(cornerAreaRatio(0.5522847498, 100)).toBeCloseTo(1, 2);
  });

  it("holds the fitted squircle at 1.18x a circle, matching superellipse(1.5)", () => {
    // Measured in Chromium 151: superellipse(1.5) => 1.1094x. The calibration test
    // asserts against a real browser that this stays true.
    expect(cornerAreaRatio(0.765437, 100)).toBeCloseTo(1.1094, 2);
  });

  it("is scale-invariant, so one constant serves the whole radius scale", () => {
    for (const r of [6, 10, 16, 26, 40]) {
      expect(cornerAreaRatio(0.765437, r)).toBeCloseTo(1.1094, 2);
    }
  });
});
