/** Reading and writing the راننده commission ledger.
 *
 *  Structured exactly like commissionLedger.ts -- accrued is derived every time from
 *  delivered weight and the rate in force, paid is a row that can never be restated --
 *  for the same reasons given there. The only real difference is which rows count as
 *  "delivered weight": a delivery_stops row marked delivered, joined through its run to
 *  the driver who ran it, rather than an order's own salesperson_user_id.
 */

import { deductionFields, deductionsByUser, sumDeductions, type DeductionItem } from "./repo/discountDeductions";
import { linesByOrder } from "./repo/orderLines";
import { orderKgOf } from "./repo/orderFigures";
import type { Db } from "@/lib/database/client";
import { driverRateFor, type DriverRateRow } from "./driverCommission";
import { accrualToman } from "./commission";
import { isToman } from "./money";
import { insertCommissionPayment, insertDatedRate, paidByPerson } from "./repo/commissionPayments";
import { namesOf } from "./repo/userOrg";
import type { Period } from "./commissionLedger";
import { orgClause } from "./orgScope";

export interface DriverStop {
  order_id: number;
  order_no: string;
  delivered_at: string;
  customer_name: string;
  kg: number;
  rate_per_kg_toman: number;
  accrual_toman: number;
}

export interface DriverStatement {
  driver_user_id: number;
  display_name: string;
  kg: number;
  accrued_toman: number;
  paid_toman: number;
  owed_toman: number;
  deductions: DeductionItem[];
  deduction_toman: number;
  carried_toman: number;
  net_toman: number;
  stops: DriverStop[];
}

export async function setDriverRate(
  db: Db,
  input: {
    driver_user_id?: number | null;
    rate_per_kg_toman: number;
    valid_from: string;
    created_by?: number | null;
  }
): Promise<number> {
  if (!isToman(input.rate_per_kg_toman)) {
    throw new TypeError("نرخ پورسانت راننده را به تومان و بدون اعشار وارد کنید");
  }
  return await insertDatedRate(db, "driver", input.driver_user_id, input.rate_per_kg_toman, input);
}

export async function recordDriverPayment(
  db: Db,
  input: {
    driver_user_id: number;
    amount_toman: number;
    paid_on: string;
    period_from?: string | null;
    period_to?: string | null;
    notes?: string | null;
    created_by?: number | null;
  }
): Promise<number> {
  return await insertCommissionPayment(db, "driver", input.driver_user_id, input, true);
}

export async function readDriverRates(
  db: Db,
  organizationId: number
): Promise<(DriverRateRow & { display_name: string | null })[]> {
  return await db
    .prepare(
      `SELECT dcr.*, u.display_name
         FROM driver_commission_rates dcr
         LEFT JOIN users u ON u.id = dcr.driver_user_id
        WHERE dcr.organization_id = ?
        ORDER BY dcr.valid_from DESC, dcr.id DESC`
    )
    .all(organizationId) as unknown as (DriverRateRow & { display_name: string | null })[];
}

/** Every completed stop credited to these drivers, all time, with its accrual, by driver.
 *
 *  Keyed off delivery_runs.driver_user_id, not delivery_stops.delivered_by -- the run
 *  is the assignment a manager made and the unit this business already schedules and
 *  pays around; a helper marking a stop delivered on someone else's run does not move
 *  whose round it was.
 *
 *  All time and all drivers in one query: «still owed» needs the lifetime anyway, and the period
 *  is a filter on it. A statements page was two of these per driver (19 ms each). */
async function stopsByDriver(
  db: Db,
  driverIds: number[],
  rates: DriverRateRow[]
): Promise<Map<number, (DriverStop & { run_date: string })[]>> {
  const out = new Map<number, (DriverStop & { run_date: string })[]>();
  if (driverIds.length === 0) return out;
  const stops = await db
    .prepare(
      `SELECT dr.driver_user_id, ds.order_id, o.order_no, ds.delivered_at, c.business_name AS customer_name,
              dr.run_date, o.kg_total
         FROM delivery_stops ds
         JOIN delivery_runs dr ON dr.id = ds.run_id
         JOIN orders o ON o.id = ds.order_id
         JOIN customers c ON c.id = o.customer_id
        WHERE dr.driver_user_id IN (${driverIds.map(() => "?").join(",")})
          AND ds.status = 'delivered'
        ORDER BY dr.run_date, ds.sort_order`
    )
    .all(...driverIds) as unknown as {
    driver_user_id: number;
    order_id: number;
    order_no: string;
    delivered_at: string | null;
    customer_name: string;
    run_date: string;
    kg_total: number | null;
  }[];

  // The order's stored weight when there is one (lib/repo/orderKg.ts); the lines are loaded only
  // for orders where it is empty. Same value either way, to the bit.
  const lineMap = await linesByOrder(db, stops.filter((s) => s.kg_total === null).map((s) => s.order_id));

  for (const stop of stops) {
    const kg = stop.kg_total ?? orderKgOf(lineMap.get(stop.order_id) ?? []);
    // The rate in force on the day the ROUND ran, not when the order was taken -- a
    // driver is paid for the day they drove, the same way a فروشنده is paid for the
    // day they sold.
    const rate = driverRateFor(rates, stop.driver_user_id, stop.run_date);
    const perKg = rate?.rate_per_kg_toman ?? 0;
    const row = {
      order_id: stop.order_id,
      order_no: stop.order_no,
      delivered_at: stop.delivered_at ?? stop.run_date,
      customer_name: stop.customer_name,
      kg,
      rate_per_kg_toman: perKg,
      accrual_toman: accrualToman(kg, perKg),
      run_date: stop.run_date,
    };
    const list = out.get(stop.driver_user_id);
    if (list) list.push(row);
    else out.set(stop.driver_user_id, [row]);
  }
  return out;
}

