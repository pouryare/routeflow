import { describe, it, expect } from "vitest";
import {
  DEFAULT_MONTH_FACTORS,
  DEFAULT_DOW_FACTORS,
  seasonalIndex,
  monthIndex,
  deseasonalise,
  reseasonalise,
} from "@/lib/predict/seasonality";
import { toJalali } from "@/lib/jalali";

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

describe("predict/seasonality", () => {
  it("both default arrays are mean-1 and the right length", () => {
    expect(DEFAULT_MONTH_FACTORS).toHaveLength(12);
    expect(DEFAULT_DOW_FACTORS).toHaveLength(7);
    expect(mean(DEFAULT_MONTH_FACTORS)).toBeCloseTo(1, 9);
    expect(mean(DEFAULT_DOW_FACTORS)).toBeCloseTo(1, 9);
  });

  it("seasonalIndex is the product of the month and day-of-week factors", () => {
    const iso = "2026-04-15T00:00:00.000Z";
    const j = toJalali(iso)!;
    const [y, m, d] = "2026-04-15".split("-").map(Number);
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) % 7;
    expect(seasonalIndex(DEFAULT_MONTH_FACTORS, DEFAULT_DOW_FACTORS, iso)).toBeCloseTo(
      DEFAULT_MONTH_FACTORS[j.jm - 1] * DEFAULT_DOW_FACTORS[dow],
      9
    );
  });

  it("monthIndex picks the Jalali month factor", () => {
    const iso = "2026-04-15T00:00:00.000Z";
    const j = toJalali(iso)!;
    expect(monthIndex(DEFAULT_MONTH_FACTORS, iso)).toBe(DEFAULT_MONTH_FACTORS[j.jm - 1]);
  });

  it("deseasonalise ∘ reseasonalise is identity; guarded at idx 0", () => {
    expect(deseasonalise(reseasonalise(123, 1.4), 1.4)).toBeCloseTo(123, 9);
    expect(deseasonalise(50, 0)).toBe(50);
  });
});
