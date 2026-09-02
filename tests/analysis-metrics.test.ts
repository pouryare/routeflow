import { describe, it, expect } from "vitest";
import {
  METRICS,
  RATIO_METRICS,
  METRIC_DIRECTION,
  isRatio,
  isMetric,
  formatMetric,
  ACTIVE_WINDOW_DAYS,
  REPEAT_MIN_ORDERS,
  SAMPLE_CONVERT_DAYS,
} from "@/lib/analysis/metrics";

describe("analysis/metrics vocabulary", () => {
  it("has fourteen distinct Tier-1 metrics", () => {
    expect(METRICS).toHaveLength(14);
    expect(new Set(METRICS).size).toBe(14);
  });

  it("every RATIO_METRICS member is a real metric", () => {
    for (const m of RATIO_METRICS) expect(METRICS).toContain(m);
  });

  it("METRIC_DIRECTION covers every metric; only two point down", () => {
    for (const m of METRICS) expect(METRIC_DIRECTION[m]).toMatch(/^(up|down)$/);
    const down = METRICS.filter((m) => METRIC_DIRECTION[m] === "down");
    expect(down.sort()).toEqual(["lost_customers", "overdue_receivables"]);
  });

  it("isRatio / isMetric", () => {
    expect(isRatio("gross_margin")).toBe(true);
    expect(isRatio("net_sales")).toBe(false);
    expect(isMetric("net_sales")).toBe(true);
    expect(isMetric("nonsense")).toBe(false);
  });

  it("formatMetric: ratio as whole percent, count as grouped integer", () => {
    expect(formatMetric("gross_margin", 0.234)).toBe("۲۳٪");
    expect(formatMetric("orders", 12)).toBe("۱۲");
    expect(formatMetric("net_sales", 1500000)).toBe((1500000).toLocaleString("fa-IR"));
    expect(formatMetric("orders", Number.NaN)).toBe("—");
  });

  it("Data Dictionary constants match the source", () => {
    expect(ACTIVE_WINDOW_DAYS).toBe(60);
    expect(REPEAT_MIN_ORDERS).toBe(2);
    expect(SAMPLE_CONVERT_DAYS).toBe(30);
  });
});