export async function driverStatementFor(
  db: Db,
  driverId: number,
  period: Period
): Promise<DriverStatement> {
  return (await driverStatementsFor(db, [driverId], period))[0];
}

/** The statements of many drivers, in the order given, with one query per kind of row rather than
 *  eight per driver. */
async function driverStatementsFor(db: Db, driverIds: number[], period: Period): Promise<DriverStatement[]> {
  if (driverIds.length === 0) return [];
  const from = period.from.slice(0, 10);
  const to = period.to.slice(0, 10);
  const names = await namesOf(db, driverIds);
  const rates = await db.prepare("SELECT * FROM driver_commission_rates").all() as unknown as DriverRateRow[];
  const stopsBy = await stopsByDriver(db, driverIds, rates);
  const paidBy = await paidByPerson(db, "driver", driverIds, period);
  const deductionsBy = await deductionsByUser(db, driverIds, "driver");

  return driverIds.map((driverId) => {
    const lifetimeStops = stopsBy.get(driverId) ?? [];
    const stops = lifetimeStops
      .filter((s) => s.run_date >= from && s.run_date <= to)
      .map(({ run_date: _runDate, ...stop }) => stop);
    const accrued = stops.reduce((total, s) => total + s.accrual_toman, 0);
    // Owed is lifetime, same reasoning as the فروشنده ledger: what is still due does not
    // reset because a report window moved.
    const lifetimeAccrued = lifetimeStops.reduce((total, s) => total + s.accrual_toman, 0);
    const paid = paidBy.get(driverId);
    const deductions = deductionsBy.get(driverId) ?? [];
    return {
      driver_user_id: driverId,
      display_name: names.get(driverId)?.display_name ?? "—",
      kg: stops.reduce((total, s) => total + s.kg, 0),
      accrued_toman: accrued,
      paid_toman: paid?.period ?? 0,
      owed_toman: lifetimeAccrued - sumDeductions(deductions) - (paid?.lifetime ?? 0),
      ...deductionFields(accrued, deductions.filter((d) => d.order_date >= from && d.order_date <= to)),
      stops,
    };
  });
}

/** One line per راننده. Same empty-means-nothing rule as allStatements: a manager with
 *  no group reaches nobody, never everybody. */
export async function allDriverStatements(
  db: Db,
  period: Period,
  opts: { groupId?: number | null; organizationId: number | null }
): Promise<DriverStatement[]> {
  const groupId = opts.groupId;
  const org = orgClause("u.organization_id", opts.organizationId);
  if (groupId === null) return [];

  /* People who HOLD a van role, whoever their primary — the driver ledger's counterpart to
     commissionLedger, and for the same reason: it fails silently when it matches nobody. A
     `role IN (...)` test cannot see a seller whose other hat is driving, and that is exactly
     whose delivery commission would vanish.

     A person holding both kinds appears in BOTH ledgers, keyed on the kind of work actually
     done. That is the point of the split, not a duplicate to be deduplicated. */
  const people = (
    groupId === undefined
      ? await db
          .prepare(
            `SELECT u.id FROM users u
              WHERE u.active = 1${org.sql}
                AND EXISTS (SELECT 1 FROM user_roles r
                             WHERE r.user_id = u.id AND r.role IN ('delivery_driver', 'field_rep'))
              ORDER BY u.display_name`
          )
          .all(...org.params)
      : await db
          .prepare(
            `SELECT u.id FROM users u
              WHERE u.active = 1 AND u.group_id = ?${org.sql}
                AND EXISTS (SELECT 1 FROM user_roles r
                             WHERE r.user_id = u.id AND r.role IN ('delivery_driver', 'field_rep'))
              ORDER BY u.display_name`
          )
          .all(groupId, ...org.params)
  ) as unknown as { id: number }[];

  return await driverStatementsFor(db, people.map((p) => p.id), period);
}
