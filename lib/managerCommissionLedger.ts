/** What a مدیر گروه earns: a share of what their whole group accrued.
 *
 *  Not a per-kilogram rate -- a manager does not sell or deliver anything themself, so
 *  there is no weight to multiply. Their override is a percentage of the group's total
 *  فروشنده commission for the period, resolved the same effective-dated way as every
 *  other rate in this file and then applied on top of commissionLedger.allStatements,
 *  which is already the one place that sums a group's accrual -- this never recomputes
 *  that sum a second way.
 */

import { insertCommissionPayment, insertDatedRate } from "./repo/commissionPayments";
import type { Db } from "@/lib/database/client";
import { effectiveAt } from "./pricing";
import { allStatements, type Period } from "./commissionLedger";
import { roundToman } from "./money";
import { orgClause } from "./orgScope";

import { mapSeq } from "@/lib/seq";
export interface ManagerOverrideRow {
  id: number;
  /** Null is the company-wide default, same convention as the other rate tables. */
  manager_user_id: number | null;
  override_pct: number;
  valid_from: string;
}

export function overrideFor(
  rows: ManagerOverrideRow[],
  managerId: number | null,
  onDate: string
): ManagerOverrideRow | null {
  const personal = managerId === null ? [] : rows.filter((r) => r.manager_user_id === managerId);
  return (
    effectiveAt(personal, onDate) ??
    effectiveAt(
      rows.filter((r) => r.manager_user_id === null),
      onDate
    )
  );
}

export interface ManagerStatement {
  manager_user_id: number;
  display_name: string;
  group_id: number | null;
  group_name: string | null;
  /** What the whole group's فروشنده‌ها accrued this period -- the base the override
   *  percentage is taken from. */
  group_accrued_toman: number;
  override_pct: number;
  accrued_toman: number;
  paid_toman: number;
  owed_toman: number;
}

export async function setManagerOverride(
  db: Db,
  input: {
    manager_user_id?: number | null;
    override_pct: number;
    valid_from: string;
    created_by?: number | null;
  }
): Promise<number> {
  if (!Number.isFinite(input.override_pct) || input.override_pct < 0 || input.override_pct > 100) {
    throw new TypeError(`درصد پورسانت مدیر باید بین ۰ و ۱۰۰ باشد: ${input.override_pct}`);
  }
  return await insertDatedRate(db, "manager", input.manager_user_id, input.override_pct, input);
}

export async function recordManagerPayment(
  db: Db,
  input: {
    manager_user_id: number;
    amount_toman: number;
    paid_on: string;
    period_from?: string | null;
    period_to?: string | null;
    notes?: string | null;
    created_by?: number | null;
  }
): Promise<number> {
  return await insertCommissionPayment(db, "manager", input.manager_user_id, input, false);
}

export async function readManagerOverrides(
  db: Db,
  organizationId: number
): Promise<(ManagerOverrideRow & { display_name: string | null })[]> {
  return await db
    .prepare(
      `SELECT mco.*, u.display_name
         FROM manager_commission_overrides mco
         LEFT JOIN users u ON u.id = mco.manager_user_id
        WHERE mco.organization_id = ?
        ORDER BY mco.valid_from DESC, mco.id DESC`
    )
    .all(organizationId) as unknown as (ManagerOverrideRow & { display_name: string | null })[];
}

export async function managerStatementFor(
  db: Db,
  managerId: number,
  period: Period
): Promise<ManagerStatement> {
  const person = await db
    .prepare(
      `SELECT u.id, u.display_name, u.group_id, u.organization_id, g.name AS group_name
         FROM users u LEFT JOIN groups g ON g.id = u.group_id
        WHERE u.id = ?`
    )
    .get(managerId) as
    | { id: number; display_name: string; group_id: number | null; organization_id: number; group_name: string | null }
    | undefined;

  // A manager with no group has no team to earn a share of -- zero rather than a group
  // sum error, the same "empty means nothing" rule allStatements enforces.
  const periodOrders =
    person?.group_id == null ? [] : (await allStatements(db, period, { groupId: person.group_id, organizationId: person.organization_id })).flatMap((s) => s.orders);
  const groupAccrued = periodOrders.reduce((total, o) => total + o.accrual_toman, 0);

  const overrides = await db
    .prepare("SELECT * FROM manager_commission_overrides")
    .all() as unknown as ManagerOverrideRow[];
  // Valued order by order at the override in force on ITS OWN date, same reasoning as
  // the lifetime figure below -- a mid-period raise must not silently reprice the
  // orders that accrued before it.
  const accrued = roundToman(
    periodOrders.reduce((total, o) => {
      const r = overrideFor(overrides, managerId, o.order_date);
      return total + (o.accrual_toman * (r?.override_pct ?? 0)) / 100;
    }, 0)
  );
  // The percentage shown on the card: whatever applies today, since a single number
  // cannot represent a mix of rates that changed mid-period.
  const pct = overrideFor(overrides, managerId, period.to)?.override_pct ?? 0;

  const paidInPeriod = await db
    .prepare(
      "SELECT COALESCE(SUM(amount_toman), 0) AS total FROM manager_commission_payments WHERE manager_user_id = ? AND paid_on BETWEEN ? AND ?"
    )
    .get(managerId, period.from.slice(0, 10), period.to.slice(0, 10)) as { total: number };

  // Lifetime owed needs each historical order valued at the override in force on ITS
  // OWN date, not at whatever override applies today -- a raise given this month must
  // not silently reprice every override accrued before it, the same rule commission
  // rates and product prices already follow. allStatements already carries the dated
  // order_date/accrual_toman pairs behind the group total, so this reuses those rather
  // than re-deriving them.
  const lifetimeAccrued =
    person?.group_id == null
      ? 0
      : roundToman(
          (await allStatements(db, { from: "0000-01-01", to: "9999-12-31" }, { groupId: person.group_id, organizationId: person.organization_id }))
            .flatMap((s) => s.orders)
            .reduce((total, o) => {
              const r = overrideFor(overrides, managerId, o.order_date);
              return total + (o.accrual_toman * (r?.override_pct ?? 0)) / 100;
            }, 0)
        );
  const lifetimePaid = await db
    .prepare("SELECT COALESCE(SUM(amount_toman), 0) AS total FROM manager_commission_payments WHERE manager_user_id = ?")
    .get(managerId) as { total: number };

  return {
    manager_user_id: managerId,
    display_name: person?.display_name ?? "—",
    group_id: person?.group_id ?? null,
    group_name: person?.group_name ?? null,
    group_accrued_toman: groupAccrued,
    override_pct: pct,
    accrued_toman: accrued,
    paid_toman: paidInPeriod.total,
    owed_toman: lifetimeAccrued - lifetimePaid.total,
  };
}

export async function allManagerStatements(db: Db, period: Period, organizationId: number | null): Promise<ManagerStatement[]> {
  const org = orgClause("organization_id", organizationId);
  const people = await db
    .prepare(`SELECT id FROM users WHERE role = 'group_manager'${org.sql} ORDER BY display_name`)
    .all(...org.params) as unknown as { id: number }[];
  return await mapSeq(people, async (person) => await managerStatementFor(db, person.id, period));
}
