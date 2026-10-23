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

import { cache } from "react";
import { getDb } from "./db";
import { linesByOrder } from "./repo/orderLines";
import { orderKgOf } from "./repo/orderFigures";
import type { Db } from "@/lib/database/client";
import { rateFor, accrualToman, type RateRow } from "./commission";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "./orderStateMachine";
import { isToman, roundToman } from "./money";
import { orgOfUser } from "./repo/userOrg";
import { insertCommissionPayment } from "./repo/commissionPayments";
import { commissionFor, effectiveRate, type PlanMode } from "./commission/tiers";
import { measureFor, type MeasurableOrder } from "./commission/measure";
import { planFor } from "./repo/commissionTiers";
import { orgClause } from "./orgScope";

import { mapSeq } from "@/lib/seq";
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

export async function setRate(
  db: Db,
  input: {
    salesperson_user_id?: number | null;
    rate_per_kg_toman: number;
    urgent_rate_per_kg_toman?: number | null;
    valid_from: string;
    created_by?: number | null;
  }
): Promise<number> {
  if (!isToman(input.rate_per_kg_toman)) {
    throw new TypeError("نرخ پورسانت را به تومان و بدون اعشار وارد کنید");
  }
  return Number(
    (await db
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
        await orgOfUser(db, input.salesperson_user_id, input.created_by)
      )).lastInsertRowid
  );
}

export async function recordPayment(
  db: Db,
  input: {
    salesperson_user_id: number;
    amount_toman: number;
    paid_on: string;
    period_from?: string | null;
    period_to?: string | null;
    notes?: string | null;
    created_by?: number | null;
  }
): Promise<number> {
  return await insertCommissionPayment(db, "sales", input.salesperson_user_id, input, true);
}

export async function readRates(
  db: Db,
  organizationId: number
): Promise<(RateRow & { display_name: string | null })[]> {
  return await db
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
/** One person's accruals for a period, shared for the length of one server render.
 *
 *  The dashboard asks for the same person several times in one request: the salesperson ledger,
 *  then once for every group manager (whose override is a share of the team's accruals, so
 *  managerStatementFor re-reads every salesperson in the group, period AND lifetime). Each ask
 *  walks every order that person ever sold. React's cache() shares one result across those asks
 *  inside a single render and drops it afterwards; outside a render (route handlers, scripts,
 *  tests) it simply calls through, and a handle other than the app's own is never memoised, so
 *  nothing can go stale. Callers must treat the result as read-only. */
const accrualsMemo = cache(async (salespersonId: number, from: string, to: string): Promise<StatementOrder[]> => {
  const db = getDb();
  const rates = await db.prepare("SELECT * FROM commission_rates").all() as unknown as RateRow[];
  return await computeAccruals(db, salespersonId, { from, to }, rates);
});

async function accrualsFor(
  db: Db,
  salespersonId: number,
  period: Period,
  rates: RateRow[]
): Promise<StatementOrder[]> {
  return db === getDb()
    ? await accrualsMemo(salespersonId, period.from, period.to)
    : await computeAccruals(db, salespersonId, period, rates);
}

async function computeAccruals(
  db: Db,
  salespersonId: number,
  period: Period,
  rates: RateRow[]
): Promise<StatementOrder[]> {
  const orders = await db
    .prepare(
      `SELECT o.id AS order_id, o.order_no, o.order_date, c.business_name AS customer_name, o.kg_total
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
    kg_total: number | null;
  }[];

  /* A tiered plan is priced from the lines themselves, so for that person they are loaded. For
     everyone else an order's weight is read from `orders.kg_total` (lib/repo/orderKg.ts) and the
     lines are loaded only for orders where it is empty -- which is what keeps "owed", a lifetime
     figure, from re-adding every line a person ever sold. Same value either way, to the bit. */
  const plan = await planFor(await orgOf(db, salespersonId), salespersonId, period.to, db);
  const lineMap = await linesByOrder(
    db,
    orders.filter((o) => plan !== null || o.kg_total === null).map((o) => o.order_id)
  );
  const measured = orders.map(({ kg_total, ...order }) => {
    const lines = lineMap.get(order.order_id) ?? [];
    return { order, lines, kg: plan === null && kg_total !== null ? kg_total : orderKgOf(lines) };
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
async function orgOf(db: Db, userId: number): Promise<number> {
  const row = await db
    .prepare("SELECT organization_id FROM users WHERE id = ?")
    .get(userId) as { organization_id: number } | undefined;
  return row?.organization_id ?? 1;
}

export async function statementFor(
  db: Db,
  salespersonId: number,
  period: Period
): Promise<Statement> {
  const person = await db
    .prepare("SELECT id, display_name FROM users WHERE id = ?")
    .get(salespersonId) as { id: number; display_name: string } | undefined;

  const rates = await db.prepare("SELECT * FROM commission_rates").all() as unknown as RateRow[];
  const orders = await accrualsFor(db, salespersonId, period, rates);

  const accrued = orders.reduce((total, o) => total + o.accrual_toman, 0);

  const paidInPeriod = await db
    .prepare(
      "SELECT COALESCE(SUM(amount_toman), 0) AS total FROM commission_payments WHERE salesperson_user_id = ? AND paid_on BETWEEN ? AND ?"
    )
    .get(salespersonId, period.from.slice(0, 10), period.to.slice(0, 10)) as { total: number };

  // Owed is deliberately lifetime rather than period: what somebody is still due does
  // not reset because a report window moved.
  const lifetimeAccrued = (await accrualsFor(
    db,
    salespersonId,
    { from: "0000-01-01", to: "9999-12-31" },
    rates
  )).reduce((total, o) => total + o.accrual_toman, 0);
  const lifetimePaid = await db
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
    plan_mode: (await planFor(await orgOf(db, salespersonId), salespersonId, period.to, db))?.mode ?? null,
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
export async function allStatements(
  db: Db,
  period: Period,
  opts: { groupId?: number | null; organizationId: number | null }
): Promise<Statement[]> {
  const groupId = opts.groupId;
  const org = orgClause("u.organization_id", opts.organizationId);
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
      ? await db
          .prepare(
            `SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role = 'phone_sales'
              WHERE u.active = 1${org.sql} ORDER BY u.display_name`
          )
          .all(...org.params)
      : await db
          .prepare(
            `SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role = 'phone_sales'
              WHERE u.active = 1 AND u.group_id = ?${org.sql} ORDER BY u.display_name`
          )
          .all(groupId, ...org.params)
  ) as unknown as { id: number }[];

  return await mapSeq(people, async (person) => await statementFor(db, person.id, period));
}
