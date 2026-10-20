import { describe, expect, it } from "vitest";
import { tehranTodayIso } from "@/lib/jalali";

/* The reason this helper exists: Tehran is UTC+03:30, so for the first 3.5 hours of every
   Tehran day the UTC date is still YESTERDAY. Every "today" default and "today's run" lookup
   goes through here, so the boundary is what has to hold. */
describe("tehranTodayIso", () => {
  it("rolls over at Tehran midnight (20:30Z), not UTC midnight", () => {
    expect(tehranTodayIso(new Date("2026-08-26T20:29:59Z"))).toBe("2026-08-26");
    expect(tehranTodayIso(new Date("2026-08-26T20:30:00Z"))).toBe("2026-08-27");
  });

  it("is the next calendar day while UTC still says yesterday", () => {
    const at0030Tehran = new Date("2026-08-26T21:00:00Z");
    expect(at0030Tehran.toISOString().slice(0, 10)).toBe("2026-08-26");
    expect(tehranTodayIso(at0030Tehran)).toBe("2026-08-27");
  });

  it("agrees with UTC for the rest of the day", () => {
    expect(tehranTodayIso(new Date("2026-08-26T12:00:00Z"))).toBe("2026-08-26");
  });

  it("derives 'yesterday' from an offset instant, as callers do", () => {
    const now = new Date("2026-08-26T21:00:00Z");
    expect(tehranTodayIso(new Date(now.getTime() - 86_400_000))).toBe("2026-08-26");
  });
});
