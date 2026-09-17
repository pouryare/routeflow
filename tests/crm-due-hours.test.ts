import { describe, it, expect } from "vitest";
import { resolveDue, labelDue, tehranParts, TEHRAN_OFFSET_MIN } from "@/lib/crm/due";
import { isWorkingHours, parseHours, satIndex, isOpenAt, nextOpenAt, formatHours } from "@/lib/crm/hours";

// 2026-09-11 10:00 UTC = 13:30 Tehran, a Friday (jsDow 5).
const NOW = "2026-09-11T10:00:00.000Z";

describe("resolveDue", () => {
  it("uses a fixed Tehran offset with no DST", () => expect(TEHRAN_OFFSET_MIN).toBe(210));
  it("resolves wall-clock Tehran times", () => {
    expect(resolveDue({ kind: "tomorrow", hour: 10 }, NOW)).toBe("2026-09-12T06:30:00.000Z");
    expect(resolveDue({ kind: "in_days", days: 3, hour: 10 }, NOW)).toBe("2026-09-14T06:30:00.000Z");
    expect(resolveDue({ kind: "in_hours", hours: 2 }, NOW)).toBe("2026-09-11T12:00:00.000Z");
    expect(resolveDue({ kind: "in_months", months: 3, hour: 10 }, NOW)).toBe("2026-12-11T06:30:00.000Z");
    expect(resolveDue({ kind: "none" }, NOW)).toBeNull();
  });
  it("moves a today time that has already passed to an hour from now", () => {
    expect(resolveDue({ kind: "at_today", hour: 17 }, NOW)).toBe("2026-09-11T13:30:00.000Z");
    expect(resolveDue({ kind: "at_today", hour: 9 }, NOW)).toBe("2026-09-11T11:00:00.000Z");
  });
  it("uses a picked date and rejects a malformed one", () => {
    expect(resolveDue({ kind: "pick", hour: 10 }, NOW, "2026-09-20")).toBe("2026-09-20T06:30:00.000Z");
    expect(resolveDue({ kind: "pick", hour: 10 }, NOW, "20/9")).toBeNull();
    expect(resolveDue({ kind: "pick", hour: 10 }, NOW, null)).toBeNull();
  });
  it("labels relative to today", () => {
    expect(labelDue("2026-09-12T06:30:00.000Z", NOW)).toBe("فردا ۱۰:۰۰");
    expect(labelDue("2026-09-11T13:30:00.000Z", NOW)).toBe("امروز ۱۷:۰۰");
    expect(labelDue("2026-09-16T06:30:00.000Z", NOW)).toBe("۵ روز دیگر ۱۰:۰۰");
  });
  it("knows the Tehran weekday", () => expect(tehranParts(NOW).jsDow).toBe(5));
});

describe("working hours", () => {
  const split = [
    { days: [0, 1, 2, 3, 4, 5, 6], from: "12:00", to: "16:00" },
    { days: [0, 1, 2, 3, 4, 5, 6], from: "19:00", to: "24:00" },
  ];
  it("validates ranges, days and formats", () => {
    expect(isWorkingHours(split)).toBe(true);
    expect(isWorkingHours([{ days: [], from: "12:00", to: "16:00" }])).toBe(false);
    expect(isWorkingHours([{ days: [0], from: "12:00", to: "12:00" }])).toBe(false);
    expect(isWorkingHours([{ days: [7], from: "12:00", to: "16:00" }])).toBe(false);
    expect(isWorkingHours([{ days: [0], from: "9:00", to: "16:00" }])).toBe(false);
    expect(isWorkingHours([{ days: [0, 0], from: "09:00", to: "16:00" }])).toBe(false);
    expect(parseHours("not json")).toEqual([]);
    expect(parseHours(null)).toEqual([]);
    expect(parseHours(JSON.stringify(split))).toEqual(split);
  });
  it("answers open/closed, including overnight ranges", () => {
    expect(isOpenAt(split, 0, 13 * 60)).toBe(true);
    expect(isOpenAt(split, 0, 17 * 60)).toBe(false);
    expect(isOpenAt(split, 0, 16 * 60)).toBe(false);
    const night = [{ days: [5], from: "19:00", to: "02:00" }];
    expect(isOpenAt(night, 5, 23 * 60)).toBe(true);
    expect(isOpenAt(night, 6, 60)).toBe(true);
    expect(isOpenAt(night, 6, 3 * 60)).toBe(false);
  });
  it("maps the JS week onto the Saturday-first Persian week", () => {
    expect(satIndex(0)).toBe(1);
    expect(satIndex(5)).toBe(6);
    expect(satIndex(6)).toBe(0);
  });
  it("moves a due time to the next open slot", () => {
    // tomorrow 10:00 Tehran, shop opens at 12:00 -> 12:00 Tehran = 08:30 UTC
    expect(nextOpenAt(split, "2026-09-12T06:30:00.000Z")).toBe("2026-09-12T08:30:00.000Z");
    expect(nextOpenAt([], "2026-09-12T06:30:00.000Z")).toBe("2026-09-12T06:30:00.000Z");
    // Thursday 13:30 Tehran is outside 19:00-02:00; next slot is 19:00 Tehran = 15:30 UTC
    expect(nextOpenAt([{ days: [5], from: "19:00", to: "02:00" }], "2026-09-10T10:00:00.000Z")).toBe("2026-09-10T15:30:00.000Z");
  });
  it("formats in Persian and merges ranges that share days", () => {
    expect(formatHours(split)).toBe("همه‌روزه ۱۲–۱۶ و ۱۹–۲۴");
    expect(formatHours([{ days: [0, 1, 2, 3, 4], from: "08:30", to: "17:00" }])).toBe("شنبه تا چهارشنبه ۸:۳۰–۱۷");
    expect(formatHours([])).toBe("");
  });
});
