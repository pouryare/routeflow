import { describe, it, expect } from "vitest";
import { calendarDays } from "@/lib/dashboard";

describe("sales by day on calendar days (T15)", () => {
  it("fills empty days with 0, newest first, so the weeks line up", () => {
    const days = calendarDays(new Map([["2026-11-05", 10], ["2026-11-02", 7]]), "2026-11-05", 5);
    expect(days.map((d) => [d.key, d.value])).toEqual([
      ["2026-11-05", 10], ["2026-11-04", 0], ["2026-11-03", 0], ["2026-11-02", 7], ["2026-11-01", 0],
    ]);
  });

  it("crosses a month end without skipping a day", () => {
    expect(calendarDays(new Map(), "2026-03-01", 2).map((d) => d.key)).toEqual(["2026-03-01", "2026-02-28"]);
  });
});
