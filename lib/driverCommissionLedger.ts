/** Reading and writing the راننده commission ledger.
 *
 *  Structured exactly like commissionLedger.ts -- accrued is derived every time from
 *  delivered weight and the rate in force, paid is a row that can never be restated --
 *  for the same reasons given there. The only real difference is which rows count as
 *  "delivered weight": a delivery_stops row marked delivered, joined through its run to
 *  the driver who ran it, rather than an order's own salesperson_user_id.
 */

import { linesByOrder } from "./repo/orderLines";
import { orderKgOf } from "./repo/orderKg";
import type { DatabaseSync } from "node:sqlite";
import { driverRateFor, type DriverRateRow } from "./driverCommission";
import { accrualToman } from "./commission";
import { isToman } from "./money";
import { orgOfUser } from "./repo/userOrg";
import type { Period } from "./commissionLedger";

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
  stops: DriverStop[];
}

export function setDriverRate(
  db: DatabaseSync,
  input: {
    driver_user_id?: number | null;
    rate_per_kg_toman: number;
    valid_from: string;
    created_by?: number | null;
  }
): number {
  if (!isToman(input.rate_per_kg_toman)) {
    throw new TypeError("نرخ پورسانت راننده را به تومان و بدون اعشار وارد کنید");
  }
  return Number(
    db
      .prepare(
        `INSERT INTO driver_commission_rates (driver_user_id, rate_per_kg_toman, valid_from, created_by, created_at,
                                              organization_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.driver_user_id ?? null,
        input.rate_per_kg_toman,
        input.valid_from.slice(0, 10),
        input.created_by ?? null,
        new Date().toISOString(),
        orgOfUser(db, input.driver_user_id, input.created_by)
      ).lastInsertRowid
  );
}

export function recordDriverPayment(
  db: DatabaseSync,
  input: {
    driver_user_id: number;
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
        `INSERT INTO driver_commission_payments (driver_user_id, amount_toman, paid_on,
                                                  period_from, period_to, notes, created_by, created_at,
                                                  organization_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.driver_user_id,
        input.amount_toman,
        input.paid_on.slice(0, 10),
        input.period_from?.slice(0, 10) ?? null,
        input.period_to?.slice(0, 10) ?? null,
        input.notes ?? null,
        input.created_by ?? null,
        new Date().toISOString(),
        orgOfUser(db, input.driver_user_id, input.created_by)
      ).lastInsertRowid
  );
}

export function readDriverRates(
  db: DatabaseSync,
  organizationId: number
): (DriverRateRow & { display_name: string | null })[] {
  return db
    .prepare(
      `SELECT dcr.*, u.display_name
         FROM driver_commission_rates dcr
         LEFT JOIN users u ON u.id = dcr.driver_user_id
        WHERE dcr.organization_id = ?
        ORDER BY dcr.valid_from DESC, dcr.id DESC`
    )
    .all(organizationId) as unknown as (DriverRateRow & { display_name: string | null })[];
}

/** Every completed stop credited to a driver inside a period, with its accrual.
 *
 *  Keyed off delivery_runs.driver_user_id, not delivery_stops.delivered_by -- the run
 *  is the assignment a manager made and the unit this business already schedules and
 *  pays around; a helper marking a stop delivered on someone else's run does not move
 *  whose round it was. */
function stopsFor(
  db: DatabaseSync,
  driverId: number,
  period: Period,
  rates: DriverRateRow[]
): DriverStop[] {
  const stops = db
    .prepare(
      `SELECT ds.order_id, o.order_no, ds.delivered_at, c.business_name AS customer_name,
              dr.run_date, o.kg_total
         FROM delivery_stops ds
         JOIN delivery_runs dr ON dr.id = ds.run_id
         JOIN orders o ON o.id = ds.order_id
         JOIN customers c ON c.id = o.customer_id
        WHERE dr.driver_user_id = ?
          AND ds.status = 'delivered'
          AND dr.run_date BETWEEN ? AND ?
        ORDER BY dr.run_date, ds.sort_order`
    )
    .all(driverId, period.from.slice(0, 10), period.to.slice(0, 10)) as unknown as {
    order_id: number;
    order_no: string;
    delivered_at: string | null;
    customer_name: string;
    run_date: string;
    kg_total: number | null;
  }[];

  // The order's stored weight when there is one (lib/repo/orderKg.ts); the lines are loaded only
  // for orders where it is empty. Same value either way, to the bit.
  const lineMap = linesByOrder(db, stops.filter((s) => s.kg_total === null).map((s) => s.order_id));

  return stops.map((stop) => {
    const kg = stop.kg_total ?? orderKgOf(lineMap.get(stop.order_id) ?? []);
    // The rate in force on the day the ROUND ran, not when the order was taken -- a
    // driver is paid for the day they drove, the same way a فروشنده is paid for the
    // day they sold.
    const rate = driverRateFor(rates, driverId, stop.run_date);
    const perKg = rate?.rate_per_kg_toman ?? 0;
    return {
      order_id: stop.order_id,
      order_no: stop.order_no,
      delivered_at: stop.delivered_at ?? stop.run_date,
      customer_name: stop.customer_name,
      kg,
      rate_per_kg_toman: perKg,
      accrual_toman: accrualToman(kg, perKg),
    };
  });
}

export function driverStatementFor(
  db: DatabaseSync,
  driverId: number,
  period: Period
): DriverStatement {
  const person = db
    .prepare("SELECT id, display_name FROM users WHERE id = ?")
    .get(driverId) as { id: number; display_name: string } | undefined;

  const rates = db.prepare("SELECT * FROM driver_commission_rates").all() as unknown as DriverRateRow[];
  const stops = stopsFor(db, driverId, period, rates);
  const accrued = stops.reduce((total, s) => total + s.accrual_toman, 0);

  const paidInPeriod = db
    .prepare(
      "SELECT COALESCE(SUM(amount_toman), 0) AS total FROM driver_commission_payments WHERE driver_user_id = ? AND paid_on BETWEEN ? AND ?"
    )
    .get(driverId, period.from.slice(0, 10), period.to.slice(0, 10)) as { total: number };

  // Owed is lifetime, same reasoning as the فروشنده ledger: what is still due does not
  // reset because a report window moved.
  const lifetimeAccrued = stopsFor(
    db,
    driverId,
    { from: "0000-01-01", to: "9999-12-31" },
    rates
  ).reduce((total, s) => total + s.accrual_toman, 0);
  const lifetimePaid = db
    .prepare("SELECT COALESCE(SUM(amount_toman), 0) AS total FROM driver_commission_payments WHERE driver_user_id = ?")
    .get(driverId) as { total: number };

  return {
    driver_user_id: driverId,
    display_name: person?.display_name ?? "—",
    kg: stops.reduce((total, s) => total + s.kg, 0),
    accrued_toman: accrued,
    paid_toman: paidInPeriod.total,
    owed_toman: lifetimeAccrued - lifetimePaid.total,
    stops,
  };
}

/** One line per راننده. Same empty-means-nothing rule as allStatements: a manager with
 *  no group reaches nobody, never everybody. */
export function allDriverStatements(
  db: DatabaseSync,
  period: Period,
  opts: { groupId?: number | null } = {}
): DriverStatement[] {
  const groupId = opts.groupId;
  if (groupId === null) return [];

  /* People who HOLD a van role, whoever their primary — the driver ledger's counterpart to
     commissionLedger, and for the same reason: it fails silently when it matches nobody. A
     `role IN (...)` test cannot see a seller whose other hat is driving, and that is exactly
     whose delivery commission would vanish.

     A person holding both kinds appears in BOTH ledgers, keyed on the kind of work actually
     done. That is the point of the split, not a duplicate to be deduplicated. */
  const people = (
    groupId === undefined
      ? db
          .prepare(
            `SELECT DISTINCT u.id FROM users u
               JOIN user_roles r ON r.user_id = u.id AND r.role IN ('delivery_driver', 'field_rep')
              WHERE u.active = 1 ORDER BY u.display_name`
          )
          .all()
      : db
          .prepare(
            `SELECT DISTINCT u.id FROM users u
               JOIN user_roles r ON r.user_id = u.id AND r.role IN ('delivery_driver', 'field_rep')
              WHERE u.active = 1 AND u.group_id = ? ORDER BY u.display_name`
          )
          .all(groupId)
  ) as unknown as { id: number }[];

  return people.map((person) => driverStatementFor(db, person.id, period));
}
