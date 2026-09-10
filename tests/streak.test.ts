import { describe, it, expect } from "vitest";
import { buildStreak } from "@/lib/streak";

/* 2026-09-10 is a Thursday, so its week (Saturday first) is 09-05 … 09-11. */
const TODAY = "2026-09-10";

describe("buildStreak", () => {
  it("draws whole Saturday-to-Friday weeks ending with this week", () => {
    const s = buildStreak([], TODAY, 12);
    expect(s.weeks.length).toBeGreaterThanOrEqual(12);
    for (const week of s.weeks) expect(week).toHaveLength(7);
    const last = s.weeks[s.weeks.length - 1];
    expect(last[0].date).toBe("2026-09-05"); // Saturday
    expect(last[6].date).toBe("2026-09-11"); // Friday
    expect(new Date(`${s.weeks[0][0].date}T00:00:00Z`).getUTCDay()).toBe(6);
  });

  it("marks the days after today as future and never counts them", () => {
    const s = buildStreak(["2026-09-11"], TODAY);
    const last = s.weeks[s.weeks.length - 1];
    expect(last[6].future).toBe(true);
    expect(last[6].n).toBe(0);
    expect(s.total).toBe(0);
  });

  it("counts repeats as that many events, and shades relative to the busiest day", () => {
    const s = buildStreak(["2026-09-08", "2026-09-08", "2026-09-08", "2026-09-08", "2026-09-09"], TODAY);
    const cells = s.weeks.flat();
    expect(cells.find((c) => c.date === "2026-09-08")).toMatchObject({ n: 4, level: 4 });
    expect(cells.find((c) => c.date === "2026-09-09")).toMatchObject({ n: 1, level: 1 });
    expect(s.total).toBe(5);
    expect(s.activeDays).toBe(2);
  });

  it("a day still empty today does not break the current streak", () => {
    expect(buildStreak(["2026-09-07", "2026-09-08", "2026-09-09"], TODAY).current).toBe(3);
    expect(buildStreak(["2026-09-08", "2026-09-09", "2026-09-10"], TODAY).current).toBe(3);
    expect(buildStreak(["2026-09-07", "2026-09-09"], TODAY).current).toBe(1);
    expect(buildStreak(["2026-09-01"], TODAY).current).toBe(0);
  });

  it("finds the longest run inside the window only", () => {
    const s = buildStreak(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-08-20", "2026-08-21"], TODAY);
    expect(s.longest).toBe(2);
  });

  it("accepts full timestamps, not just dates", () => {
    expect(buildStreak(["2026-09-09T14:22:00.000Z"], TODAY).total).toBe(1);
  });
});
