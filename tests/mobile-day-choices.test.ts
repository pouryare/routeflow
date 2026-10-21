import { describe, it, expect } from "vitest";
import { dayChoices, weekDays, solarHolidaysAround } from "@/lib/dayChoices";

describe("day choices", () => {
  const holidays = new Set(["2026-10-22"]);

  it("offers today, tomorrow, the day after, then weekdays, then 'another day'", () => {
    const out = dayChoices("2026-10-20", { holidays: new Set(), count: 5 });
    expect(out.map((d) => d.label).slice(0, 3)).toEqual(["امروز", "فردا", "پس‌فردا"]);
    expect(out[0]).toMatchObject({ kind: "day", iso: "2026-10-20" });
    expect(out.at(-1)).toMatchObject({ kind: "other" });
    expect(out.filter((d) => d.kind === "day")).toHaveLength(5);
  });

  it("after the first three, a day is named by its weekday and Jalali date", () => {
    const out = dayChoices("2026-10-20", { holidays: new Set(), count: 5 });
    const fourth = out[3];
    expect(fourth.iso).toBe("2026-10-23"); // a Friday
    expect(fourth.label).toContain("جمعه");
    expect(fourth.sub).toBeTruthy();
  });

  it("removes holidays when picking a working day (skipHolidays, the default)", () => {
    const out = dayChoices("2026-10-20", { holidays, count: 5 });
    expect(out.map((d) => d.iso)).not.toContain("2026-10-22");
    expect(out.filter((d) => d.kind === "day")).toHaveLength(5); // still five: it reaches further
  });

  it("keeps and flags holidays when picking freely (skipHolidays: false)", () => {
    const out = dayChoices("2026-10-20", { holidays, count: 5, skipHolidays: false });
    expect(out.find((d) => d.iso === "2026-10-22")?.flag).toBe("holiday");
  });

  it("Friday is always kept, and flagged as the weekend", () => {
    const out = dayChoices("2026-10-20", { holidays: new Set(), count: 8 });
    expect(out.find((d) => d.iso === "2026-10-23")?.flag).toBe("weekend");
  });

  it("never offers a day before the start", () => {
    const out = dayChoices("2026-10-20", { holidays: new Set(), count: 5 });
    for (const d of out) if (d.iso) expect(d.iso >= "2026-10-20").toBe(true);
  });
});

describe("week strip", () => {
  it("is a run of consecutive days from the start", () => {
    const w = weekDays("2026-10-20", 14, new Set());
    expect(w).toHaveLength(14);
    expect(w[0].iso).toBe("2026-10-20");
    expect(w[13].iso).toBe("2026-11-02");
  });
  it("marks holidays and Fridays without hiding them", () => {
    const w = weekDays("2026-10-20", 7, new Set(["2026-10-22"]));
    expect(w.find((d) => d.iso === "2026-10-22")?.flag).toBe("holiday");
    expect(w.find((d) => d.iso === "2026-10-23")?.flag).toBe("weekend");
  });
});

describe("the solar holidays around a date", () => {
  it("includes the ones the calendar knows without a database", () => {
    // 1 Farvardin 1406 = Nowruz: 2027-03-21
    const s = solarHolidaysAround("2027-03-10", 30);
    expect(s.has("2027-03-21")).toBe(true);
  });
});
