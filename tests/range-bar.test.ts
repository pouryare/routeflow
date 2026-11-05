// Covers the model behind components/mobile/RangeBar (and the orders amount filter that uses it).
import { describe, it, expect } from "vitest";
import { niceStep, parseRange, inRange, boundsOf, histogram, countIn } from "@/lib/rangeBar";

describe("range bar model", () => {
  it("steps are 1, 2 or 5 times a power of ten", () => {
    expect(niceStep(60)).toBe(1);
    expect(niceStep(6000)).toBe(100);
    expect(niceStep(30_000_000)).toBe(500_000);
    expect(niceStep(0)).toBe(1);
  });
  it("reads a range from the address and keeps it inside the bounds", () => {
    const b = { min: 0, max: 1000 };
    expect(parseRange(undefined, undefined, b)).toBeNull();
    expect(parseRange("100", "400", b)).toEqual([100, 400]);
    expect(parseRange("100", undefined, b)).toEqual([100, 1000]);
    expect(parseRange("-5", "x", b)).toBeNull();
    expect(parseRange("900", "5000", b)).toEqual([900, 1000]);
    expect(parseRange("700", "300", b)).toEqual([300, 700]);
  });
  it("no range lets everything through; a range is inclusive", () => {
    expect(inRange(5, null)).toBe(true);
    expect(inRange(100, [100, 200])).toBe(true);
    expect(inRange(201, [100, 200])).toBe(false);
  });
  it("bounds round outward and are absent when there is nothing to choose between", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([5, 5])).toBeNull();
    const b = boundsOf([1_230_000, 48_700_000])!;
    expect(b.min).toBeLessThanOrEqual(1_230_000);
    expect(b.max).toBeGreaterThanOrEqual(48_700_000);
  });
  it("counts amounts per slice for the bars, and inside a range for the live count", () => {
    const b = { min: 0, max: 100 };
    expect(histogram([0, 10, 49, 50, 100, 200], b, 4)).toEqual([2, 1, 1, 1]);
    expect(histogram([1, 2], { min: 5, max: 5 }, 3)).toEqual([0, 0, 0]);
    expect(countIn([5, 10, 20, 30], [10, 20])).toBe(2);
  });
});
// also AmountSlider (components/mobile/AmountSlider): its value is the discount percent, 0 to 30.
