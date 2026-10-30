import { describe, expect, it } from "vitest";
import { revealCircle } from "@/lib/theme";

describe("revealCircle", () => {
  it("centres on the button and reaches the farthest corner", () => {
    // A 44px button in the top-right corner of a 390x844 phone (the RTL header's start side).
    const c = revealCircle({ left: 330, top: 10, width: 44, height: 44 }, 390, 844);
    expect(c.x).toBe(352);
    expect(c.y).toBe(32);
    // Farthest corner is bottom-left: (0, 844).
    expect(c.r).toBeCloseTo(Math.hypot(352, 812));
  });

  it("picks the far side when the button is on the left", () => {
    const c = revealCircle({ left: 0, top: 800, width: 40, height: 40 }, 390, 844);
    expect(c.r).toBeCloseTo(Math.hypot(370, 820));
  });
});
