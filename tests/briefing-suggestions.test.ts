import { describe, it, expect } from "vitest";
import { buildSuggestions, typicalGap } from "@/lib/briefingSuggestions";

describe("briefing suggestions", () => {
  const churn = (id: number, p: number, phone: string | null = "0912") => ({ customerId: id, name: `م${id}`, phone, probability: p, reason: null });
  const reorder = (id: number, since: number, gap: number) => ({ customerId: id, name: `م${id}`, phone: null, daysSinceLast: since, typicalGapDays: gap });

  it("returns at most three, strongest first, every one with a why", () => {
    const out = buildSuggestions({
      churn: [churn(1, 0.7), churn(2, 0.9)],
      reorder: [reorder(3, 42, 28), reorder(4, 60, 20), reorder(5, 30, 28)],
    });
    expect(out).toHaveLength(3);
    expect(out[0].customerId).toBe(2);
    for (const s of out) expect(s.why.length).toBeGreaterThan(5);
  });
  it("a reorder reason states the numbers in Persian digits", () => {
    const [s] = buildSuggestions({ churn: [], reorder: [reorder(3, 42, 28)] });
    expect(s.why).toBe("آخرین سفارش ۴۲ روز پیش، معمولاً هر ۲۸ روز");
    expect(s.primary.kind).toBe("order");
  });
  it("not yet due is not suggested; a customer at risk is shown once, as churn", () => {
    expect(buildSuggestions({ churn: [], reorder: [reorder(3, 10, 28)] })).toEqual([]);
    const out = buildSuggestions({ churn: [churn(1, 0.8)], reorder: [reorder(1, 90, 30)] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("churn");
  });
  it("calls when there is a phone, and goes straight to the order when there is not", () => {
    expect(buildSuggestions({ churn: [churn(1, 0.8)], reorder: [] })[0].primary).toMatchObject({ kind: "call", href: "tel:0912" });
    expect(buildSuggestions({ churn: [churn(1, 0.8, null)], reorder: [] })[0].primary.kind).toBe("order");
  });
  it("typical gap needs three orders and uses the median", () => {
    expect(typicalGap(["2026-01-01", "2026-01-29"])).toBeNull();
    expect(typicalGap(["2026-01-01", "2026-01-29", "2026-02-26", "2026-05-01"])).toBe(28);
  });
});
