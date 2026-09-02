import { describe, it, expect } from "vitest";
import { periodRange, periodOf, shiftPeriod } from "@/lib/analysis/period";
import { toJalali } from "@/lib/jalali";

describe("analysis/period", () => {
  it("periodRange is a half-open Gregorian range whose ends fall in the right Jalali month", () => {
    const { from, toExcl } = periodRange("1405-06");
    expect(toJalali(from)).toMatchObject({ jy: 1405, jm: 6, jd: 1 });
    // toExcl is the first day of the next Jalali month
    expect(toJalali(toExcl)).toMatchObject({ jy: 1405, jm: 7, jd: 1 });
    expect(from < toExcl).toBe(true);
  });

  it("periodRange spans a Gregorian month boundary", () => {
    const { from, toExcl } = periodRange("1405-06");
    expect(from.slice(0, 7)).not.toBe(toExcl.slice(0, 7));
  });

  it("periodOf round-trips through periodRange.from", () => {
    const { from } = periodRange("1404-12");
    expect(periodOf(`${from}T09:00:00.000Z`)).toBe("1404-12");
  });

  it("shiftPeriod walks Jalali months, wrapping the year", () => {
    expect(shiftPeriod("1405-06", 1)).toBe("1405-05");
    expect(shiftPeriod("1405-01", 1)).toBe("1404-12");
    expect(shiftPeriod("1405-12", -1)).toBe("1406-01");
    expect(shiftPeriod("1405-06", 0)).toBe("1405-06");
  });

  it("rejects a malformed period", () => {
    expect(() => periodRange("nope")).toThrow();
    expect(() => periodRange("1405-13")).toThrow();
  });
});
