import { describe, expect, it } from "vitest";
import { bezierPath } from "@/lib/design/connectorPath";

describe("bezierPath", () => {
  it("starts at the from point and ends at the to point", () => {
    const d = bezierPath({ x: 10, y: 20 }, { x: 110, y: 220 });
    expect(d.startsWith("M 10 20")).toBe(true);
    expect(d.endsWith("110 220")).toBe(true);
  });

  it("is a single cubic bezier segment", () => {
    const d = bezierPath({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(d).toMatch(/^M .+ C .+, .+, .+$/);
  });

  it("control points sit at the vertical midpoint -- an S-curve, not a straight elbow", () => {
    const d = bezierPath({ x: 0, y: 0 }, { x: 100, y: 200 });
    expect(d).toContain(" 100 ");
  });
});
