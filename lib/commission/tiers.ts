import { roundToman } from "../money";

/** How much a salesperson earns, when the plan is a set of tiers.
 *
 *  Pure: no database, no React, no date. This is deliberate — it is the only place in the app
 *  that decides what a person is owed, and it must be testable at every boundary in
 *  milliseconds rather than through a ledger fixture.
 *
 *  THE DEFAULT IS MARGINAL, and that is the whole point of the file. Under a marginal plan
 *  each tier pays only on the units inside it, so a rep can never earn less by delivering
 *  more. The alternative — repricing the WHOLE total once a threshold is crossed — is the
 *  "rate cliff", where 249kg pays less than 251kg. It is implemented as `cliff` because some
 *  real contracts are written that way, but it is opt-in and never inferred.
 *
 *  A legacy flat rate is not a special case here: it is a marginal plan with one tier
 *  spanning everything, which is why `lib/commissionLedger.ts` can route both through this
 *  one function rather than keeping two implementations that drift. */

/** What a plan is measured on. Mirrors `TargetMetric` in `lib/repo/targets.ts`, plus
 *  `volume_m3` and `margin_toman`, both of which are already computable per order. */
export type CommissionMetric =
  | "kg"
  | "volume_m3"
  | "revenue_toman"
  | "margin_toman"
  | "orders";

export type RateType = "flat" | "pct";

export interface Tier {
  /** Inclusive lower bound. The first tier must be 0. */
  from_value: number;
  /** Exclusive upper bound, or null for "and everything above". */
  to_value: number | null;
  rate_type: RateType;
  /** Whole Toman per unit for `flat`; whole percent for `pct`. */
  rate_value: number;
}

export type PlanMode = "marginal" | "accelerator" | "cliff";

export interface Plan {
  mode: PlanMode;
  metric: CommissionMetric;
  /** Sorted by `from_value`, contiguous, first starting at 0, last `to_value` null. */
  tiers: Tier[];
}

/** The slice of `total` that falls inside one tier. Half-open [from, to) except the last
 *  tier, which has no upper bound — so exactly 100 lands entirely in the first tier and the
 *  boundary is neither double-counted nor skipped.
 *
 *  The open-ended case is where this went wrong first. Written as
 *  `Infinity - tier.from_value` it returns `Infinity`, so every total past the first tier
 *  pays `Infinity` Toman and the whole ledger is nonsense. The correct slice for the last
 *  tier is simply what remains of `total`. The arithmetic below was run and checked before
 *  this plan was written; the boundary cases in Task 1 are what keep it that way. */
function sliceIn(tier: Tier, total: number): number {
  if (total <= tier.from_value) return 0;
  const cap = tier.to_value === null ? total : Math.min(tier.to_value, total);
  return Math.max(0, cap - tier.from_value);
}

/** The tier a total falls in, for the modes that reprice the whole amount.
 *
 *  The bound is `<=` on the upper end, not `<`, and that one character is the difference
 *  between a boundary and a cliff one kilogram early. `Tier.to_value` is documented as an
 *  EXCLUSIVE upper bound, which describes the MARGINAL slice correctly — but the whole-total
 *  modes ask a different question: "which rate does a total of exactly 100 earn?" A person
 *  who delivers exactly 100 has met the first threshold, so the first rate still applies.
 *  Reading it as exclusive handed 100 kg the SECOND rate, so cliff paid 200_000 where
 *  marginal paid 100_000 — a rep losing a month of pay by landing exactly on a number.
 *
 *  The two questions genuinely differ, so both are stated rather than reconciled: the
 *  marginal slice is half-open, and this is a "has the threshold been reached" test. */
function tierFor(plan: Plan, total: number): Tier {
  // Linear scan in tier order: a plan has a handful of tiers, and this reads in the order a
  // person would describe them, which is what makes the code auditable.
  for (const t of plan.tiers) {
    if (total >= t.from_value && (t.to_value === null || total <= t.to_value)) return t;
  }
  return plan.tiers[plan.tiers.length - 1];
}

function payFor(tier: Tier, quantity: number): number {
  return tier.rate_type === "pct" ? (quantity * tier.rate_value) / 100 : quantity * tier.rate_value;
}

/** What a plan pays for a measured `total`. Whole Toman, always.
 *
 *  SYMMETRIC IN SIGN, deliberately. `commissionLedger.ts` calls this per ORDER, and an order
 *  can be negative: a return claws back what was accrued on the line it reverses, which is
 *  how `accrualToman`'s own comment describes it. Clamping a negative total to zero would
 *  leave the original accrual standing forever, so every corrected order would drift the
 *  statement by a Toman or two and never come back. So a negative total pays the NEGATIVE
 *  of what its magnitude pays — which makes a reversal net to exactly zero through the one
 *  shared `roundToman`, as the flat path already does.
 *
 *  NaN and Infinity are refused outright: they are not a measurement, and rounding one would
 *  silently produce 0 Toman of commission for an order that should have paid. */
export function commissionFor(plan: Plan, total: number): number {
  if (!Number.isFinite(total) || total === 0) return 0;
  return total < 0 ? -commissionForMagnitude(plan, -total) : commissionForMagnitude(plan, total);
}

/** The positive case, kept apart so `commissionFor` above can state the sign rule once. */
function commissionForMagnitude(plan: Plan, total: number): number {
  if (plan.mode === "marginal") {
    let sum = 0;
    for (const tier of plan.tiers) {
      sum += payFor(tier, sliceIn(tier, total));
    }
    return roundToman(sum);
  }

  // accelerator and cliff both reprice the WHOLE total at the tier the total falls in. The
  // difference between them is what a UI must SHOW, not what this function computes: at a
  // cliff the rate jumps at a threshold, at an accelerator it is a promotion.
  const tier = tierFor(plan, total);
  return roundToman(payFor(tier, total));
}

/** The whole Toman a single unit earns at this total — for a UI that shows a rep their
 *  effective rate. At a cliff this jumps, which is exactly why the rep should see it BEFORE
 *  the boundary rather than after.
 *
 *  For a `pct` tier this reports the PERCENT, not a money figure: dividing by `total` would
 *  divide by zero at zero and would imply a Toman rate for a plan that has none. */
export function effectiveRate(plan: Plan, total: number): number {
  const tier = tierFor(plan, total);
  return tier.rate_value;
}

/** `null` when the plan is sound, or a Persian message when it is not.
 *
 *  Refusing a bad plan matters more than it looks: a plan with a gap between tiers would
 *  silently leave money unassigned, and one with an overlap would pay it twice. Both are
 *  worse than a form that will not submit. */
export function validatePlan(plan: Plan): string | null {
  if (plan.tiers.length === 0) return "پلن باید حداقل یک پله داشته باشد";
  if (plan.tiers[0].from_value !== 0) return "پله اول باید از صفر شروع شود";
  for (const t of plan.tiers) {
    if (!Number.isFinite(t.rate_value) || t.rate_value < 0) return "نرخ پول نمی‌تواند منفی باشد";
    if (t.to_value !== null && t.to_value <= t.from_value) return "هر پله باید از پله قبلی بزرگ‌تر باشد";
  }
  for (let i = 1; i < plan.tiers.length; i += 1) {
    const prev = plan.tiers[i - 1];
    const cur = plan.tiers[i];
    if (prev.to_value === null) return "تنها پله آخر می‌تواند بی‌انتها باشد";
    if (cur.from_value !== prev.to_value) return "پله‌ها باید پشت سر هم باشند، بدون فاصله یا هم‌پوشانی";
  }
  return null;
}
