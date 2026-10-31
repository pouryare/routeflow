import { describe, it, expect } from "vitest";
import { REPEAT_FIRST_MS, repeatInterval } from "@/lib/repeatPress";

describe("hold to repeat a count", () => {
  it("a tap is not a hold: repeating starts only after the first wait", () => {
    expect(REPEAT_FIRST_MS).toBeGreaterThan(300);
  });
  it("speeds up with every repeat and never gets faster than 60 ms", () => {
    expect(repeatInterval(1)).toBe(170);
    expect(repeatInterval(2)).toBeLessThan(repeatInterval(1));
    expect(repeatInterval(50)).toBe(60);
  });
});
