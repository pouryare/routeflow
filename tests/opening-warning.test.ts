import { describe, it, expect } from "vitest";
import { openingWarning, dayWindow, warningText } from "@/lib/openingWarning";
import type { WorkingHours } from "@/lib/crm/hours";

// 2026-11-14 is a Saturday: index 0 in the Iranian week.
const SAT = "2026-11-14";
const shop: WorkingHours = [{ days: [0, 1, 2, 3, 4], from: "09:00", to: "18:00" }];

describe("opening warning", () => {
  it("unknown hours warn about nothing", () => {
    expect(openingWarning([], SAT, 3 * 60)).toBeNull();
  });
  it("during opening hours there is no warning", () => {
    expect(openingWarning(shop, SAT, 10 * 60)).toBeNull();
  });
  it("before opening says when it opens", () => {
    const w = openingWarning(shop, SAT, 8 * 60);
    expect(w).toEqual({ kind: "before", opens: "09:00" });
    expect(warningText(w!)).toContain("۰۹:۰۰");
  });
  it("after closing and on a closed weekday are told apart", () => {
    expect(openingWarning(shop, SAT, 19 * 60)).toEqual({ kind: "after" });
    expect(openingWarning(shop, "2026-11-20", 10 * 60)).toEqual({ kind: "closed_day" }); // Friday
  });
  it("the window for a day runs from the first opening to the last closing", () => {
    expect(dayWindow([{ days: [0], from: "09:00", to: "13:00" }, { days: [0], from: "16:00", to: "20:00" }], SAT)).toEqual([9 * 3600, 20 * 3600]);
    expect(dayWindow(shop, "2026-11-20")).toBeNull();
    expect(dayWindow([{ days: [0], from: "18:00", to: "02:00" }], SAT)).toEqual([18 * 3600, 24 * 3600]);
  });
});

import { applyVroomSolution, buildVroomJob } from "@/lib/routing/vroom";

describe("opening hours as VROOM windows", () => {
  const d = (id: number, tw?: [number, number]) => ({ delivery_id: id, lat: 35.7, lng: 51.4, weight_kg: 1, volume_m3: 0.01, service_min: 5, time_window: tw });
  const v = { vehicle_key: 1, start: { lat: 35.7, lng: 51.4 }, end: { lat: 35.7, lng: 51.4 }, capacity: [100, 100, 10] as [number, number, number] };
  const m = { durations: [[0, 1, 1], [1, 0, 1], [1, 1, 0]] };

  it("sets the day's start on the vehicle only when some shop has a window", () => {
    expect(buildVroomJob([d(1, [32400, 64800]), d(2)], [v], m, 28800).vehicles[0].time_window).toEqual([28800, 28800 + 16 * 3600]);
    expect(buildVroomJob([d(1), d(2)], [v], m, 28800).vehicles[0].time_window).toBeUndefined();
    expect(buildVroomJob([d(1, [32400, 64800])], [v], m).vehicles[0].time_window).toBeUndefined();
  });
  it("counts arrivals from the day's start, never below zero", () => {
    const r = applyVroomSolution({ routes: [{ vehicle: 1, steps: [{ type: "job", job: 1, arrival: 28800 + 600 }, { type: "job", job: 2, arrival: 100 }] }] }, 28800);
    expect(r.assignments[0].stops.map((s) => s.eta_min)).toEqual([10, 0]);
  });
});
