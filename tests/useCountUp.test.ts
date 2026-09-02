import { describe, expect, it } from "vitest";
import { easeOutCubic, countUpValue } from "@/lib/useCountUp";

describe("easeOutCubic", () => {
  it("pins the ends and clamps out-of-range input", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-0.5)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("is front-loaded — past halfway by the time a third of the run is done", () => {
    expect(easeOutCubic(1 / 3)).toBeGreaterThan(0.5);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
  });
});

describe("countUpValue", () => {
  it("starts at `from` and ends exactly on `target`", () => {
    expect(countUpValue(0, 100, 0, 600)).toBe(0);
    expect(countUpValue(0, 100, 600, 600)).toBe(100);
    expect(countUpValue(0, 100, 999, 600)).toBe(100);
  });

  it("returns target immediately for a non-positive duration", () => {
    expect(countUpValue(0, 100, 0, 0)).toBe(100);
    expect(countUpValue(0, 100, 0, -10)).toBe(100);
  });

  it("is monotonic non-decreasing across the run", () => {
    let prev = -Infinity;
    for (let e = 0; e <= 600; e += 30) {
      const v = countUpValue(0, 100, e, 600);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("stays within the interval and counts down too", () => {
    for (let e = 0; e <= 600; e += 50) {
      const up = countUpValue(20, 80, e, 600);
      expect(up).toBeGreaterThanOrEqual(20);
      expect(up).toBeLessThanOrEqual(80);
      const down = countUpValue(80, 20, e, 600);
      expect(down).toBeLessThanOrEqual(80);
      expect(down).toBeGreaterThanOrEqual(20);
    }
  });
});
