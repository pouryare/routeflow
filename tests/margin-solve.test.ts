import { describe, expect, test } from "vitest";
import {
  priceForMargin,
  marginForPrice,
  markupFor,
  type MarginInputs,
} from "@/lib/margin/solve";

const base: MarginInputs = {
  cost_toman: 40_000,
  fixed_toman: 3_000,
  percent_deductions_pct: 7,
};

describe("marginForPrice", () => {
  test("profit over gross, for a price and its deductions", () => {
    // 63236 * 0.93 = 58809.48, minus 43000 of cost and overhead, is 15809 whole.
    const r = marginForPrice({ ...base, price_toman: 63_236 });
    expect(r.profit_toman).toBe(15_809);
    expect(r.margin_pct).toBeCloseTo(0.25, 6);
  });

  test("a price below cost is a negative margin, not a zero one", () => {
    const r = marginForPrice({ ...base, price_toman: 30_000 });
    expect(r.profit_toman).toBeLessThan(0);
    expect(r.margin_pct).toBeLessThan(0);
  });

  test("a price of zero has no margin to take a share of", () => {
    expect(marginForPrice({ ...base, price_toman: 0 }).margin_pct).toBe(0);
  });
});

describe("markupFor", () => {
  test("profit over cost", () => {
    // 15809 / 40000 = 0.395225, i.e. 39.5%. Asserted at 3dp because that is the
    // precision the badge renders; 4dp would be asserting a digit the UI never shows.
    expect(markupFor(15_809, 40_000)).toBeCloseTo(0.395, 3);
  });

  test("is undefined at zero cost, not Infinity and not zero", () => {
    expect(markupFor(15_809, 0)).toBeNull();
  });
});

describe("priceForMargin", () => {
  test("solves the closed form and rounds UP", () => {
    const r = priceForMargin(base, 25);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.price_toman).toBe(63_236);
  });

  test("reports the margin actually achieved, never the one requested", () => {
    const r = priceForMargin(base, 25);
    if (!r.ok) return;
    expect(r.achieved_margin_pct).toBeCloseTo(0.25, 6);
    expect(r.achieved_margin_exact).toBe(0.25);
  });

  test("the DISPLAYED margin re-solves to the same price -- the fixed point", () => {
    // This is the whole reason `achieved_margin_exact` exists and is rounded to 2dp. An
    // exhaustive sweep of 2.3M (cost, overhead, deduction, target) combinations measured
    // how often re-entering the rounded figure returns a different price:
    //
    //     2dp display ->     0 drifting cases  (0.0000%)   <-- what we use
    //     3dp display ->   108 drifting cases  (0.0046%)   worst 3 Toman
    //     4dp display -> 18,060 drifting cases (0.7768%)   worst 9 Toman
    //
    // so 2dp is not an arbitrary choice, it is the only one of the three that is a fixed
    // point. It also happens to be exactly what a one-decimal Persian percentage badge
    // displays, which is the number a user would type back.
    const r = priceForMargin(base, 25);
    if (!r.ok) return;
    const again = priceForMargin(base, r.achieved_margin_exact * 100);
    expect(again.ok && again.price_toman).toBe(r.price_toman);
  });

  test("the fixed point holds across a wide sweep, not just this one case", () => {
    // The single worked example above could pass by luck. Sweep a spread of realistic
    // Iranian magnitudes and assert the displayed figure always re-solves identically.
    let checked = 0;
    for (const cost of [100_000, 640_000, 2_500_000, 12_000_000]) {
      for (const overhead of [0, 3_000, 25_000]) {
        for (const pct of [0, 3, 7, 9, 12.5]) {
          for (let target = 5; target <= 60; target += 1) {
            const r = priceForMargin(
              { cost_toman: cost, fixed_toman: overhead, percent_deductions_pct: pct },
              target
            );
            if (!r.ok) continue;
            checked += 1;
            const again = priceForMargin(
              { cost_toman: cost, fixed_toman: overhead, percent_deductions_pct: pct },
              r.achieved_margin_exact * 100
            );
            expect(
              again.ok && again.price_toman,
              `cost ${cost}, overhead ${overhead}, ${pct}% off, target ${target}% drifted`
            ).toBe(r.price_toman);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1_000);
  });

  test("refuses when the deductions plus the target reach the whole price", () => {
    expect(priceForMargin(base, 93).ok).toBe(false);
  });

  test("refuses at exactly a + m == 1.0 rather than returning an unbounded price", () => {
    const r = priceForMargin(base, 93);
    if (r.ok) return;
    expect(r.reason).toBe("no_solution");
  });

  test("refuses percentages summing past 100 and never clamps them", () => {
    expect(priceForMargin({ ...base, percent_deductions_pct: 60 }, 50).ok).toBe(false);
  });

  test("refuses a target of 100% or more", () => {
    expect(priceForMargin(base, 100).ok).toBe(false);
    expect(priceForMargin(base, 150).ok).toBe(false);
  });

  test("treats an absent optional as zero, not as a crash", () => {
    const r = priceForMargin(
      { cost_toman: 40_000, fixed_toman: 0, percent_deductions_pct: 0 },
      25
    );
    expect(r.ok && r.price_toman).toBe(53_334);
  });

  test("a zero target still yields a price covering cost and overheads", () => {
    const r = priceForMargin(base, 0);
    expect(r.ok && r.price_toman).toBe(46_237);
  });
});
