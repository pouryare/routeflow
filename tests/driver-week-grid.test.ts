import { describe, it, expect } from "vitest";
import { buildStreak, type StreakCell } from "@/lib/streak";
import { recentLoads } from "@/lib/driverLoad";

const TODAY = "2026-10-04"; // a Sunday

function flatten(s: { weeks: StreakCell[][] }): StreakCell[] {
  return s.weeks.flat();
}
function stateOf(s: { weeks: StreakCell[][] }, date: string) {
  return flatten(s).find((c) => c.date === date)?.state;
}
/** The Friday that closes the Persian week containing `d`. */
function weekEndOf(d: string): string {
  const ms = Date.parse(`${d}T00:00:00Z`);
  const sat = (new Date(ms).getUTCDay() + 1) % 7; // 0 = Saturday
  return new Date(ms - sat * 86_400_000 + 6 * 86_400_000).toISOString().slice(0, 10);
}

describe("the driver week grid — fourteen columns, five states", () => {
  it("looks twelve weeks back AND two weeks forward", () => {
    const s = buildStreak([], TODAY, { weeks: 12, futureWeeks: 2 });
    const cells = flatten(s);
    // Not a magic column count: the grid snaps its first column back to a Saturday, so the
    // count is weeks+futureWeeks plus at most one alignment column. What matters is that
    // the last column is two whole weeks PAST the one containing today.
    const thisWeek = cells.find((c) => c.date === TODAY)!;
    const lastCol = s.weeks.at(-1)!;
    const daysAhead =
      (Date.parse(lastCol[6].date) - Date.parse(thisWeek.date)) / 86_400_000;
    expect(daysAhead).toBeGreaterThanOrEqual(13); // through to the Friday two weeks on
    expect(s.weeks.length).toBeGreaterThanOrEqual(14);
  });

  it("keeps every column a whole Saturday-to-Friday week", () => {
    const s = buildStreak([], TODAY, { weeks: 12, futureWeeks: 2 });
    for (const col of s.weeks) expect(col).toHaveLength(7);
  });

  it("shows a driven-but-unfiled day as PENDING, not idle", () => {
    // THE POINT. driverActivity fills a cell only for a RECORDED delivery
    // (`status='delivered' AND delivered_at IS NOT NULL`), so a driver who drove out this
    // morning and has not filed yet is invisible and looks idle. Harmless in a report;
    // harmful the moment this grid decides who carries tomorrow.
    const s = buildStreak([], TODAY, {
      weeks: 12,
      futureWeeks: 2,
      pending: ["2026-10-03"],
    });
    expect(stateOf(s, "2026-10-03")).toBe("pending");
  });

  it("marks a future day that already has a run as PLANNED", () => {
    const s = buildStreak([], TODAY, {
      weeks: 12,
      futureWeeks: 2,
      planned: ["2026-10-08"],
    });
    expect(stateOf(s, "2026-10-08")).toBe("planned");
  });

  it("distinguishes all five states", () => {
    const s = buildStreak(["2026-09-20"], TODAY, {
      weeks: 12,
      futureWeeks: 2,
      pending: ["2026-10-03"],
      planned: ["2026-10-08"],
    });
    expect(stateOf(s, "2026-09-20")).toBe("delivered"); // a real recorded day
    expect(stateOf(s, "2026-10-01")).toBe("none"); // past, nothing happened
    expect(stateOf(s, "2026-10-03")).toBe("pending");
    expect(stateOf(s, "2026-10-05")).toBe("future"); // future, nothing planned
    expect(stateOf(s, "2026-10-08")).toBe("planned");
  });

  it("does not let a pending day extend the recorded streak", () => {
    // "Consecutive days with RECORDED work" must not quietly become "consecutive days with
    // a run" — otherwise a grid that admits it cannot file anything inflates a real number.
    const withPending = buildStreak([], TODAY, { weeks: 12, futureWeeks: 2, pending: ["2026-10-03"] });
    expect(withPending.current).toBe(0);
  });

  it("leaves the old 12-week shape alone when no options are passed", () => {
    // The existing tests must keep passing: adding forward weeks is OPT-IN, because
    // /sales/runs' own summary is about the past. The last column still contains today.
    const s = buildStreak([], TODAY, 12);
    expect(s.weeks.length).toBeGreaterThanOrEqual(12);
    expect(s.weeks.at(-1)!.some((c) => c.date === TODAY)).toBe(true);
    expect(s.weeks.at(-1)!.every((c) => c.date <= weekEndOf(TODAY))).toBe(true);
  });
});

describe("recentLoads — the bars, and the fair line", () => {
  it("excludes the current partial week from the mean", () => {
    // An unfinished week drags the average down, so the bars would disagree with the grid
    // sitting next to them.
    const r = recentLoads(
      [
        { date: "2026-09-02", kg: 900 }, // a complete week
        { date: "2026-09-09", kg: 900 }, // a complete week
        { date: "2026-10-03", kg: 100 }, // THIS week so far — half a day, not a week
      ],
      TODAY,
      6
    );
    expect(r.meanKg).toBe(900);
    expect(r.bars).toHaveLength(6);
    expect(r.bars.at(-1)!.kg).toBe(100); // still SHOWN — it just does not vote
  });

  it("has no mean at all before there is a full week of history", () => {
    // A mean of one bar is not an average, and drawing a fair line through it would be a
    // precise-looking number with nothing behind it.
    // One point, and it falls in the current week: nothing complete to average.
    const r = recentLoads([{ date: "2026-10-03", kg: 900 }], TODAY, 6);
    expect(r.meanKg).toBeNull();
  });

  it("keeps a driver with a quiet history visible", () => {
    // Bahram matters. A MISSING row is a mystery; an empty grid is an answer — he is here,
    // he has just had a quiet twelve weeks.
    const r = recentLoads([{ date: "2026-09-16", kg: 310 }], TODAY, 6);
    expect(r.bars).toHaveLength(6);
    expect(r.bars.filter((b) => b.kg > 0)).toHaveLength(1);
  });
});