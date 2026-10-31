import { describe, expect, it } from "vitest";
import { reelDate } from "@/lib/dateReel";

// DateReel (components/mobile/DateReel.tsx) settles its drums through this.
describe("DateReel date", () => {
  it("keeps a valid day", () => {
    expect(reelDate(1405, 1, 15).jd).toBe(15);
  });
  it("pulls ۳۱ back to ۳۰ in a 30-day month", () => {
    expect(reelDate(1405, 7, 31).jd).toBe(30);
  });
  it("pulls ۳۰ back in a non-leap اسفند", () => {
    expect(reelDate(1404, 12, 30).jd).toBe(29);
  });
  it("gives the stored ISO day", () => {
    expect(reelDate(1405, 1, 1).iso).toBe("2026-03-21");
  });
});
