import { describe, expect, test } from "vitest";
import { niceTicks, linearScale, donutArcs, linePath, barLayout } from "@/lib/chartScale";

describe("niceTicks", () => {
  test("covers the range with round numbers", () => {
    expect(niceTicks(0, 100)).toEqual([0, 25, 50, 75, 100]);
  });

  test("always spans at least the data", () => {
    for (const [min, max] of [
      [0, 7],
      [0, 1234567],
      [-50, 50],
      [3, 4],
    ]) {
      const ticks = niceTicks(min, max);
      expect(ticks[0]).toBeLessThanOrEqual(min);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
    }
  });

  test("is ascending with no duplicates", () => {
    const ticks = niceTicks(0, 1234567);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  });

  test("survives a flat series, which is what an empty month looks like", () => {
    expect(niceTicks(0, 0)).toEqual([0, 1]);
    expect(niceTicks(5, 5).length).toBeGreaterThan(1);
  });
});

describe("linearScale", () => {
  test("maps the domain onto the range", () => {
    const s = linearScale(0, 100, 0, 200);
    expect(s(0)).toBe(0);
    expect(s(50)).toBe(100);
    expect(s(100)).toBe(200);
  });

  test("inverts when the range does, which is how SVG y-axes point up", () => {
    const s = linearScale(0, 100, 200, 0);
    expect(s(0)).toBe(200);
    expect(s(100)).toBe(0);
  });

  test("does not divide by zero on a flat domain", () => {
    const s = linearScale(5, 5, 0, 200);
    expect(Number.isFinite(s(5))).toBe(true);
  });
});

describe("donutArcs", () => {
  test("gives one arc per non-zero value", () => {
    const arcs = donutArcs([3, 1], 50, 12);
    expect(arcs).toHaveLength(2);
  });

  test("fractions sum to one", () => {
    const arcs = donutArcs([3, 1, 4], 50, 12);
    const total = arcs.reduce((a, x) => a + x.fraction, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  test("drops zero slices rather than drawing an invisible path", () => {
    expect(donutArcs([5, 0, 5], 50, 12)).toHaveLength(2);
  });

  test("draws a whole ring for a single value", () => {
    // A 360-degree SVG arc is degenerate -- start and end points coincide, and the
    // renderer draws nothing at all. One category is a completely normal case here
    // (one product, one group), so it cannot silently vanish.
    const arcs = donutArcs([7], 50, 12);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].fraction).toBe(1);
    expect(arcs[0].d.length).toBeGreaterThan(0);
    expect(arcs[0].d).toMatch(/A/);
  });

  test("is empty when everything is zero, rather than NaN", () => {
    expect(donutArcs([0, 0], 50, 12)).toEqual([]);
    expect(donutArcs([], 50, 12)).toEqual([]);
  });
});

describe("linePath", () => {
  test("starts with a move and then draws", () => {
    const d = linePath([1, 2, 3], 100, 50);
    expect(d.startsWith("M")).toBe(true);
    expect(d).toContain("L");
  });

  test("is empty for no points", () => {
    expect(linePath([], 100, 50)).toBe("");
  });

  test("draws a single point as a dot rather than an empty path", () => {
    const d = linePath([5], 100, 50);
    expect(d.startsWith("M")).toBe(true);
  });

  test("contains no NaN when every value is the same", () => {
    expect(linePath([4, 4, 4], 100, 50)).not.toContain("NaN");
  });
});

describe("barLayout", () => {
  test("returns one bar per value", () => {
    expect(barLayout([1, 2, 3], 120, 60)).toHaveLength(3);
  });

  test("puts the first bar on the right, because the page is RTL", () => {
    const bars = barLayout([1, 2, 3], 120, 60);
    expect(bars[0].x).toBeGreaterThan(bars[2].x);
  });

  test("scales height to the largest value", () => {
    const bars = barLayout([1, 2, 4], 120, 60);
    expect(bars[2].height).toBeCloseTo(60, 5);
    expect(bars[0].height).toBeCloseTo(15, 5);
  });

  test("gives a zero value no height but keeps its slot", () => {
    const bars = barLayout([0, 4], 120, 60);
    expect(bars).toHaveLength(2);
    expect(bars[0].height).toBe(0);
  });

  test("does not produce NaN when every value is zero", () => {
    const bars = barLayout([0, 0], 120, 60);
    for (const b of bars) {
      expect(Number.isFinite(b.height)).toBe(true);
      expect(Number.isFinite(b.x)).toBe(true);
    }
  });
});
