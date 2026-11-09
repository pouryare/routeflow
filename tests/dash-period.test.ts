import { describe, expect, it } from "vitest";
import { dashPeriod, dashPeriodRange } from "@/lib/periods";
import { toJalali } from "@/lib/jalali";

describe("dashboard time frame", () => {
  it("defaults to this season and ignores anything else", () => {
    expect(dashPeriod(undefined)).toBe("quarter");
    expect(dashPeriod("decade")).toBe("quarter");
    expect(dashPeriod("year")).toBe("year");
  });
  it("starts the season and the year on the first of a Persian month", () => {
    // 2026-11-09 is 18 Aban 1405: autumn began on 1 Mehr, the year on 1 Farvardin.
    const q = dashPeriodRange("quarter", "2026-11-09");
    expect(toJalali(q.from)).toMatchObject({ jy: 1405, jm: 7, jd: 1 });
    expect(q.to).toBe("2026-11-09");
    expect(toJalali(dashPeriodRange("year", "2026-11-09").from)).toMatchObject({ jy: 1405, jm: 1, jd: 1 });
    // 1 Farvardin itself is the first day of both.
    expect(dashPeriodRange("quarter", "2026-03-21").from).toBe("2026-03-21");
  });
  it("leaves «همهٔ زمان‌ها» open", () => {
    expect(dashPeriodRange("all", "2026-11-09")).toEqual({ from: "", to: "" });
  });
});
