/** What a راننده earned, on what they personally delivered.
 *
 *  Same shape of rule as lib/commission.ts, on a different measure: a سفارش's
 *  commission is credited to whoever the order names as its seller; a driver earns on
 *  the stops their own runs actually completed, regardless of who sold the goods. The
 *  two tables never need to agree with each other -- one order can pay both a
 *  فروشنده's per-kg rate and the راننده's, because they are two different people being
 *  paid for two different jobs.
 */

import { effectiveAt } from "./pricing";

export interface DriverRateRow {
  id: number;
  /** Null is the company-wide default, same convention as commission_rates. */
  driver_user_id: number | null;
  rate_per_kg_toman: number;
  valid_from: string;
}

/** The rate that applies to one driver on one day -- their own rate if one is in
 *  force, otherwise the company default. Identical precedence to رate rate, kept as a
 *  separate function rather than a shared generic because the two tables are never
 *  read together and a shared helper would need a field-name parameter for no benefit. */
export function driverRateFor(
  rows: DriverRateRow[],
  driverId: number | null,
  onDate: string
): DriverRateRow | null {
  const personal = driverId === null ? [] : rows.filter((r) => r.driver_user_id === driverId);
  return (
    effectiveAt(personal, onDate) ??
    effectiveAt(
      rows.filter((r) => r.driver_user_id === null),
      onDate
    )
  );
}
