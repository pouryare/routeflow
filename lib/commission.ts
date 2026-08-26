/** What a فروشنده earned, and what they have been paid.
 *
 *  Commission is per kilogram of goods **delivered**, not ordered. That distinction is
 *  the reason order_lines carries both quantities: a customer who takes two of three
 *  boxes at the door has bought two boxes' worth of commission, and paying on the third
 *  would be paying for goods that came home in the van.
 *
 *  Accrual is derived rather than stored. The inputs are already frozen -- the weight
 *  comes from kg_per_base_unit and qty_per_pack snapshotted on the line, and the rate is
 *  looked up by the order's own date from an append-only table -- so recomputing gives
 *  the same answer every time and there is no second copy of the figure to fall out of
 *  step with the lines.
 *
 *  One consequence worth being explicit about: inserting a rate with a valid_from in the
 *  past re-values every unpaid accrual under it. That is usually the point -- a backdated
 *  raise should apply to the month it was agreed for. It never touches a recorded
 *  payment, which is a fact about money that moved.
 */

import { effectiveAt } from "./pricing";
import { roundToman } from "./money";

export interface RateRow {
  id: number;
  /** Null is the company-wide default that applies to everyone without their own. */
  salesperson_user_id: number | null;
  rate_per_kg_toman: number;
  /** For فوری deliveries. Null means the ordinary rate applies. */
  urgent_rate_per_kg_toman: number | null;
  valid_from: string;
}

/** The rate that applies to one person on one day.
 *
 *  A rate set for the person beats the company default, but only where such a row is
 *  actually in force -- so someone whose own rate starts in Khordad is on the company
 *  rate before that, rather than on no rate at all. Same precedence rule as a
 *  packaging-specific price beating a product-wide one.
 */
export function rateFor(
  rows: RateRow[],
  salespersonId: number | null,
  onDate: string
): RateRow | null {
  const personal =
    salespersonId === null ? [] : rows.filter((r) => r.salesperson_user_id === salespersonId);
  return (
    effectiveAt(personal, onDate) ??
    effectiveAt(
      rows.filter((r) => r.salesperson_user_id === null),
      onDate
    )
  );
}

/** Weight times rate, in whole Toman.
 *
 *  Negative weight gives negative commission, which is how a return claws back what was
 *  accrued on the line it reverses. Rounded through the one shared rule so a reversal
 *  nets to exactly zero rather than leaving a Toman behind on every corrected order.
 */
export function accrualToman(kg: number, ratePerKgToman: number): number {
  return roundToman(kg * ratePerKgToman);
}
