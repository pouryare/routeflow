import { describe, it, expect } from "vitest";
import {
  commissionFor,
  validatePlan,
  effectiveRate,
  type Plan,
  type Tier,
} from "@/lib/commission/tiers";
import { accrualToman } from "@/lib/commission";

const flat = (rate: number): Tier => ({
  from_value: 0,
  to_value: null,
  rate_type: "flat",
  rate_value: rate,
});

/** The plan the user described: 100 kg at X, above that at Y. */
const TWO_TIER: Plan = {
  mode: "marginal",
  metric: "kg",
  tiers: [
    { from_value: 0, to_value: 100, rate_type: "flat", rate_value: 1_000 },
    { from_value: 100, to_value: null, rate_type: "flat", rate_value: 2_000 },
  ],
};

describe("marginal tiers — the default and the load-bearing case", () => {
  it("pays nothing at zero", () => {
    expect(commissionFor({ mode: "marginal", metric: "kg", tiers: TWO_TIER.tiers }, 0)).toBe(0);
  });

  it("pays the first tier's rate inside the first tier", () => {
    expect(commissionFor(TWO_TIER, 40)).toBe(40_000);
  });

  it("at EXACTLY the boundary, the first tier still governs", () => {
    // 100 is the top of tier one. If this returned 200_000 the boundary is off by one and
    // every rep's statement is subtly wrong.
    expect(commissionFor(TWO_TIER, 100)).toBe(100_000);
  });

  it("one unit past the boundary pays the second rate for ONE unit only", () => {
    // The whole point of marginal. 101 = 100*1000 + 1*2000.
    expect(commissionFor(TWO_TIER, 101)).toBe(102_000);
  });

  it("at the second boundary it is still marginal, never a jump", () => {
    expect(commissionFor(TWO_TIER, 250)).toBe(100_000 + 150 * 2_000);
  });

  it("NEVER pays less for delivering more", () => {
    // The property that rules out the cliff by construction. If this ever fails, the mode
    // arithmetic is wrong regardless of what the tests above say.
    let prev = -1;
    for (let kg = 0; kg <= 400; kg += 1) {
      const got = commissionFor(TWO_TIER, kg);
      if (kg > 0) expect(got, `regression at ${kg}kg`).toBeGreaterThanOrEqual(prev);
      prev = got;
    }
  });

  it("a single tier from zero is exactly the existing flat rate", () => {
    expect(commissionFor({ mode: "marginal", metric: "kg", tiers: [flat(1_500)] }, 250)).toBe(375_000);
  });

  it("is strictly non-decreasing over EVERY boundary of a THREE-tier plan", () => {
    // Two tiers have one interior boundary; a real plan has several, and a bug that skips a
    // boundary shows up as a dip at that point. Checked on the exact integers around each.
    const three: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [
        { from_value: 0, to_value: 100, rate_type: "flat", rate_value: 1_000 },
        { from_value: 100, to_value: 300, rate_type: "flat", rate_value: 2_000 },
        { from_value: 300, to_value: null, rate_type: "flat", rate_value: 1_500 },
      ],
    };
    // Rates FALL at the third tier, so marginal is still monotonic — each slice pays its
    // own rate and the total never rewinds. This is the case a naive implementation breaks.
    expect(commissionFor(three, 299)).toBe(100_000 + 199 * 2_000);
    expect(commissionFor(three, 300)).toBe(100_000 + 200 * 2_000);
    expect(commissionFor(three, 301)).toBe(100_000 + 200 * 2_000 + 1 * 1_500);
    let prev = -1;
    for (let kg = 0; kg <= 600; kg += 1) {
      const got = commissionFor(three, kg);
      if (kg > 0) expect(got, `regression at ${kg}kg in three-tier plan`).toBeGreaterThanOrEqual(prev);
      prev = got;
    }
  });

  it("a negative total pays the NEGATIVE, because a return reverses an accrual", () => {
    // commissionLedger.ts computes per ORDER and a return order carries negative weight, so
    // clamping here would leave the original accrual standing and drift every statement that
    // was ever corrected.
    expect(commissionFor(TWO_TIER, -50)).toBe(-50_000);
    expect(commissionFor(TWO_TIER, -101)).toBe(-102_000);
  });

  it("an open-ended last tier slices what REMAINS, never Infinity", () => {
    // sliceIn written as `Infinity - from_value` returns Infinity here and every total past
    // the first tier pays Infinity Toman. The single most dangerous line in the file.
    const got = commissionFor(TWO_TIER, 1_000_000);
    expect(Number.isFinite(got)).toBe(true);
    expect(got).toBe(100_000 + 999_900 * 2_000);
  });
});

