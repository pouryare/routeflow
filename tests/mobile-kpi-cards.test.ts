import { describe, it, expect } from "vitest";
import { formatKpi, kpiDelta } from "@/lib/kpiCards";

const card = (value: number | null, prev: number | null, delta: number, direction: "up" | "down" = "up") => ({ value, prev_value: prev, delta_pct: delta, direction });

describe("kpi card formatting", () => {
  it("ratios are percentages, amounts are grouped Persian digits, missing is a dash", () => {
    expect(formatKpi("gross_margin", 0.42)).toBe("۴۲٪");
    expect(formatKpi("net_sales", 1200000)).toBe("۱٬۲۰۰٬۰۰۰");
    expect(formatKpi("net_sales", null)).toBe("—");
  });
  it("a rise is good when up is good, bad when down is good", () => {
    expect(kpiDelta(card(110, 100, 0.1))).toEqual({ dir: "up", good: true, text: "۱۰٪" });
    expect(kpiDelta(card(110, 100, 0.1, "down"))).toEqual({ dir: "up", good: false, text: "۱۰٪" });
    expect(kpiDelta(card(90, 100, -0.1, "down"))?.good).toBe(true);
  });
  it("a negligible change is flat and neither good nor bad", () => {
    expect(kpiDelta(card(100, 100, 0.0001))).toEqual({ dir: "flat", good: null, text: "۰٪" });
  });
  it("no previous period means no delta", () => {
    expect(kpiDelta(card(100, null, 0))).toBeNull();
    expect(kpiDelta(card(null, 100, 0))).toBeNull();
  });
});
