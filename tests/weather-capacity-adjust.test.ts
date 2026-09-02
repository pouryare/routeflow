import { describe, it, expect } from "vitest";
import { weatherAdjustment, neutralAdjustment, type FactorRow } from "@/lib/weather/capacityAdjust";
import { effectiveCapacity } from "@/lib/routing/capacity";

const ROWS: FactorRow[] = [
  { condition_code: "heavy_rain", stop_factor: 0.8, service_time_factor: 1.2, speed_factor: 0.85, max_duration_factor: 1, note_fa: "باران شدید" },
  { condition_code: "snow_ice", stop_factor: 0.55, service_time_factor: 1.3, speed_factor: 0.6, max_duration_factor: 1, note_fa: "برف" },
  { condition_code: "extreme_heat", stop_factor: 0.85, service_time_factor: 1.15, speed_factor: 1, max_duration_factor: 0.7, note_fa: "گرما" },
  { condition_code: "high_wind", stop_factor: 0.85, service_time_factor: 1.1, speed_factor: 0.9, max_duration_factor: 1, note_fa: "باد" },
];

describe("weatherAdjustment", () => {
  it("emits one factor per condition with the row's numbers", () => {
    const a = weatherAdjustment({ precip_mm: 8 }, ROWS);
    expect(a.conditions).toEqual(["heavy_rain"]);
    expect(a.factors).toEqual([{ stop: 0.8, service: 1.2, speed: 0.85, duration: 1 }]);
    expect(a.notes_fa).toContain("باران شدید");
  });

  it("composes two conditions", () => {
    const a = weatherAdjustment({ temp_max: 38, gust_kmh: 62 }, ROWS);
    expect(a.factors).toHaveLength(2);
  });

  it("caps the cold chain for an unrefrigerated van on a hot day", () => {
    const a = weatherAdjustment({ temp_max: 38 }, ROWS);
    expect(a.cold_chain_capped).toBe(true);
    expect(a.factors[0].duration).toBe(0.7);
  });

  it("exempts a refrigerated van from the duration cap but not the rest", () => {
    const a = weatherAdjustment({ temp_max: 38 }, ROWS, { vehicle_has_refrigeration: true });
    expect(a.cold_chain_capped).toBe(false);
    expect(a.factors[0].duration).toBe(1);
    expect(a.factors[0].stop).toBe(0.85);
  });

  it("feeds effectiveCapacity for a snow day", () => {
    const a = weatherAdjustment({ snow_mm: 2 }, ROWS);
    const c = effectiveCapacity({
      base_stops: 30,
      base_service_min: 8,
      base_duration_min: 480,
      factors: a.factors,
    });
    expect(c.max_stops).toBe(Math.floor(30 * 0.55)); // 16
  });

  it("neutralAdjustment is empty", () => {
    expect(neutralAdjustment()).toEqual({ conditions: [], factors: [], cold_chain_capped: false, notes_fa: [] });
  });
});
