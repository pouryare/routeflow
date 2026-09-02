import { describe, it, expect } from "vitest";
import { priorityScore, rankActionCenter, type Candidate } from "@/lib/analysis/actionCenter";

const cand = (o: Partial<Candidate>): Candidate => ({
  key: Math.random().toString(36),
  kind: "alert",
  title_fa: "x",
  bucket: "warning",
  impact: 0.5,
  probability: 1,
  urgency: 0.5,
  ...o,
});

describe("analysis/actionCenter", () => {
  it("priorityScore clamps each factor to [0,1] then multiplies", () => {
    expect(priorityScore(2, 0.5, 1)).toBe(0.5); // impact clamped to 1
    expect(priorityScore(0.5, 0.5, 0.5)).toBe(0.125);
    expect(priorityScore(-1, 1, 1)).toBe(0);
    expect(priorityScore(Number.NaN, 1, 1)).toBe(0);
  });

  it("rankActionCenter splits by bucket, orders by priority, respects the cap", () => {
    const cands = [
      cand({ bucket: "critical", impact: 1, probability: 1, urgency: 1 }),
      cand({ bucket: "critical", impact: 0.1, probability: 1, urgency: 0.1 }),
      cand({ bucket: "warning", impact: 0.9, probability: 1, urgency: 0.9 }),
      cand({ bucket: "opportunity", impact: 0.3, probability: 0.5, urgency: 0.2 }),
    ];
    const r = rankActionCenter(cands, 1);
    expect(r.critical).toHaveLength(1); // cap
    expect(r.critical[0].priority).toBe(1);
    expect(r.warning).toHaveLength(1);
    expect(r.opportunity).toHaveLength(1);
  });

  it("empty input → three empty buckets", () => {
    const r = rankActionCenter([]);
    expect(r).toEqual({ critical: [], warning: [], opportunity: [] });
  });
});
