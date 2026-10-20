/** Reading and writing the commission ledger.
 *
 *  Two different kinds of number live here and they are treated differently on purpose:
 *
 *  - **Accrued** is derived, every time, from delivered weight and the rate in force on
 *    the order's date. Nothing is stored, so there is no cached figure to drift from the
 *    lines it came from. A backdated rate therefore restates unpaid accruals, which is
 *    what a backdated raise is supposed to do.
 *  - **Paid** is a row. It records money that moved and no later edit can restate it.
 *
 *  Commission accrues on delivery, not on confirmation. A confirmed order is a promise;
 *  the goods can still come back on the van, and paying on the promise means clawing it
 *  back afterwards.
 */

import { linesByOrder } from "./orderLinesBatch";
import type { DatabaseSync } from "node:sqlite";
import { rateFor, accrualToman, type RateRow } from "./commission";
import { lineKg, type LineSnapshot } from "./orderMath";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "./orderStateMachine";
import { isToman, roundToman } from "./money";
import { orgOfUser } from "./repo/userOrg";
import { commissionFor, effectiveRate, type PlanMode } from "./commission/tiers";
import { measureFor, type MeasurableOrder } from "./commission/measure";
import { planFor } from "./repo/commissionTiers";

export interface Period {
  from: string;
  to: string;
}

export interface StatementOrder {
  order_id: number;
  order_no: string;
  order_date: string;
  customer_name: string;
  kg: number;
  /** The rate this order was paid at. Under a tiered plan this is the tier's EFFECTIVE rate
   *  at the period total, not a per-kilogram rate — which is why `plan_mode` exists beside
   *  it, so a screen never implies a flat per-kg rule that is not in force. */
  rate_per_kg_toman: number;
  accrual_toman: number;
}

export interface Statement {
  salesperson_user_id: number;
  display_name: string;
  kg: number;
  accrued_toman: number;
  paid_toman: number;
  /** Lifetime, not period: what is actually still owed to this person today. */
  owed_toman: number;
  /** Which rule produced `accrued_toman`. Null means the flat per-kilogram rate, unchanged. */
  plan_mode: PlanMode | null;
  orders: StatementOrder[];
}

