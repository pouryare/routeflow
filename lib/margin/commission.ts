import { roundToman } from "../money";

/** What one unit of a product costs the company in commission.
 *
 * READ-ONLY, deliberately. `lib/commission.ts` and `lib/commission/tiers.ts` already
 * decide what a person is owed, and they do it once, for payroll. This module reads what
 * they say so the drawer can SHOW it; it never writes a rate and never re-derives an
 * accrual. A second implementation of the same rule is a second thing to disagree with
 * payroll, and `tiers.ts` records exactly that hazard when it absorbed flat rates as a
 * one-tier marginal plan -- one function, so there is one answer.
 *
 * WHY A PER-KILOGRAM ESTIMATE AT ALL. Commission here is paid per kilogram of goods
 * DELIVERED, not per sale: `accrualToman(kg, ratePerKgToman)`. A price has no
 * commission attached to it directly, so turning "200,000 Toman per kg" into "50,000
 * Toman per unit" needs `products.kg_per_base_unit`. Without the kilogram factor there
 * is no honest number to show at all, which is why the drawer asks for it rather than
 * guessing.
 *
 * THE HONESTY RULE. Under any tiered plan the figure depends on QUANTITY -- 3 boxes and
 * 30 boxes do not pay the same per box. So everything returned here is an estimate at one
 * unit, and the drawer labels it as such rather than presenting it as what a month of
 * selling would pay. See the "تخمین" label in MarginHelperDrawer.
 */

/** Whole Toman of commission for ONE unit, or 0 when nothing can be said.
 *
 * `kgPerBaseUnit` is `products.kg_per_base_unit`; `ratePerKgToman` is the company rate in
 * force, or null.
 *
 * Null and 0 both return 0 Toman, but they mean DIFFERENT things to the caller and the
 * difference is why the drawer can say "no rate set" instead of "commission 0":
 *
 *   - null rate  -> nobody has configured a rate. Unmeasured.
 *   - 0 rate     -> a rate of zero is a real answer (this line pays no commission).
 *
 * So the number collapses to 0 either way -- there is genuinely nothing to add to a cost
 * -- but the DRAWER must consult `readCompanyRatePerKg` for the null check and label the
 * field accordingly. Returning a richer type here would be a richer lie.
 *
 * Negative weight is honoured rather than clamped, for the reason `accrualToman` is
 * symmetric in sign: a return claws back what the sale accrued, and a rounding rule that
 * behaves differently for a negative input leaves a Toman behind on every corrected order.
 */
export function commissionForUnit(
  kgPerBaseUnit: number,
  ratePerKgToman: number | null
): number {
  if (ratePerKgToman === null || !Number.isFinite(kgPerBaseUnit)) return 0;
  return roundToman(kgPerBaseUnit * ratePerKgToman);
}

/* The READERS that go with this live in `lib/repo/commissionRates.ts`, not here.
 *
 * Not an accident of tidiness. `tests/repo-boundary.test.ts` enforces that new raw SQL
 * lives under `lib/repo/` or on an allowlist that may only shrink, and this module was
 * written after that rule -- so it gets no grandfathering, and neither would a reader
 * added to it later. The split also happens to be the right one: the arithmetic above is
 * pure and testable in milliseconds, while the queries are storage concerns scoped by
 * organisation. Re-exported here so the drawer's import stays one line per concern. */
export { companyRatePerKg as readCompanyRatePerKg } from "../repo/commissionRates";
export { managerOverridePct as readManagerOverridePct } from "../repo/commissionRates";