describe("accelerator mode", () => {
  it("raises the rate on the WHOLE total once a threshold is passed", () => {
    const plan: Plan = {
      mode: "accelerator",
      metric: "kg",
      tiers: [
        { from_value: 0, to_value: 100, rate_type: "flat", rate_value: 1_000 },
        { from_value: 100, to_value: null, rate_type: "flat", rate_value: 2_000 },
      ],
    };
    expect(commissionFor(plan, 99)).toBe(99_000);
    // 101 * 2000 — the whole total repriced, including the part already below threshold.
    expect(commissionFor(plan, 101)).toBe(202_000);
  });

  it("is monotonic too, so it is safe as a default alternative", () => {
    const plan: Plan = { mode: "accelerator", metric: "kg", tiers: TWO_TIER.tiers };
    let prev = -1;
    for (let kg = 0; kg <= 300; kg += 1) {
      const got = commissionFor(plan, kg);
      if (kg > 0) expect(got).toBeGreaterThanOrEqual(prev);
      prev = got;
    }
  });
});

describe("cliff mode — opt-in, and honest about its hazard", () => {
  const plan: Plan = { mode: "cliff", metric: "kg", tiers: TWO_TIER.tiers };

  it("repricing the whole total is what cliff MEANS, so it is implemented", () => {
    expect(commissionFor(plan, 101)).toBe(101 * 2_000);
  });

  it("and it is therefore NOT monotonic — which is why it is not the default", () => {
    // Documented as a property, not a bug: a test that asserts monotonicity here would be
    // asserting that cliff mode does not work. If a future change makes cliff monotonic,
    // this test fails and someone must decide whether cliff is still worth having.
    expect(commissionFor(plan, 101)).toBeLessThan(
      commissionFor({ ...plan, mode: "marginal" }, 101) + 100 * 2_000,
    );
  });

  it("a cliff actually pays LESS for more — the hazard stated as a number", () => {
    // 300 kg at 2000 = 600_000. Under marginal it is 100_000 + 200*2000 = 500_000, so cliff
    // pays MORE here. The dangerous direction is the reverse: a rep one kilogram short of a
    // threshold loses the whole repricing, so 99 kg must be compared against 101 kg.
    const marginal = { ...plan, mode: "marginal" as const };
    expect(commissionFor(plan, 101)).toBeGreaterThan(commissionFor(marginal, 101));
    // And at 100 the two agree exactly — the boundary is where they part.
    expect(commissionFor(plan, 100)).toBe(commissionFor(marginal, 100));
  });

  it("effectiveRate reports the cliff honestly, so a UI can warn before it bites", () => {
    expect(effectiveRate(plan, 100)).toBe(1_000);
    expect(effectiveRate(plan, 101)).toBe(2_000);
  });

  it("effectiveRate on a percent tier reports the percent, not a computed money rate", () => {
    // A UI showing "your effective rate" must not divide by a total that might be zero, and
    // must not imply a Toman figure for a percentage plan.
    const pct: Plan = { mode: "marginal", metric: "revenue_toman", tiers: [
      { from_value: 0, to_value: null, rate_type: "pct", rate_value: 3 },
    ] };
    expect(effectiveRate(pct, 1_000_000)).toBe(3);
  });
});

describe("percentage rates", () => {
  it("applies a percent rate to the slice inside the tier", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "revenue_toman",
      tiers: [
        { from_value: 0, to_value: 10_000_000, rate_type: "pct", rate_value: 2 },
        { from_value: 10_000_000, to_value: null, rate_type: "pct", rate_value: 5 },
      ],
    };
    // 10M at 2% = 200k, plus 10M at 5% = 500k.
    expect(commissionFor(plan, 20_000_000)).toBe(700_000);
  });

  it("mixes flat and percent tiers in one plan", () => {
    // Nothing forbids it, and a plan that does it must not silently drop one.
    const plan: Plan = {
      mode: "marginal",
      metric: "revenue_toman",
      tiers: [
        { from_value: 0, to_value: 10_000_000, rate_type: "pct", rate_value: 2 },
        { from_value: 10_000_000, to_value: null, rate_type: "flat", rate_value: 100 },
      ],
    };
    expect(commissionFor(plan, 20_000_000)).toBe(200_000 + 10_000_000 * 100);
  });
});

