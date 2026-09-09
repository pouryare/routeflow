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
