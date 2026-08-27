import { describe, it, expect } from "vitest";
import { staggerDelays } from "@/lib/design/stagger";

describe("staggerDelays", () => {
  it("steps by the given interval", () => {
    expect(staggerDelays(4, 55)).toEqual([0, 55, 110, 165]);
  });

  it("caps so a long list does not read as lag", () => {
    const d = staggerDelays(13, 55, 10);
    expect(d[10]).toBe(550);
    expect(d[11]).toBe(550);
    expect(d[12]).toBe(550);
  });

  it("returns an empty list for nothing to stagger", () => {
    expect(staggerDelays(0)).toEqual([]);
    expect(staggerDelays(-3)).toEqual([]);
  });

  it("collapses to all-zero when motion is reduced", () => {
    expect(staggerDelays(5, 55, 10, true)).toEqual([0, 0, 0, 0, 0]);
  });
});
