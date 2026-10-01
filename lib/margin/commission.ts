import type { DatabaseSync } from "node:sqlite";
import { roundToman } from "../money";
import { effectiveAt } from "../pricing";

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

/** The company-wide per-kg rate in force on a date, or null if none has started.
 *
 * Scoped by `organization_id`, which `commission_rates` genuinely carries (it is real
 * tenant data -- a rate decides what a person is paid). Null rather than 0 when absent, so
 * the drawer can distinguish "unmeasured" from "measured as zero".
 *
 * Uses `effectiveAt` rather than a hand-rolled query, for the tie-break: on a shared start
 * date the higher id wins, so a rate corrected on the day it was entered replaces the
 * typo. Reimplementing that is exactly how `pricing.ts` warns two answers drift apart.
 */
export function readCompanyRatePerKg(
  db: DatabaseSync,
  organizationId: number,
  onDate: string
): number | null {
  const rows = db
    .prepare(
      `SELECT id, salesperson_user_id, rate_per_kg_toman, valid_from
         FROM commission_rates
        WHERE organization_id = ? AND salesperson_user_id IS NULL`
    )
    .all(organizationId) as unknown as {
    id: number;
    salesperson_user_id: number | null;
    rate_per_kg_toman: number;
    valid_from: string;
  }[];

  return effectiveAt(rows, onDate)?.rate_per_kg_toman ?? null;
}

/** A مدیر گروه's override percent in force, or null when they have none.
 *
 * `manager_commission_overrides` is NOT a per-unit cost and is deliberately kept out of
 * the margin figure: a manager's cut is a share of what their whole GROUP accrued, so
 * adding it to one product's unit cost would double-count it across every product they
 * oversee. The drawer shows it for information only.
 */
export function readManagerOverridePct(
  db: DatabaseSync,
  organizationId: number,
  managerUserId: number,
  onDate: string
): number | null {
  const rows = db
    .prepare(
      `SELECT id, manager_user_id, override_pct, valid_from
         FROM manager_commission_overrides
        WHERE organization_id = ? AND manager_user_id = ?`
    )
    .all(organizationId, managerUserId) as unknown as {
    id: number;
    manager_user_id: number;
    override_pct: number;
    valid_from: string;
  }[];

  return effectiveAt(rows, onDate)?.override_pct ?? null;
}
