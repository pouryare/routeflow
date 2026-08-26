/** Cost and stock arithmetic.
 *
 *  Moving average rather than per-batch cost, matching what the workbook did and what
 *  the business can actually observe: per-batch costing needs every unit traced to the
 *  receipt it arrived on, which is a warehouse process nobody here is running. The
 *  average is recomputed on each purchase receipt and snapshotted onto the order line at
 *  the moment of sale, so an old order's margin cannot move when a new delivery arrives.
 */

import { roundToman } from "./money";

/** The new average unit cost after a receipt lands.
 *
 *  Weighted by quantity, not by number of purchases: 900 units at 1000 plus 100 at 2000
 *  is 1100, not 1500. Getting that wrong makes every margin on the cheap stock look
 *  worse than it is.
 */
export function movingAverageCost(input: {
  onHand: number;
  avgCost: number;
  qty: number;
  unitCost: number;
}): number {
  const { onHand, avgCost, qty, unitCost } = input;

  // Nothing arriving cannot change the average.
  if (!(qty > 0)) return roundToman(avgCost);

  // Negative stock is a real state here -- the books lag reality while paper drains --
  // but it must not be blended, or the divisor goes through zero and the average comes
  // out inverted or enormous. The receipt simply sets the price.
  if (onHand <= 0) return roundToman(Math.max(0, unitCost));

  const value = onHand * avgCost + qty * unitCost;
  return roundToman(Math.max(0, value / (onHand + qty)));
}

/** Units on hand: everything received, less everything that left the van.
 *
 *  Allowed to go negative on purpose. For months the recorded stock will be behind
 *  reality while the paper backlog drains, and a floor at zero would quietly hide that
 *  the books are wrong instead of showing it. The UI flags a negative rather than
 *  refusing to display one.
 */
export function stockAfter(input: { purchased: number; delivered: number }): number {
  return input.purchased - input.delivered;
}
