import { describe, it, expect } from "vitest";
import { marginPct, rollUp, type Keyed } from "@/lib/analysis/margin";

const line = (key: string, revenue: number, cost: number, kg = 0): Keyed => ({
  key,
  label: key,
  revenue_toman: revenue,
  cost_toman: cost,
  kg,
});

describe("analysis/margin", () => {
  it("marginPct", () => {
    expect(marginPct(1000, 750)).toBe(0.25);
    expect(marginPct(0, 0)).toBe(0);
    expect(marginPct(-5, 10)).toBe(0);
    expect(marginPct(100, 120)).toBeCloseTo(-0.2);
  });

  it("rollUp merges rows with the same key", () => {
    const rows = rollUp([line("a", 100, 60, 1), line("a", 50, 30, 0.5), line("b", 40, 10, 0.2)]);
    const a = rows.find((r) => r.key === "a")!;
    expect(a.revenue_toman).toBe(150);
    expect(a.cost_toman).toBe(90);
    expect(a.kg).toBe(1.5);
    expect(a.margin_toman).toBe(60);
    expect(a.margin_pct).toBeCloseTo(0.4);
  });

  it("sorts by margin_toman desc; a loss-making row sorts last", () => {
    const rows = rollUp([line("win", 100, 10), line("mid", 100, 60), line("loss", 100, 130)]);
    expect(rows.map((r) => r.key)).toEqual(["win", "mid", "loss"]);
    expect(rows.at(-1)!.margin_toman).toBe(-30);
  });

  it("share_pct sums to 1 across rows and is 0 when total margin is 0", () => {
    const rows = rollUp([line("a", 100, 50), line("b", 200, 150)]);
    expect(rows.reduce((s, r) => s + r.share_pct, 0)).toBeCloseTo(1);

    const flat = rollUp([line("x", 100, 50), line("y", 100, 150)]); // +50 and −50 → total 0
    expect(flat.every((r) => r.share_pct === 0)).toBe(true);
  });
});
