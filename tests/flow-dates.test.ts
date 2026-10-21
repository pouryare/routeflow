import { describe, it, expect } from "vitest";
import { addDaysIso, DUE_PRESETS } from "@/lib/flows/dates";

describe("addDaysIso", () => {
  it("adds across month and year ends", () => {
    expect(addDaysIso("2026-10-20", 7)).toBe("2026-10-27");
    expect(addDaysIso("2026-12-25", 10)).toBe("2027-01-04");
  });
  it("is not thrown off by a daylight-saving change", () => {
    expect(addDaysIso("2026-03-01", 30)).toBe("2026-03-31");
    expect(addDaysIso("2026-10-01", 30)).toBe("2026-10-31");
  });
  it("handles zero and leap days", () => {
    expect(addDaysIso("2026-10-20", 0)).toBe("2026-10-20");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("offers presets in ascending order", () => {
    const d = DUE_PRESETS.map((p) => p.days);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });
});
