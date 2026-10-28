/** What an order line is worth and what it weighs.
 *
 *  Every input here is a value frozen onto the line at the moment of sale -- the unit
 *  price, the unit cost, how many عدد are in a pack, and how many kilograms an عدد
 *  weighs. None of them is read back from the catalogue, and that is the entire point.
 *
 *  The kilogram figure is the one that costs money if it drifts: commission is paid per
 *  kilogram, so recomputing an old line against a revised pack size does not just change
 *  a report, it changes a number somebody was already paid on.
 *
 *  base_qty, kg and the line total are computed here rather than stored. The factors
 *  they are computed from are frozen, so the products of those factors cannot disagree
 *  with them -- storing the results as well would only add a second place for the same
 *  truth to live, and a way for the two to diverge.
 */

import { roundToman, sumToman } from "./money";

export interface LineSnapshot {
  packs_ordered: number;
  /** Null until a delivery is recorded. Zero is a real answer and not the same as null. */
  packs_delivered: number | null;
  unit_price_toman: number;
  unit_cost_toman: number;
  qty_per_pack: number;
  kg_per_base_unit: number;
}

/** What actually counts: what left the van if it has, otherwise what was agreed.
 *
 *  `?? ` rather than `||` deliberately -- a delivery of zero packs means the customer
 *  refused the line at the door, and falling back to the ordered quantity there would
 *  invoice and pay commission on goods that came home again. */
export function effectivePacks(line: LineSnapshot): number {
  return line.packs_delivered ?? line.packs_ordered;
}

/** Packs to individual units: تعداد بسته × تعداد در بسته. */
export function baseQty(line: LineSnapshot): number {
  return effectivePacks(line) * line.qty_per_pack;
}

/** Units to kilograms -- the figure commission is paid on. */
export function lineKg(line: LineSnapshot): number {
  return baseQty(line) * line.kg_per_base_unit;
}

/** The line's value in whole Toman.
 *
 *  Rounded through the one shared rule, so a reversal of a sale nets to exactly zero
 *  rather than leaving a Toman behind on every corrected order. */
export function lineTotalToman(line: LineSnapshot): number {
  return roundToman(effectivePacks(line) * line.unit_price_toman);
}


/** What a line cost us, for margin.
 *
 *  Reads the cost frozen at sale rather than the product's moving average, which moves
 *  with every purchase receipt. Live, the profit on an order closed in Farvardin would
 *  still be changing in Esfand. */
export function lineCostToman(line: LineSnapshot): number {
  return roundToman(effectivePacks(line) * line.unit_cost_toman);
}

export function orderTotalToman(lines: LineSnapshot[]): number {
  return sumToman(lines.map(lineTotalToman));
}

/** What the customer owes for an order: its lines' total less the approved discount, never below
 *  zero. The one place the subtraction is written (lib/discounts.ts has the rules for the discount). */
export function netOfDiscount(gross: number, discountToman: number): number {
  return Math.max(0, gross - Math.max(0, discountToman));
}

/** The order's weight -- what commission is accrued on. */
export function orderKg(lines: LineSnapshot[]): number {
  return lines.reduce((total, line) => total + lineKg(line), 0);
}

/** Gross margin: charged less cost, both already whole Toman. */
export function orderMarginToman(lines: LineSnapshot[]): number {
  return sumToman(lines.map(lineTotalToman)) - sumToman(lines.map(lineCostToman));
}



/** «1405-00042» -- the Jalali year and a sequence within it.
 *
 *  Latin digits, always. The order number is an identifier that gets typed into a search
 *  box, sorted, and compared for equality; Persian digits would make «۱۴۰۵-۰۰۰۴۲» and
 *  "1405-00042" two different strings for the same order. It is rendered Persian at the
 *  point of display, like every other number in the app.
 *
 *  Padded to five so it sorts as text, and left alone past that width rather than
 *  truncated -- a sixth digit sorts correctly against the next year's numbers anyway,
 *  because the year comes first. */
export function formatOrderNo(jalaliYear: number, sequence: number): string {
  return `${jalaliYear}-${String(sequence).padStart(5, "0")}`;
}
