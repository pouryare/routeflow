import { describe, it, expect } from "vitest";
import { decide, LONG_PRESS_MS } from "@/lib/swipe";

const cfg = { threshold: 72, commit: 140, rtl: true };

describe("swipe model", () => {
  it("a short drag does nothing; reveal past threshold; commit past commit", () => {
    expect(decide({ dx: 20 }, cfg)).toEqual({ state: "idle" });
    expect(decide({ dx: 90 }, cfg)).toEqual({ state: "reveal", side: "start" });
    expect(decide({ dx: 200 }, cfg)).toEqual({ state: "commit", side: "start" });
  });
  it("RTL mirrors LTR", () => {
    expect(decide({ dx: -90 }, cfg)).toEqual({ state: "reveal", side: "end" });
    expect(decide({ dx: 90 }, { ...cfg, rtl: false })).toEqual({ state: "reveal", side: "end" });
    expect(decide({ dx: -200 }, { ...cfg, rtl: false })).toEqual({ state: "commit", side: "start" });
  });
  it("a mostly-vertical gesture is a scroll, not a swipe", () => {
    expect(decide({ dx: 100, dy: 90 }, cfg)).toEqual({ state: "idle" });
    expect(decide({ dx: 100, dy: 40 }, cfg)).toEqual({ state: "reveal", side: "start" });
  });
  it("a long press is a deliberate wait", () => {
    expect(LONG_PRESS_MS).toBeGreaterThanOrEqual(400);
  });
});