export function setRate(
  db: DatabaseSync,
  input: {
    salesperson_user_id?: number | null;
    rate_per_kg_toman: number;
    urgent_rate_per_kg_toman?: number | null;
    valid_from: string;
    created_by?: number | null;
  }
): number {
  if (!isToman(input.rate_per_kg_toman)) {
    throw new TypeError("نرخ پورسانت را به تومان و بدون اعشار وارد کنید");
  }
  return Number(
    db
      .prepare(
        `INSERT INTO commission_rates (salesperson_user_id, rate_per_kg_toman,
                                       urgent_rate_per_kg_toman, valid_from, created_by, created_at,
                                       organization_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.salesperson_user_id ?? null,
        input.rate_per_kg_toman,
        input.urgent_rate_per_kg_toman ?? null,
        input.valid_from.slice(0, 10),
        input.created_by ?? null,
        new Date().toISOString(),
        orgOfUser(db, input.salesperson_user_id, input.created_by)
      ).lastInsertRowid
  );
}

export function recordPayment(
  db: DatabaseSync,
  input: {
    salesperson_user_id: number;
    amount_toman: number;
    paid_on: string;
    period_from?: string | null;
    period_to?: string | null;
    notes?: string | null;
    created_by?: number | null;
  }
): number {
  if (!isToman(input.amount_toman)) {
    throw new TypeError("مبلغ پرداخت را به تومان و بدون اعشار وارد کنید");
  }
  return Number(
    db
      .prepare(
        `INSERT INTO commission_payments (salesperson_user_id, amount_toman, paid_on,
                                          period_from, period_to, notes, created_by, created_at,
                                          organization_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.salesperson_user_id,
        input.amount_toman,
        input.paid_on.slice(0, 10),
        input.period_from?.slice(0, 10) ?? null,
        input.period_to?.slice(0, 10) ?? null,
        input.notes ?? null,
        input.created_by ?? null,
        new Date().toISOString(),
        orgOfUser(db, input.salesperson_user_id, input.created_by)
      ).lastInsertRowid
  );
}

export function readRates(
  db: DatabaseSync,
  organizationId: number
): (RateRow & { display_name: string | null })[] {
  return db
    .prepare(
      `SELECT cr.*, u.display_name
         FROM commission_rates cr
         LEFT JOIN users u ON u.id = cr.salesperson_user_id
        WHERE cr.organization_id = ?
        ORDER BY cr.valid_from DESC, cr.id DESC`
    )
    .all(organizationId) as unknown as (RateRow & { display_name: string | null })[];
}

/** Every delivered order credited to a person inside a period, with its accrual. */
function accrualsFor(
  db: DatabaseSync,
  salespersonId: number,
  period: Period,
  rates: RateRow[]
): StatementOrder[] {
  const orders = db
    .prepare(
      `SELECT o.id AS order_id, o.order_no, o.order_date, c.business_name AS customer_name
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
        WHERE o.salesperson_user_id = ?
          AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
          AND o.order_date BETWEEN ? AND ?
        ORDER BY o.order_date, o.id`
    )
    .all(salespersonId, period.from.slice(0, 10), period.to.slice(0, 10)) as unknown as {
    order_id: number;
    order_no: string;
    order_date: string;
    customer_name: string;
  }[];

  const lineMap = linesByOrder(db, orders.map((o) => o.order_id));
  const measured = orders.map((order) => {
    const lines = lineMap.get(order.order_id) ?? [];
    return { order, lines, kg: lines.reduce((total, line) => total + lineKg(line), 0) };
  });

  /* A tiered plan replaces the flat rate for this person, measured over the WHOLE PERIOD.
   *
   *  Period, not per order: a tier is a statement-level concept. Splitting it per order would
   *  mean the same 60kg paid differently depending on how it happened to be invoiced, which
   *  is not a plan anyone would agree to. So the plan is priced once from the period total,
   *  and the per-order accruals below become the SHAPE of that total rather than the sum of
   *  independent prices.
   *
   *  `planFor` returns null when the person is on the flat rate, and the fallback is the
   *  ORIGINAL code path unchanged — deliberately. Two implementations of accrual would
   *  drift, and the people on the flat rate are on real payroll today. */
  const plan = planFor(orgOf(db, salespersonId), salespersonId, period.to, db);
  if (!plan) {
    return measured.map(({ order, kg }) => {
      // The rate in force on the day the order was taken -- not today's, and not the rate
      // on the delivery date, so a rate change mid-round cannot split one round in two.
      const rate = rateFor(rates, salespersonId, order.order_date);
      const perKg = rate?.rate_per_kg_toman ?? 0;
      return { ...order, kg, rate_per_kg_toman: perKg, accrual_toman: accrualToman(kg, perKg) };
    });
  }

  const measurable: MeasurableOrder[] = measured.map((m) => ({ lines: m.lines }));
  const planTotal = commissionFor(plan, measureFor(plan.metric, measurable));
  const totalKg = measured.reduce((t, m) => t + m.kg, 0);
  const rateNow = effectiveRate(plan, totalKg);

  /* The period total is split across orders PROPORTIONALLY to weight, rather than each
   * order being priced on its own. Proportional is what keeps the per-order numbers adding
   * up to the statement — a UI that lists orders and shows a total the rows do not make is
   * worse than one that shows no rows at all. Orders of zero weight take nothing, and the
   * rounding remainder lands on the last one so the sum is exact rather than 1 Toman short. */
  const out = measured.map(({ order, kg }) => ({
    ...order,
    kg,
    rate_per_kg_toman: rateNow,
    accrual_toman: totalKg === 0 ? 0 : roundToman((kg / totalKg) * planTotal),
  }));
  const drift = planTotal - out.reduce((t, o) => t + o.accrual_toman, 0);
  if (drift !== 0 && out.length > 0) {
    out[out.length - 1].accrual_toman += drift;
  }
  return out;
}

/** The organisation a salesperson belongs to.
 *
 *  `planFor` is tenant-scoped, so the lookup has to know the tenant. Taken from the user row
 *  rather than passed in, because a caller that supplied the wrong one would read another
 *  company's plan. */
function orgOf(db: DatabaseSync, userId: number): number {
  const row = db
    .prepare("SELECT organization_id FROM users WHERE id = ?")
    .get(userId) as { organization_id: number } | undefined;
  return row?.organization_id ?? 1;
}

export function statementFor(
  db: DatabaseSync,
  salespersonId: number,
  period: Period
): Statement {
  const person = db
    .prepare("SELECT id, display_name FROM users WHERE id = ?")
    .get(salespersonId) as { id: number; display_name: string } | undefined;

  const rates = db.prepare("SELECT * FROM commission_rates").all() as unknown as RateRow[];
  const orders = accrualsFor(db, salespersonId, period, rates);

  const accrued = orders.reduce((total, o) => total + o.accrual_toman, 0);

  const paidInPeriod = db
    .prepare(
      "SELECT COALESCE(SUM(amount_toman), 0) AS total FROM commission_payments WHERE salesperson_user_id = ? AND paid_on BETWEEN ? AND ?"
    )
    .get(salespersonId, period.from.slice(0, 10), period.to.slice(0, 10)) as { total: number };

  // Owed is deliberately lifetime rather than period: what somebody is still due does
  // not reset because a report window moved.
  const lifetimeAccrued = accrualsFor(
    db,
    salespersonId,
    { from: "0000-01-01", to: "9999-12-31" },
    rates
  ).reduce((total, o) => total + o.accrual_toman, 0);
  const lifetimePaid = db
    .prepare(
      "SELECT COALESCE(SUM(amount_toman), 0) AS total FROM commission_payments WHERE salesperson_user_id = ?"
    )
    .get(salespersonId) as { total: number };

  return {
    salesperson_user_id: salespersonId,
    display_name: person?.display_name ?? "—",
    kg: orders.reduce((total, o) => total + o.kg, 0),
    accrued_toman: accrued,
    paid_toman: paidInPeriod.total,
    owed_toman: lifetimeAccrued - lifetimePaid.total,
    // Read from the same lookup the accrual used, so the label cannot disagree with the
    // number it labels. Null means the flat rate path ran, unchanged.
    plan_mode: planFor(orgOf(db, salespersonId), salespersonId, period.to, db)?.mode ?? null,
    orders,
  };
}

/** One line per فروشنده.
 *
 *  `groupId` undefined means every group -- the owner's view. Passing a group narrows it
 *  to that group's salespeople; passing null narrows it to nobody, which is the right
 *  answer for a manager who has not been given a group yet. Same shape of reasoning as
 *  groupFilter: the empty case must read as "nothing", never as "everything".
 */
export function allStatements(
  db: DatabaseSync,
  period: Period,
  opts: { groupId?: number | null } = {}
): Statement[] {
  const groupId = opts.groupId;
  // A manager with no group can reach nobody. Returning [] rather than falling through
  // to the unscoped query is the same rule groupFilter follows: the empty case must read
  // as "nothing", never as "everything".
  if (groupId === null) return [];

  /* People who HOLD phone_sales, whoever their primary.
   *
   * MONEY, so this is the one that must not be wrong: this query fails SILENTLY when it
   * matches nobody — a commission run that produces no statements, and nobody notices until
   * payday. A `role IN (...)` test cannot see a driver who also sells, and that is exactly
   * the person whose sales commission would vanish.
   *
   * No DISTINCT is needed or wanted: a person holding both kinds appears in BOTH ledgers,
   * keyed on the kind of work actually done. That is the point of the split, not a
   * duplicate to be deduplicated. */
  const people = (
    groupId === undefined
      ? db
          .prepare(
            `SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role = 'phone_sales'
              WHERE u.active = 1 ORDER BY u.display_name`
          )
          .all()
      : db
          .prepare(
            `SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role = 'phone_sales'
              WHERE u.active = 1 AND u.group_id = ? ORDER BY u.display_name`
          )
          .all(groupId)
  ) as unknown as { id: number }[];

  return people.map((person) => statementFor(db, person.id, period));
}
