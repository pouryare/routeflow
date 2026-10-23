import type { Db } from "@/lib/database/client";

import { effectiveAt } from "@/lib/pricing";

/** Reads of the EXISTING commission tables, for the margin drawer.
 *
 *  In `lib/repo/` because that is the only place new raw SQL is allowed --
 *  `tests/repo-boundary.test.ts` fails the build for a `.prepare(` anywhere else.
 *
 *  READ-ONLY, and that is not a style preference. `lib/commission.ts` and
 *  `lib/commission/tiers.ts` already decide what a person is owed, once, for payroll. These
 *  functions exist so the drawer can SHOW what they say. There is deliberately no
 *  `setRate` here: a second way to write a payroll-affecting rate is a second thing to
 *  disagree with `lib/commissionLedger.ts`.
 *
 *  Both tables ARE tenant data -- `commission_rates` and `manager_commission_overrides`
 *  each carry `organization_id` -- unlike `product_prices`, which reaches its tenant
 *  through a product. That is why every read here takes the organisation explicitly, and
 *  why the joins are not optional decoration.
 */

/** The company-wide per-kg rate in force on a date, or null if none has started.
 *
 *  Null rather than 0 when absent, so the drawer can distinguish "unmeasured" from
 *  "measured as zero" and never renders an unconfigured rate as a commission of ۰.
 *
 *  Uses `effectiveAt` rather than a hand-rolled query, for the tie-break: on a shared
 *  start date the higher id wins, so a rate corrected on the day it was entered replaces
 *  the typo. Reimplementing that is how `pricing.ts` warns two answers drift apart.
 */
export async function companyRatePerKg(
  db: Db,
  organizationId: number,
  onDate: string
): Promise<number | null> {
  const rows = await db
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
 *  NOT a per-unit cost, and deliberately kept out of the margin figure: a manager's cut is
 *  a share of what their whole GROUP accrued, so adding it to one product's unit cost
 *  would double-count it across every product they oversee.
 */
export async function managerOverridePct(
  db: Db,
  organizationId: number,
  managerUserId: number,
  onDate: string
): Promise<number | null> {
  const rows = await db
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
