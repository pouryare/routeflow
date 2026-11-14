import { describe, it, expect } from "vitest";
import { driverDays, hoursLabel } from "@/lib/driverHours";

const run = (over: Partial<Parameters<typeof driverDays>[0][number]>) => ({
  driver_user_id: 1, driver_name: "علی", run_date: "2026-11-10", status: "done",
  started_at: "2026-11-10T05:00:00.000Z", finished_at: "2026-11-10T09:30:00.000Z", ...over,
});

describe("driver hours", () => {
  it("adds a day's runs: earliest start, latest finish, minutes of each run", () => {
    const [d] = driverDays([
      run({}),
      run({ started_at: "2026-11-10T11:00:00.000Z", finished_at: "2026-11-10T12:00:00.000Z" }),
    ]);
    expect(d.runs).toBe(2);
    expect(d.first_start).toBe("2026-11-10T05:00:00.000Z");
    expect(d.last_finish).toBe("2026-11-10T12:00:00.000Z");
    expect(d.minutes).toBe(270 + 60);
    expect(hoursLabel(d.minutes)).toBe("۵ ساعت و ۳۰ دقیقه");
  });
  it("a run still on the road is marked open and not counted; a run never started counts only as a run", () => {
    const days = driverDays([
      run({ status: "in_progress", finished_at: null }),
      run({ driver_user_id: 2, driver_name: "رضا", started_at: null, finished_at: null, status: "ready" }),
    ]);
    expect(days.find((d) => d.driver_user_id === 1)).toMatchObject({ open: true, minutes: 0 });
    expect(days.find((d) => d.driver_user_id === 2)).toMatchObject({ runs: 1, first_start: null, minutes: 0 });
    expect(hoursLabel(0)).toBe("—");
  });
  it("lists the newest day first", () => {
    const days = driverDays([run({ run_date: "2026-11-09" }), run({ run_date: "2026-11-11" })]);
    expect(days.map((d) => d.run_date)).toEqual(["2026-11-11", "2026-11-09"]);
  });
});
