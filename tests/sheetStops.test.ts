import { describe, it, expect } from "vitest";
import { nextStop, stopBelow, rubberBand } from "@/lib/sheetStops";

describe("nextStop", () => {
  it("a tap goes up one stop, and from full back to half", () => {
    expect(nextStop("peek", 0)).toBe("half");
    expect(nextStop("half", 3)).toBe("full");
    expect(nextStop("full", -2)).toBe("half");
  });
  it("a drag up moves up one stop and stays at full", () => {
    expect(nextStop("peek", -60)).toBe("half");
    expect(nextStop("half", -40)).toBe("full");
    expect(nextStop("full", -200)).toBe("full");
  });
  it("a drag down moves down one stop and closes from peek", () => {
    expect(nextStop("full", 60)).toBe("half");
    expect(nextStop("half", 40)).toBe("peek");
    expect(nextStop("peek", 80)).toBe("close");
  });
  it("a short drag between a tap and a step stays where it was", () => {
    expect(nextStop("half", 20)).toBe("half");
    expect(nextStop("half", -20)).toBe("half");
  });
});

describe("stopBelow", () => {
  it("steps down and closes below peek", () => {
    expect(stopBelow("full")).toBe("half");
    expect(stopBelow("half")).toBe("peek");
    expect(stopBelow("peek")).toBe("close");
  });
});

describe("rubberBand", () => {
  it("does nothing for no pull or a push", () => {
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(-30)).toBe(0);
  });
  it("follows the finger at first, then resists and never passes the cap", () => {
    expect(rubberBand(4)).toBeGreaterThan(3.5);
    expect(rubberBand(40)).toBe(20);
    expect(rubberBand(10_000)).toBeLessThan(40);
    expect(rubberBand(100)).toBeGreaterThan(rubberBand(50));
  });
});
