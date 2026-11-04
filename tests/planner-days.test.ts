import { describe, expect, it } from "vitest";
import { plannerDays } from "@/lib/plannerView";
import { toDateStr } from "@/lib/plannerView";

describe("plannerDays", () => {
  it("starts at Tehran's day even when the clock's UTC day is still yesterday", () => {
    // 22:16 UTC on 4 Nov is 01:46 on 5 Nov in Tehran.
    const days = plannerDays(new Date("2026-11-04T22:16:00Z"));
    expect(days).toHaveLength(7);
    expect(toDateStr(days[0])).toBe("2026-11-05");
    expect(toDateStr(days[6])).toBe("2026-11-11");
  });
  it("crosses a month end", () => {
    expect(toDateStr(plannerDays(new Date("2026-10-30T12:00:00Z"))[3])).toBe("2026-11-02");
  });
});
