import { describe, expect, it } from "vitest";
import { magnifyScale } from "@/lib/design/dockMagnify";

describe("magnifyScale", () => {
  it("scales to the peak at zero distance", () => {
    expect(magnifyScale(0, { peak: 1.4, radius: 80 })).toBeCloseTo(1.4);
  });

  it("scales to 1 at or beyond the radius", () => {
    expect(magnifyScale(80, { peak: 1.4, radius: 80 })).toBeCloseTo(1);
    expect(magnifyScale(200, { peak: 1.4, radius: 80 })).toBe(1);
  });

  it("falls off monotonically between 0 and the radius", () => {
    const near = magnifyScale(20, { peak: 1.4, radius: 80 });
    const far = magnifyScale(60, { peak: 1.4, radius: 80 });
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(1);
  });

  it("defaults to a sane peak and radius", () => {
    expect(magnifyScale(0)).toBeGreaterThan(1);
    expect(magnifyScale(1000)).toBe(1);
  });

  it("never returns less than 1 for a negative distance (clamped)", () => {
    expect(magnifyScale(-10, { peak: 1.4, radius: 80 })).toBeCloseTo(1.4);
  });
});
