import { getDb } from "@/lib/db";
import type { DatabaseSync } from "node:sqlite";

import {
  validatePlan,
  type Plan,
  type Tier,
  type PlanMode,
  type CommissionMetric,
  type RateType,
} from "@/lib/commission/tiers";
import { effectiveAt } from "@/lib/pricing";

/** Storage for tiered commission plans, effective-dated exactly like `commission_rates`.
 *
 *  Every read is filtered by `organization_id` because the table IS tenant data — unlike
 *  `districts` or `holidays`. A plan decides what a person is paid, so one tenant reading
 *  another's plan is a payroll disclosure, not a cosmetic bug.
 *
 *  The date rule is `effectiveAt` from lib/pricing.ts, the same one `rateFor` uses in
 *  lib/commission.ts. Reused rather than reimplemented: the tie-break on a shared start date
 *  (higher id wins, so a figure corrected on the day it was entered replaces the typo) is
 *  fiddly, and a second copy of it is a second thing to get wrong. */

export interface TierRow {
  id: number;
  salesperson_user_id: number | null;
  organization_id: number;
  mode: PlanMode;
  metric: CommissionMetric;
  from_value: number;
  to_value: number | null;
  rate_type: RateType;
  rate_value: number;
  valid_from: string;
}

/** A whole plan, reassembled from its rows. */
export interface StoredPlan extends Plan {
  valid_from: string;
  salesperson_user_id: number | null;
  organization_id: number;
}

const toTier = (r: TierRow): Tier => ({
  from_value: r.from_value,
  to_value: r.to_value,
  rate_type: r.rate_type,
  rate_value: r.rate_value,
});

function toPlan(rows: TierRow[]): StoredPlan | null {
  const first = rows[0];
  if (!first) return null;
  // Sorted by id, which is insertion order, which is the order an admin typed the tiers in.
  // Ordering by `from_value` would be equivalent for a valid plan AND would silently
  // paper over a gap, so the ordering that validation checks is not the one relied on here.
  const ordered = [...rows].sort((a, b) => a.id - b.id);
  return {
    mode: first.mode,
    metric: first.metric,
    tiers: ordered.map(toTier),
    valid_from: first.valid_from,
    salesperson_user_id: first.salesperson_user_id,
    organization_id: first.organization_id,
  };
}

const SELECT_COLS = `id, salesperson_user_id, organization_id, mode, metric, from_value,
       to_value, rate_type, rate_value, valid_from`;

function rowsFor(
  db: DatabaseSync,
  organizationId: number,
  salespersonId: number | null,
): TierRow[] {
  return db
    .prepare(
      `SELECT ${SELECT_COLS} FROM commission_tiers
        WHERE organization_id = ? AND salesperson_user_id IS ?
        ORDER BY id`,
    )
    .all(organizationId, salespersonId) as unknown as TierRow[];
}

/** All the tier rows sharing one plan's start date. */
const atStart = (rows: TierRow[], start: TierRow): TierRow[] =>
  rows.filter((r) => r.valid_from.slice(0, 10) === start.valid_from.slice(0, 10));

/** The plan in force for one person on one date, or null when they have none.
 *
 *  A personal plan beats the company default, but only where one is actually in force — so
 *  someone whose own plan starts in Khordad is on the company default before that, rather
 *  than on no plan at all. Same precedence rule as `rateFor`. */
export function planFor(
  organizationId: number,
  salespersonId: number | null,
  onDate: string,
  db: DatabaseSync = getDb(),
): StoredPlan | null {
  const personal = salespersonId === null ? [] : rowsFor(db, organizationId, salespersonId);
  const personalStart = effectiveAt(personal, onDate);
  if (personalStart) return toPlan(atStart(personal, personalStart));

  const shared = rowsFor(db, organizationId, null);
  const sharedStart = effectiveAt(shared, onDate);
  if (!sharedStart) return null;
  return toPlan(atStart(shared, sharedStart));
}

/** Every plan in an organisation, newest first — for the admin screen. */
export function listPlans(organizationId: number, db: DatabaseSync = getDb()): StoredPlan[] {
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLS} FROM commission_tiers
        WHERE organization_id = ?
        ORDER BY valid_from DESC, id`,
    )
    .all(organizationId) as unknown as TierRow[];

  // One plan is SEVERAL rows, so group by (person, start date).
  const byPlan = new Map<string, TierRow[]>();
  for (const r of rows) {
    const key = `${r.salesperson_user_id ?? "company"}|${r.valid_from.slice(0, 10)}`;
    const arr = byPlan.get(key);
    if (arr) arr.push(r);
    else byPlan.set(key, [r]);
  }
  return [...byPlan.values()]
    .map(toPlan)
    .filter((p): p is StoredPlan => p !== null)
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from));
}

/** Replace one person's plan from `valid_from` onward.
 *
 *  REPLACING rather than appending is the point: two plans both claiming to cover the same
 *  period is the one state where nobody can say what a rep was owed. Only rows at exactly
 *  that start date are removed, so a plan starting later is untouched — and a backdated plan
 *  restates unpaid accruals, never a recorded payment.
 *
 *  Validated BEFORE anything is written, and inside the same transaction as the delete, so a
 *  rejected plan cannot leave a half-written one behind. */
export function savePlan(input: {
  salesperson_user_id: number | null;
  organization_id: number;
  plan: Plan;
  valid_from: string;
  created_by: number | null;
  db?: DatabaseSync;
}): void {
  const db = input.db ?? getDb();
  const problem = validatePlan(input.plan);
  if (problem) throw new Error(problem);
  const validFrom = input.valid_from.slice(0, 10);

  db.exec("BEGIN");
  try {
    db.prepare(
      `DELETE FROM commission_tiers
        WHERE organization_id = ? AND salesperson_user_id IS ? AND valid_from = ?`,
    ).run(input.organization_id, input.salesperson_user_id, validFrom);

    const ins = db.prepare(
      `INSERT INTO commission_tiers
         (salesperson_user_id, organization_id, mode, metric, from_value, to_value,
          rate_type, rate_value, valid_from, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const t of input.plan.tiers) {
      ins.run(
        input.salesperson_user_id,
        input.organization_id,
        input.plan.mode,
        input.plan.metric,
        t.from_value,
        t.to_value,
        t.rate_type,
        t.rate_value,
        validFrom,
        input.created_by,
        new Date().toISOString(),
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Remove one person's plan from a given start date — an override removal, mirroring
 *  `deleteHoliday` in the weather plan. */
export function deletePlan(
  organizationId: number,
  salespersonUserId: number | null,
  validFrom: string,
  db: DatabaseSync = getDb(),
): void {
  db.prepare(
    `DELETE FROM commission_tiers
      WHERE organization_id = ? AND salesperson_user_id IS ? AND valid_from = ?`,
  ).run(organizationId, salespersonUserId, validFrom.slice(0, 10));
}

/** Does this person exist in this organisation?
 *
 *  Refused at the door rather than trusted: a plan attached to a user id from another tenant
 *  would sit in the table naming someone this owner cannot see, and `planFor` would never
 *  reach it — a row that pays nobody and looks configured. Raw SQL lives here, not in the
 *  route (tests/repo-boundary.test.ts, whose allowlist only shrinks). */
export function userInOrganization(
  organizationId: number,
  userId: number,
  db: DatabaseSync = getDb(),
): boolean {
  return !!db
    .prepare("SELECT id FROM users WHERE id = ? AND organization_id = ?")
    .get(userId, organizationId);
}
