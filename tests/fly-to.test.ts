import { describe, it, expect } from "vitest";
import { arc } from "@/lib/flyTo";

describe("the fly-to dot travels on an arc", () => {
  const pts = arc({ x: 200, y: 100 }, { x: 20, y: 30 }, 10);
  it("starts where it left and ends on the target", () => {
    expect(pts[0]).toEqual({ x: 200, y: 100 });
    expect(pts[10].x).toBeCloseTo(20);
    expect(pts[10].y).toBeCloseTo(30);
  });
  it("rises above both ends on the way", () => expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(30));
});
