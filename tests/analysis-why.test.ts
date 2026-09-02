import { describe, it, expect } from "vitest";
import { explainDelta } from "@/lib/analysis/why";

describe("analysis/why explainDelta", () => {
  it("decomposes a total drop into per-bucket contributions, sorted by |delta|", () => {
    const e = explainDelta({ a: 100, b: 50 }, { a: 120, b: 20 });
    expect(e.total_before).toBe(150);
    expect(e.total_after).toBe(140);
    expect(e.delta).toBe(-10);
    expect(e.contributions.map((c) => c.key)).toEqual(["b", "a"]); // |−30| > |+20|
    const b = e.contributions.find((c) => c.key === "b")!;
    const a = e.contributions.find((c) => c.key === "a")!;
    expect(b.delta).toBe(-30);
    expect(b.share).toBeCloseTo(3.0); // −30 / −10
    expect(a.share).toBeCloseTo(-2.0); // +20 / −10
    expect(e.headline).toBe("بیشترین افت از «b» است");
  });

  it("a bucket present only in the after period contributes its whole value", () => {
    const e = explainDelta({}, { x: 50 });
    expect(e.contributions).toHaveLength(1);
    expect(e.contributions[0].delta).toBe(50);
    expect(e.headline).toBe("بیشترین رشد از «x» است");
  });

  it("when the total does not move, every share is 0 and pct is 0", () => {
    const e = explainDelta({ a: 100 }, { a: 50, b: 50 });
    expect(e.delta).toBe(0);
    expect(e.pct).toBe(0);
    expect(e.contributions.every((c) => c.share === 0)).toBe(true);
    expect(e.headline).toContain("جابه‌جایی");
  });

  it("uses a label map for the headline when given", () => {
    const e = explainDelta({ g1: 10 }, { g1: 2 }, { g1: "منطقهٔ شرق" });
    expect(e.headline).toBe("بیشترین افت از «منطقهٔ شرق» است");
  });

  it("pct is delta over total_before", () => {
    const e = explainDelta({ a: 200 }, { a: 150 });
    expect(e.pct).toBeCloseTo(-0.25);
  });
});
