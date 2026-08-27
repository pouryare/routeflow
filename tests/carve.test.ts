import { describe, it, expect } from "vitest";
import { carvedCardPath } from "@/lib/design/carve";

describe("carvedCardPath", () => {
  it("returns null below the minimum width, so narrow cards stay plain", () => {
    expect(carvedCardPath(320, 200)).toBeNull();
    expect(carvedCardPath(0, 200)).toBeNull();
    expect(carvedCardPath(900, 0)).toBeNull();
  });

  it("draws a closed path starting at the top-left radius", () => {
    const d = carvedCardPath(900, 200)!;
    expect(d.startsWith("M 26 0")).toBe(true);
    expect(d.trimEnd().endsWith("Z")).toBe(true);
  });

  it("cuts the bay out of the top inline-start (right) edge", () => {
    const d = carvedCardPath(900, 200, { notchWidth: 260, notchHeight: 62 })!;
    expect(d).toContain("H 620");                 // 900 - 260 - 20 (inner radius)
    expect(d).toContain("A 26 26 0 0 1 900 88");  // shoulder corner at 62 + 26
  });

  it("always leaves a shoulder, however wide a notch is asked for", () => {
    const d = carvedCardPath(500, 200, { notchWidth: 900 })!;
    // clamped to w - 120 = 380, so the top run stops at 500 - 380 - 20
    expect(d).toContain("H 100");
  });

  it("never lets the notch collapse below its minimum", () => {
    const d = carvedCardPath(900, 200, { notchWidth: 10 })!;
    expect(d).toContain("H 690");                 // 900 - 190 - 20
  });

  it("uses only absolute commands, so the string is inspectable", () => {
    expect(carvedCardPath(900, 200)!).not.toMatch(/[mlhvcsqta]/);
  });
});
