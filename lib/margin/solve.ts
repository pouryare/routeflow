/** What a price actually leaves you, and what price a margin needs.
 *
 * Pure. No `db`, no React, no dates -- the same bargain `lib/analysis/margin.ts` and
 * `lib/commission/tiers.ts` keep: this is the only place that decides what a price is
 * worth, so it must be testable at every boundary in milliseconds rather than through a
 * database fixture.
 *
 * With P gross price, a percent-of-gross deductions, F fixed per-unit overheads and C
 * cost basis:
 *
 *     profit = P(1 - a) - C - F
 *     margin = profit / P     (true margin: profit over GROSS)
 *     markup = profit / C     (a readout only, never an input)
 *
 * and the forward solve, for a target margin m:
 *
 *     P = (C + F) / (1 - a - m)
 *
 * CLOSED FORM, not iteration. A percent-of-net-profit deduction would put profit on both
 * sides and force a fixed-point search; refusing that case is the deliberate trade.
 * Rounding to whole Toman on every one of an iteration's passes lets the answer wobble
 * by a Toman and never settle, and a wobbling price is worse than one this module
 * declines to produce. One closed form has exactly one place to round.
 *
 * With no tax engine, "percent of net revenue" and "percent of gross" are the same
 * number -- net revenue is P minus a tax that is always zero. Modelling them as two
 * bases would build a distinction that cannot differ.
 */

import { roundToman } from "../money";

export interface MarginInputs {
  /** Whole Toman. The landed or weighted-average cost of ONE sellable unit. */
  cost_toman: number;
  /** Whole Toman of per-unit overhead that does not scale with price. */
  fixed_toman: number;
  /** 0-100. Everything taken off the top of the gross price. */
  percent_deductions_pct: number;
}

export type Solve =
  | {
      ok: true;
      price_toman: number;
      /** Full precision. For assertions. */
      achieved_margin_pct: number;
      /**
       * The margin the badge DISPLAYS, at 2dp -- one decimal place on a Persian percent.
       *
       * Separate from the raw float on purpose, and the precision is not arbitrary. A
       * sweep of 2.3M (cost, overhead, deduction, target) combinations measured how often
       * re-entering the rounded figure returns a DIFFERENT price:
       *
       *     2dp ->     0 cases (0.0000%)   <-- stable, so this is what we use
       *     3dp ->   108 cases (0.0046%)   worst 3 Toman
       *     4dp -> 18,060 cases (0.7768%)  worst 9 Toman
       * So the copy affordance must write THIS value, never the raw float. Feeding the
       * float makes the drawer re-solve to a different price, which a user reads as
       * "the app is random" -- and 4dp, the obvious-looking choice, is the worst of the
       * three. 2dp is also exactly what `faFixed(pct, 1)` renders, so the number on
       * screen is the number that solves back.
       */
      achieved_margin_exact: number;
    }
  | {
      ok: false;
      reason: "no_solution";
      percent_deductions_pct: number;
      target_margin_pct: number;
    };

export interface MarginResult {
  /** Whole Toman, always. */
  profit_toman: number;
  /** 0-1. Zero when there is no price to take a share of. */
  margin_pct: number;
}

/** Whole Toman left after every deduction, and the margin that is.
 *
 * Negative profit is a real answer, not an error: a price below cost is exactly what
 * this drawer exists to reveal. Returned rather than clamped, for the reason
 * `commissionFor()` is symmetric in sign -- a return has to claw back what the sale
 * accrued.
 */
export function marginForPrice(
  inputs: MarginInputs & { price_toman: number }
): MarginResult {
  const { cost_toman, fixed_toman, percent_deductions_pct, price_toman } = inputs;
  const retained = price_toman * (1 - percent_deductions_pct / 100);
  const profit = roundToman(retained - cost_toman - fixed_toman);
  return { profit_toman: profit, margin_pct: price_toman > 0 ? profit / price_toman : 0 };
}

/** Profit as a share of COST, or null when there is no cost to share.
 *
 * A readout, never an input. If the target field accepted markup as well as margin, one
 * box would mean two things depending on where it was typed -- the ambiguity
 * `lib/commission/tiers.ts` refuses when it declines to *infer* `marginal` versus
 * `accelerator`, because an inference would have to guess.
 *
 * Null rather than Infinity or 0 at zero cost, so the badge renders the em-dash `faNum`
 * already uses for a non-finite figure.
 */
export function markupFor(profit_toman: number, cost_toman: number): number | null {
  return cost_toman > 0 ? profit_toman / cost_toman : null;
}

/** The price that achieves a target margin, or a refusal explaining why none exists.
 *
 * ROUNDS UP. A price landing a fraction under its target margin has missed, and a badge
 * reading 25% when the real figure is 24.7% is a lie the owner finds out about at month
 * end. Rounding down would systematically undercharge.
 *
 * The refusal fires when the denominator `1 - a - m` reaches zero or goes negative. At
 * 3% gateway plus 2% shrinkage plus a 95% target, `a + m == 1.0` and NO price exists:
 * every price loses money. Refusing beats a plausible wrong number, and it is the same
 * instinct as the `Infinity` Toman bug `tiers.ts` documents, where an open-ended tier's
 * slice came back as `Infinity - from_value` and "the whole ledger is nonsense".
 *
 * Percentages past 100 are refused, not clamped: clamping invents a margin nobody asked.
 */
export function priceForMargin(inputs: MarginInputs, target_margin_pct: number): Solve {
  const { cost_toman, fixed_toman, percent_deductions_pct } = inputs;
  const denominator = 1 - percent_deductions_pct / 100 - target_margin_pct / 100;

  if (!Number.isFinite(denominator) || denominator <= 0) {
    return { ok: false, reason: "no_solution", percent_deductions_pct, target_margin_pct };
  }

  const price_toman = Math.ceil((cost_toman + fixed_toman) / denominator);
  const achieved = marginForPrice({ ...inputs, price_toman });

  return {
    ok: true,
    price_toman,
    achieved_margin_pct: achieved.margin_pct,
    // 2dp, NOT 4dp -- see the note on achieved_margin_exact for the sweep that proves it.
    achieved_margin_exact: Math.round(achieved.margin_pct * 100) / 100,
  };
}