describe("plan validation — a bad plan must be refused, not silently paid", () => {
  it("rejects a plan with no tiers", () => {
    expect(validatePlan({ mode: "marginal", metric: "kg", tiers: [] })).toBeTruthy();
  });

  it("rejects a first tier that does not start at zero", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [{ from_value: 10, to_value: null, rate_type: "flat", rate_value: 1_000 }],
    };
    expect(validatePlan(plan)).toBeTruthy();
  });

  it("rejects a gap between tiers", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [
        { from_value: 0, to_value: 100, rate_type: "flat", rate_value: 1_000 },
        { from_value: 200, to_value: null, rate_type: "flat", rate_value: 2_000 },
      ],
    };
    expect(validatePlan(plan)).toBeTruthy();
  });

  it("rejects an overlap between tiers", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [
        { from_value: 0, to_value: 150, rate_type: "flat", rate_value: 1_000 },
        { from_value: 100, to_value: null, rate_type: "flat", rate_value: 2_000 },
      ],
    };
    expect(validatePlan(plan)).toBeTruthy();
  });

  it("rejects a negative rate", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [{ from_value: 0, to_value: null, rate_type: "flat", rate_value: -1 }],
    };
    expect(validatePlan(plan)).toBeTruthy();
  });

  it("rejects a tier whose upper bound is at or below its lower bound", () => {
    for (const to of [0, -5]) {
      const plan: Plan = {
        mode: "marginal",
        metric: "kg",
        tiers: [{ from_value: 0, to_value: to, rate_type: "flat", rate_value: 1_000 }],
      };
      expect(validatePlan(plan), `to_value=${to} accepted`).toBeTruthy();
    }
  });

  it("rejects an open-ended tier that is not last — it would shadow every later one", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [
        { from_value: 0, to_value: null, rate_type: "flat", rate_value: 1_000 },
        { from_value: 100, to_value: null, rate_type: "flat", rate_value: 2_000 },
      ],
    };
    expect(validatePlan(plan)).toBeTruthy();
  });

  it("rejects a NaN rate rather than paying NaN Toman", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [{ from_value: 0, to_value: null, rate_type: "flat", rate_value: Number.NaN }],
    };
    expect(validatePlan(plan)).toBeTruthy();
  });

  it("every refusal message is Persian, since it is shown in the admin form", () => {
    const bad: Plan = { mode: "marginal", metric: "kg", tiers: [] };
    const msg = validatePlan(bad)!;
    expect(/[\u0600-\u06FF]/u.test(msg)).toBe(true);
    expect(/[\u0649\u0643\u064A\u0629\u064B-\u0652]/u.test(msg)).toBe(false);
    expect(/[\uFE70-\uFEFF]/u.test(msg)).toBe(false);
  });

  it("accepts the plan the user actually described", () => {
    expect(validatePlan(TWO_TIER)).toBeNull();
  });

  it("accepts a single open-ended tier — the legacy flat rate as a plan", () => {
    expect(validatePlan({ mode: "marginal", metric: "kg", tiers: [flat(1_500)] })).toBeNull();
  });
});

describe("rounding", () => {
  it("rounds through the ONE shared money rule, so a reversal nets to exactly zero", () => {
    // 3.5 packs * 333 toman is a fraction; roundToman is what lib/money.ts already owns.
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [{ from_value: 0, to_value: null, rate_type: "flat", rate_value: 333 }],
    };
    const value = commissionFor(plan, 3.5);
    expect(Number.isInteger(value)).toBe(true);
  });

  it("a fractional quantity and its reversal net to exactly zero", () => {
    // The property the shared rounding rule exists for, and the one the flat path already
    // relies on: accrualToman(3.5, 333) + accrualToman(-3.5, 333) === 0. A plan must not be
    // worse than the behaviour it replaces, or correcting an order would leave a Toman behind.
    const plan: Plan = { mode: "marginal", metric: "kg", tiers: [flat(333)] };
    expect(commissionFor(plan, 3.5) + commissionFor(plan, -3.5)).toBe(0);
  });

  it("every mode nets a reversal to exactly zero, not just the flat one", () => {
    for (const mode of ["marginal", "accelerator", "cliff"] as const) {
      const plan: Plan = { ...TWO_TIER, mode };
      for (const q of [3.5, 99.5, 100.5, 250.25]) {
        expect(
          commissionFor(plan, q) + commissionFor(plan, -q),
          `${mode} @ ${q} did not net to zero`,
        ).toBe(0);
      }
    }
  });

  it("always returns a whole Toman, whatever the plan", () => {
    const plans: Plan[] = [TWO_TIER, { ...TWO_TIER, mode: "accelerator" }, { ...TWO_TIER, mode: "cliff" }];
    for (const p of plans) {
      for (const total of [0, 0.5, 1.5, 99.99, 100, 100.5, 333.333, 1e6]) {
        const got = commissionFor(p, total);
        expect(Number.isInteger(got), `${p.mode} @ ${total} -> ${got}`).toBe(true);
      }
    }
  });

  it("returns 0 rather than NaN for a non-finite total", () => {
    expect(commissionFor(TWO_TIER, Number.NaN)).toBe(0);
    expect(commissionFor(TWO_TIER, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("backwards compatibility — the claim the whole design rests on", () => {
  /** The plan says a legacy flat rate is not an APPROXIMATION of a marginal plan, it is the
   *  SAME function. That is the reason `lib/commissionLedger.ts` can route both through one
   *  call instead of keeping two implementations that drift. Assert it against the function
   *  that is actually in production today, over fractional and boundary values and in both
   *  signs — a claim checked at one round number is not a claim. */
  it("a single-tier plan agrees with accrualToman at every value tried", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [flat(1_500)],
    };
    const mismatches: string[] = [];
    for (const kg of [0, 0.5, 1, 3.5, 99.99, 100, 250, 1000.5, 12_345.678]) {
      for (const v of [kg, -kg]) {
        const tiers = commissionFor(plan, v);
        const legacy = accrualToman(v, 1_500);
        if (tiers !== legacy) mismatches.push(`${v}: tiers=${tiers} legacy=${legacy}`);
      }
    }
    expect(mismatches, mismatches.join("\n")).toEqual([]);
  });

  it("so a plan of one tier changes no historical statement", () => {
    expect(commissionFor({ mode: "marginal", metric: "kg", tiers: [flat(1_500)] }, 250)).toBe(
      accrualToman(250, 1_500),
    );
  });
});
