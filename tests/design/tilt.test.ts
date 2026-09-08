import { describe, it, expect } from "vitest";
import { normalizedPointerPosition, tiltDirection } from "@/lib/design/tilt";

describe("normalizedPointerPosition", () => {
  it("returns 0.5,0.5 at the exact center of the box", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
    expect(normalizedPointerPosition(50, 50, rect)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps outside the box to 0..1", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
    expect(normalizedPointerPosition(-10, 200, rect)).toEqual({ x: 0, y: 1 });
  });
});

describe("tiltDirection", () => {
  it("is 1 under ltr and -1 under rtl -- rotateY sign flips with writing direction", () => {
    expect(tiltDirection("ltr")).toBe(1);
    expect(tiltDirection("rtl")).toBe(-1);
  });
});
