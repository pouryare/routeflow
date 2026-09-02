import { describe, it, expect } from "vitest";
import {
  logistic,
  churnScore,
  churnStep,
  churnBand,
  churnReason,
  DEFAULT_CHURN_WEIGHTS,
  type ChurnFeatures,
  type ChurnWeights,
} from "@/lib/predict/churn";

const feat = (o: Partial<ChurnFeatures>): ChurnFeatures => ({
  recency_ratio: 1,
  trend: 1,
  tenure_months: 12,
  complaints_90d: 0,
  overdue_ratio: 0,
  ...o,
});

describe("predict/churn", () => {
  it("logistic", () => {
    expect(logistic(0)).toBe(0.5);
    expect(logistic(10)).toBeGreaterThan(0.99);
    expect(logistic(-10)).toBeLessThan(0.01);
  });

  it("a long-silent, declining, indebted customer scores high with the default weights", () => {
    const p = churnScore(
      feat({ recency_ratio: 4, trend: 0.3, overdue_ratio: 1 }),
      DEFAULT_CHURN_WEIGHTS
    );
    expect(p).toBeGreaterThan(0.6);
    expect(churnBand(p)).toBe("high");
  });

  it("a steady weekly buyer scores low", () => {
    const p = churnScore(feat({ recency_ratio: 0.8, trend: 1.1, tenure_months: 24 }), DEFAULT_CHURN_WEIGHTS);
    expect(p).toBeLessThan(0.3);
    expect(churnBand(p)).toBe("low");
  });

  it("churnStep moves the score toward the label", () => {
    const f = feat({ recency_ratio: 3, trend: 0.6 });
    const before = churnScore(f, DEFAULT_CHURN_WEIGHTS);
    const up = churnStep(DEFAULT_CHURN_WEIGHTS, f, 1, 0.2);
    const down = churnStep(DEFAULT_CHURN_WEIGHTS, f, 0, 0.2);
    expect(churnScore(f, up)).toBeGreaterThan(before);
    expect(churnScore(f, down)).toBeLessThan(before);
  });

  it("SGD learns a separable set to >80% accuracy from a flat start", () => {
    const churners = Array.from({ length: 40 }, (_, i) =>
      feat({ recency_ratio: 2.5 + (i % 5) * 0.3, trend: 0.4, overdue_ratio: 0.8 })
    );
    const retained = Array.from({ length: 40 }, (_, i) =>
      feat({ recency_ratio: 0.6 + (i % 5) * 0.05, trend: 1.2, tenure_months: 20 })
    );
    let w: ChurnWeights = { bias: 0, recency_ratio: 0, trend: 0, tenure_months: 0, complaints_90d: 0, overdue_ratio: 0 };
    for (let epoch = 0; epoch < 200; epoch++) {
      for (const f of churners) w = churnStep(w, f, 1, 0.05);
      for (const f of retained) w = churnStep(w, f, 0, 0.05);
    }
    const correct =
      churners.filter((f) => churnScore(f, w) >= 0.5).length +
      retained.filter((f) => churnScore(f, w) < 0.5).length;
    expect(correct / 80).toBeGreaterThan(0.8);
  });

  it("churnBand cutpoints", () => {
    expect(churnBand(0.6)).toBe("high");
    expect(churnBand(0.59)).toBe("watch");
    expect(churnBand(0.3)).toBe("watch");
    expect(churnBand(0.29)).toBe("low");
  });

  it("churnReason names recency when recency dominates", () => {
    expect(churnReason(feat({ recency_ratio: 4 }))).toContain("ریتم خرید");
    expect(churnReason(feat({ complaints_90d: 3, recency_ratio: 0.5 }))).toContain("شکایت");
  });
});
