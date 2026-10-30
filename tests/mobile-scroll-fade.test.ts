import { describe, expect, it } from "vitest";
import { autoscrollSpeed, fadeSides } from "@/lib/scrollFade";

// ScrollFade (components/mobile/ScrollFade.tsx) shows its edge fades from this.
describe("ScrollFade sides", () => {
  it("shows nothing when the row fits", () => {
    expect(fadeSides(0, 0, true)).toEqual({ left: false, right: false });
  });
  it("RTL at rest: more content is to the left only", () => {
    expect(fadeSides(0, 200, true)).toEqual({ left: true, right: false });
  });
  it("RTL scrolled to the end: more is to the right only", () => {
    expect(fadeSides(-200, 200, true)).toEqual({ left: false, right: true });
  });
  it("LTR mid-way: both sides", () => {
    expect(fadeSides(80, 200, false)).toEqual({ left: true, right: true });
  });
  it("autoscroll: still in the dead zone, then faster the further you move", () => {
    expect(autoscrollSpeed(8)).toBe(0);
    expect(autoscrollSpeed(60)).toBeGreaterThan(autoscrollSpeed(30));
    expect(autoscrollSpeed(-60)).toBe(-autoscrollSpeed(60));
  });
});
