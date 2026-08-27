import { describe, expect, test } from "vitest";
import {
  niceTicks,
  linearScale,
  donutArcs,
  linePath,
  barLayout,
  smoothLinePath,
  movingAverage,
} from "@/lib/chartScale";

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

describe("smoothLinePath", () => {
  /** Samples every cubic segment of a path and returns the extreme y values it reaches.
   *  The control points alone do not answer this -- a bezier stays inside its hull, so a
   *  control point above the data does not prove the curve goes there, and one below does
   *  not prove it does not. So the curve is actually evaluated. */
  function curveExtent(d: string) {
    const nums = (s: string) => s.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const [, y0] = nums(d.slice(0, d.indexOf("C")));
    let cur = y0;
    let lo = y0;
    let hi = y0;
    for (const seg of d.split("C").slice(1)) {
      const [, c1y, , c2y, , py] = nums(seg);
      for (let t = 0; t <= 1; t += 0.02) {
        const u = 1 - t;
        const y =
          u * u * u * cur + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * py;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      cur = py;
    }
    return { lo, hi };
  }

  test("never draws above the highest reading or below the lowest", () => {
    // The case a Catmull-Rom spline gets wrong: a steep rise into a plateau makes a plain
    // cubic bulge past the plateau, so the chart shows a peak that is not in the data.
    const values = [10, 90, 90, 20, 5, 60];
    const d = smoothLinePath(values, 300, 100);
    const { lo, hi } = curveExtent(d);

    // y is inverted in SVG: the largest value maps to the smallest y.
    const yOf = linearScale(Math.min(...values, 0), Math.max(...values), 100, 0);
    const yAtMax = yOf(Math.max(...values));
    const yAtMin = yOf(Math.min(...values, 0));

    expect(hi).toBeLessThanOrEqual(yAtMin + 0.5);
    expect(lo).toBeGreaterThanOrEqual(yAtMax - 0.5);
  });

  test("falls back to straight segments below three points", () => {
    // Two points have no interior tangent to constrain, and a curve through them would be
    // a straight line drawn expensively.
    expect(smoothLinePath([5, 9], 100, 50)).toBe(linePath([5, 9], 100, 50));
  });

  test("holds a flat run flat", () => {
    const d = smoothLinePath([40, 40, 40, 40], 200, 80);
    const { lo, hi } = curveExtent(d);
    expect(hi - lo).toBeLessThan(0.5);
  });
});

describe("movingAverage", () => {
  test("averages each reading with the ones BEFORE it in time", () => {
    // newest first: index 0 is today, index 3 is three days ago
    expect(movingAverage([10, 20, 30, 40], 2)).toEqual([15, 25, 35, 40]);
  });

  test("shortens the window at the old end instead of dropping points", () => {
    const out = movingAverage([9, 3, 6], 3);
    expect(out).toHaveLength(3);
    expect(out[2]).toBe(6);
  });

  test("a window of one is the series itself", () => {
    expect(movingAverage([4, 8, 1], 1)).toEqual([4, 8, 1]);
  });

  test("lags rather than leads: a spike today does not move the oldest reading", () => {
    const flat = movingAverage([0, 0, 0, 0], 3);
    const spike = movingAverage([120, 0, 0, 0], 3);
    expect(spike[0]).toBeGreaterThan(flat[0]);
    expect(spike[3]).toBe(flat[3]);
  });
});
