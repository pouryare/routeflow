import { describe, it, expect } from "vitest";
import {
  holtInit,
  holtStep,
  holtForecast,
  ewmaStep,
  seasonalNaive,
  mae,
  mape,
  predictionInterval,
} from "@/lib/predict/smoothing";

describe("predict/smoothing", () => {
  it("Holt tracks a linear series and forecasts the next point", () => {
    let s = holtInit([10, 12, 14, 16]);
    expect(s.level).toBe(10);
    expect(s.trend).toBe(2);
    for (const y of [12, 14, 16]) s = holtStep(s, y);
    expect(holtForecast(s, 1)).toBeCloseTo(18, 1);
    expect(holtForecast(s, 3)).toBeCloseTo(22, 1);
  });

  it("Holt on a flat series → ~zero trend, forecast ≈ level", () => {
    let s = holtInit([5, 5, 5, 5]);
    for (const y of [5, 5, 5]) s = holtStep(s, y);
    expect(s.trend).toBeCloseTo(0, 6);
    expect(holtForecast(s, 4)).toBeCloseTo(5, 6);
  });

  it("holtForecast never goes negative on a steep decline", () => {
    const s = { level: 2, trend: -5, alpha: 0.4, beta: 0.15 };
    expect(holtForecast(s, 3)).toBe(0);
  });

  it("ewmaStep blends", () => {
    expect(ewmaStep(10, 20, 0.5)).toBe(15);
    expect(ewmaStep(10, 20, 0)).toBe(10);
  });

  it("seasonalNaive reads one season back", () => {
    const h = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(seasonalNaive(h, 12, 1)).toBe(1);
    expect(seasonalNaive(h, 12, 13)).toBe(1);
    expect(seasonalNaive(h, 12, 2)).toBe(2);
    expect(seasonalNaive([3, 4], 12, 1)).toBe(4); // shorter than a season → last value
    expect(seasonalNaive([], 12, 1)).toBe(0);
  });

  it("mae / mape", () => {
    expect(mae([2, -2, 4])).toBeCloseTo(2.667, 2);
    expect(mae([])).toBe(0);
    expect(mape([100, 0, 50], [110, 5, 45])).toBeCloseTo(10, 5); // 10% and 10%, the 0 skipped
  });

  it("predictionInterval straddles the point and floors at 0", () => {
    const a = predictionInterval(100, 10);
    expect(a.lo).toBeLessThan(100);
    expect(a.hi).toBeGreaterThan(100);
    expect(a.lo).toBeGreaterThanOrEqual(0);

    expect(predictionInterval(5, 100).lo).toBe(0);
  });
});
