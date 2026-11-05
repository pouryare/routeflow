// SlideConfirm (components/mobile/SlideConfirm.tsx) is the thin view over lib/slideConfirm.ts.
import { describe, it, expect } from "vitest";
import { slideProgress, wantsSlide, LARGE_PAYMENT_TOMAN } from "@/lib/slideConfirm";

describe("slide to confirm", () => {
  it("right to left: moving left is progress", () => {
    expect(slideProgress(-100, 200, true)).toBe(0.5);
    expect(slideProgress(50, 200, true)).toBe(0);
  });
  it("left to right: moving right is progress, capped at the end", () => expect(slideProgress(400, 200, false)).toBe(1));
  it("no track, no progress", () => expect(slideProgress(-50, 0, true)).toBe(0));
  it("large payments slide, small ones tap", () => {
    expect(wantsSlide({ over: LARGE_PAYMENT_TOMAN }, LARGE_PAYMENT_TOMAN)).toBe(true);
    expect(wantsSlide({ over: LARGE_PAYMENT_TOMAN }, 1_000_000)).toBe(false);
    expect(wantsSlide(true, NaN)).toBe(true);
    expect(wantsSlide(undefined, 9e9)).toBe(false);
  });
});
