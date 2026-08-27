import { describe, it, expect } from "vitest";
import { splinePath, areaPath } from "@/lib/design/spline";

const pts = [
  { x: 0, y: 10 }, { x: 10, y: 30 }, { x: 20, y: 20 }, { x: 30, y: 40 },
];

describe("splinePath", () => {
  it("is empty for fewer than two points", () => {
    expect(splinePath([])).toBe("");
    expect(splinePath([{ x: 1, y: 1 }])).toBe("");
  });

  it("starts with a move to the first point", () => {
    expect(splinePath(pts).startsWith("M 0 10")).toBe(true);
  });

  it("emits one cubic per gap", () => {
    expect((splinePath(pts).match(/C/g) ?? []).length).toBe(pts.length - 1);
  });

  it("ends exactly on the last point, so the line does not drift", () => {
    expect(splinePath(pts).trimEnd().endsWith("30 40")).toBe(true);
  });

  it("passes through every interior point, not near it", () => {
    // each cubic's endpoint is the next data point, verbatim
    for (const p of pts.slice(1)) expect(splinePath(pts)).toContain(`, ${p.x} ${p.y}`);
  });
});

describe("areaPath", () => {
  it("closes the spline down to the baseline and back", () => {
    const d = areaPath(pts, 100);
    expect(d).toContain("L 30 100");
    expect(d).toContain("L 0 100");
    expect(d.trimEnd().endsWith("Z")).toBe(true);
  });

  it("is empty when the spline is", () => {
    expect(areaPath([], 100)).toBe("");
  });
});
