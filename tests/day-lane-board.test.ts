import { describe, it, expect } from "vitest";
import { commitState } from "@/components/sales/DayLaneBoard";

/* The wording of a disabled button is design, not decoration, so it is tested as a pure
 * function rather than through a render. This repo has no testing-library and no .tsx tests;
 * adding a dependency to assert one string would be the wrong trade. */
describe("a lane's commit button", () => {
  it("is enabled only with BOTH a driver and a date", () => {
    expect(commitState({ driver_user_id: 7, run_date: "2026-11-02" }).enabled).toBe(true);
    // A driver alone is not a day, and a date alone is not a day.
    expect(commitState({ driver_user_id: 7, run_date: null }).enabled).toBe(false);
    expect(commitState({ driver_user_id: null, run_date: "2026-11-02" }).enabled).toBe(false);
    expect(commitState({ driver_user_id: null, run_date: null }).enabled).toBe(false);
  });

  it("treats an empty string as no date, not as a date", () => {
    // A form field that was cleared sends "", and "" is not a day either. If this passed
    // through, a lane with no date would offer «سفر را قطعی کن».
    expect(commitState({ driver_user_id: 7, run_date: "" }).enabled).toBe(false);
  });

  it("names the NEXT ACTION when it is disabled, rather than counting the problem", () => {
    // «دو خانهٔ خالی مانده» describes what is wrong. This says what to do about it.
    expect(commitState({ driver_user_id: null, run_date: null }).label).toBe(
      "اول راننده و تاریخ را انتخاب کن"
    );
  });

  it("says what pressing it will do when it is enabled", () => {
    expect(commitState({ driver_user_id: 7, run_date: "2026-11-02" }).label).toBe(
      "سفر را قطعی کن"
    );
  });
});