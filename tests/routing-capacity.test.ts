import { describe, it, expect } from "vitest";
import { effectiveCapacity, vehicleFit, vehicleLimitFactor } from "@/lib/routing/capacity";

describe("effectiveCapacity", () => {
  it("is identity with no factors", () => {
    const c = effectiveCapacity({ base_stops: 30, base_service_min: 8, base_duration_min: 480, factors: [] });
    expect(c).toMatchObject({ max_stops: 30, service_min: 8, max_duration_min: 480, speed_factor: 1 });
  });

  it("composes stop factors multiplicatively and floors the count", () => {
    const c = effectiveCapacity({
      base_stops: 30,
      base_service_min: 8,
      base_duration_min: 480,
      factors: [{ stop: 0.8 }, { stop: 0.8 }], // 0.64
    });
    expect(c.max_stops).toBe(Math.floor(30 * 0.64)); // 19
  });

  it("never drops a route below 40% of base", () => {
    const c = effectiveCapacity({
      base_stops: 30,
      base_service_min: 8,
      base_duration_min: 480,
      factors: [{ stop: 0.1 }],
    });
    expect(c.max_stops).toBe(Math.ceil(30 * 0.4)); // 12
  });

  it("scales service and duration", () => {
    const c = effectiveCapacity({
      base_stops: 30,
      base_service_min: 8,
      base_duration_min: 480,
      factors: [{ service: 1.2, duration: 0.85 }],
    });
    expect(c.service_min).toBe(Math.round(8 * 1.2)); // 10
    expect(c.max_duration_min).toBe(Math.round(480 * 0.85)); // 408
  });
});

describe("vehicleFit", () => {
  it("returns the first binding constraint", () => {
    expect(
      vehicleFit({ max_weight_kg: 100, max_volume_m3: 2, max_stops: 10 }, { total_kg: 150, total_m3: 1, stop_count: 5 })
    ).toBe("weight");
    expect(
      vehicleFit({ max_weight_kg: 1000, max_volume_m3: 2, max_stops: 10 }, { total_kg: 150, total_m3: 3, stop_count: 5 })
    ).toBe("volume");
    expect(
      vehicleFit({ max_weight_kg: 1000, max_volume_m3: 20, max_stops: 4 }, { total_kg: 150, total_m3: 3, stop_count: 5 })
    ).toBe("stops");
  });

  it("a vehicle with all-null limits always fits", () => {
    expect(vehicleFit({}, { total_kg: 9999, total_m3: 999, stop_count: 999 })).toBeNull();
  });
});

describe("vehicleLimitFactor", () => {
  it("turns a smaller van into a stop factor", () => {
    expect(vehicleLimitFactor(30, 20).stop).toBeCloseTo(20 / 30);
    expect(vehicleLimitFactor(30, 40).stop).toBe(1); // a bigger van does not raise the base
    expect(vehicleLimitFactor(30, null)).toEqual({});
  });
});
