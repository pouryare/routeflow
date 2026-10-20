/** What a مدیر گروه earns: a share of what their whole group accrued.
 *
 *  Not a per-kilogram rate -- a manager does not sell or deliver anything themself, so
 *  there is no weight to multiply. Their override is a percentage of the group's total
 *  فروشنده commission for the period, resolved the same effective-dated way as every
 *  other rate in this file and then applied on top of commissionLedger.allStatements,
 *  which is already the one place that sums a group's accrual -- this never recomputes
 *  that sum a second way.
 */

import { orgOfUser } from "./repo/userOrg";
import type { DatabaseSync } from "node:sqlite";
import { effectiveAt } from "./pricing";
import { allStatements, type Period } from "./commissionLedger";
import { roundToman } from "./money";

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

export function setManagerOverride(
  db: DatabaseSync,
  input: {
    manager_user_id?: number | null;
    override_pct: number;
    valid_from: string;
    created_by?: number | null;
  }
): number {
  if (!Number.isFinite(input.override_pct) || input.override_pct < 0 || input.override_pct > 100) {
    throw new TypeError(`درصد پورسانت مدیر باید بین ۰ و ۱۰۰ باشد: ${input.override_pct}`);
  }
  return Number(
    db
      .prepare(
        `INSERT INTO manager_commission_overrides (manager_user_id, override_pct, valid_from, created_by, created_at,
                                                   organization_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.manager_user_id ?? null,
        input.override_pct,
        input.valid_from.slice(0, 10),
        input.created_by ?? null,
        new Date().toISOString(),
        orgOfUser(db, input.manager_user_id, input.created_by)
      ).lastInsertRowid
  );
}

export function recordManagerPayment(
  db: DatabaseSync,
  input: {
    manager_user_id: number;
    amount_toman: number;
    paid_on: string;
    period_from?: string | null;
    period_to?: string | null;
    notes?: string | null;
    created_by?: number | null;
  }
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO manager_commission_payments (manager_user_id, amount_toman, paid_on,
                                                   period_from, period_to, notes, created_by, created_at,
                                                   organization_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.manager_user_id,
        input.amount_toman,
        input.paid_on.slice(0, 10),
        input.period_from?.slice(0, 10) ?? null,
        input.period_to?.slice(0, 10) ?? null,
        input.notes ?? null,
        input.created_by ?? null,
        new Date().toISOString(),
        orgOfUser(db, input.manager_user_id, input.created_by)
      ).lastInsertRowid
  );
}

export function readManagerOverrides(
  db: DatabaseSync,
  organizationId: number
): (ManagerOverrideRow & { display_name: string | null })[] {
  return db
    .prepare(
      `SELECT mco.*, u.display_name
         FROM manager_commission_overrides mco
         LEFT JOIN users u ON u.id = mco.manager_user_id
        WHERE mco.organization_id = ?
        ORDER BY mco.valid_from DESC, mco.id DESC`
    )
    .all(organizationId) as unknown as (ManagerOverrideRow & { display_name: string | null })[];
}

export function managerStatementFor(
  db: DatabaseSync,
  managerId: number,
  period: Period
): ManagerStatement {
  const person = db
    .prepare(
      `SELECT u.id, u.display_name, u.group_id, g.name AS group_name
         FROM users u LEFT JOIN groups g ON g.id = u.group_id
        WHERE u.id = ?`
    )
    .get(managerId) as
    | { id: number; display_name: string; group_id: number | null; group_name: string | null }
    | undefined;

  // A manager with no group has no team to earn a share of -- zero rather than a group
  // sum error, the same "empty means nothing" rule allStatements enforces.
  const periodOrders =
    person?.group_id == null ? [] : allStatements(db, period, { groupId: person.group_id }).flatMap((s) => s.orders);
  const groupAccrued = periodOrders.reduce((total, o) => total + o.accrual_toman, 0);

  const overrides = db
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

  const paidInPeriod = db
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
          allStatements(db, { from: "0000-01-01", to: "9999-12-31" }, { groupId: person.group_id })
            .flatMap((s) => s.orders)
            .reduce((total, o) => {
              const r = overrideFor(overrides, managerId, o.order_date);
              return total + (o.accrual_toman * (r?.override_pct ?? 0)) / 100;
            }, 0)
        );
  const lifetimePaid = db
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

export function allManagerStatements(db: DatabaseSync, period: Period): ManagerStatement[] {
  const people = db
    .prepare("SELECT id FROM users WHERE role = 'group_manager' ORDER BY display_name")
    .all() as unknown as { id: number }[];
  return people.map((person) => managerStatementFor(db, person.id, period));
}
