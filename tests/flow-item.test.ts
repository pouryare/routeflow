import { describe, it, expect } from "vitest";
import { clampCount } from "@/lib/flows/item";

describe("clampCount", () => {
  it("stays between none and what was expected", () => {
    expect(clampCount(10, -3)).toBe(0);
    expect(clampCount(10, 4)).toBe(4);
    expect(clampCount(10, 99)).toBe(10);
  });
  it("drops fractions", () => {
    expect(clampCount(10, 4.9)).toBe(4);
  });
});
