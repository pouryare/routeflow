import { describe, it, expect } from "vitest";
import { PERIODS, PERIOD_LABEL, inRange, periodRange } from "@/lib/periods";
import { jalaliToIsoDate } from "@/lib/jalali";

const today = "2026-10-20"; // 28 Mehr 1405

describe("periods", () => {
  it("this month is the Persian month, not the Gregorian one", () => {
    const r = periodRange("this_month", today);
    expect(r.from).toBe(jalaliToIsoDate(1405, 7, 1));
    expect(r.to).toBe(jalaliToIsoDate(1405, 7, 30));
    expect(r.from).toBe("2026-09-23");
  });
  it("last month steps back one Persian month, across a year boundary too", () => {
    expect(periodRange("last_month", today)).toEqual({ from: jalaliToIsoDate(1405, 6, 1), to: jalaliToIsoDate(1405, 6, 31) });
    const farsi1 = jalaliToIsoDate(1406, 1, 10);
    expect(periodRange("last_month", farsi1).from).toBe(jalaliToIsoDate(1405, 12, 1));
  });
  it("relative days", () => {
    expect(periodRange("today", today)).toEqual({ from: today, to: today });
    expect(periodRange("yesterday", today)).toEqual({ from: "2026-10-19", to: "2026-10-19" });
    expect(periodRange("last_7_days", today)).toEqual({ from: "2026-10-14", to: today });
  });
  it("all is open and custom passes through", () => {
    expect(periodRange("all", today)).toEqual({ from: "", to: "" });
    expect(periodRange("custom", today, { from: "2026-01-01", to: "2026-02-01" })).toEqual({ from: "2026-01-01", to: "2026-02-01" });
  });
  it("inRange treats an empty bound as open and bounds as inclusive", () => {
    expect(inRange("2026-10-20", { from: "", to: "" })).toBe(true);
    expect(inRange("2026-10-20", { from: "2026-10-20", to: "2026-10-20" })).toBe(true);
    expect(inRange("2026-10-21", { from: "", to: "2026-10-20" })).toBe(false);
  });
  it("every period has a label", () => {
    for (const p of PERIODS) expect(PERIOD_LABEL[p]).toBeTruthy();
  });
});
