/** What did we charge, and when.
 *
 *  A spreadsheet holds one price per product, in one cell. That is the failure this
 *  module exists to prevent: editing that cell does not just change today's price, it
 *  silently rewrites what every past order was worth, because the past orders were only
 *  ever multiplying against the cell. Revenue for a month that closed weeks ago changes
 *  while you are looking at it.
 *
 *  So a price is a row with a start date, changing a price is an INSERT, and no row is
 *  ever updated. This module answers the one question that shape makes non-trivial:
 *  which row was in force on a given day.
 *
 *  Note this is only half of the mechanism. Resolving the price at the moment of sale is
 *  what this does; the order line then *snapshots* the answer, so the historical figure
 *  survives even a deliberate retroactive correction to the price table. Lookup alone
 *  would still let history move.
 */

export interface PriceRow {
  id: number;
  price_toman: number;
  /** ISO date the price takes effect, inclusive. */
  valid_from: string;
}

/** The price in force on a date, or null if the product had no price yet.
 *
 *  Null rather than zero, and rather than falling back to the earliest price: a product
 *  with no price on the day of sale is a data problem the person recording the order has
 *  to see, not something to paper over with a number that was never charged.
 */
export function priceAt<T extends PriceRow>(rows: T[], onDate: string): T | null {
  // Compare on the date part alone. valid_from is a civil date and onDate may be a full
  // timestamp; "2026-05-01T09:00:00Z" > "2026-05-01" as a string, which would be right
  // by luck here but wrong the moment valid_from grew a time of its own.
  const day = onDate.slice(0, 10);

  let best: T | null = null;
  for (const candidate of rows) {
    if (candidate.valid_from.slice(0, 10) > day) continue;
    if (best === null) {
      best = candidate;
      continue;
    }
    const bestDay = best.valid_from.slice(0, 10);
    const candidateDay = candidate.valid_from.slice(0, 10);
    // A later start wins. On a tie the higher id wins, which is the row inserted second
    // -- a price corrected on the day it was entered, where taking the first would keep
    // the typo forever.
    if (candidateDay > bestDay || (candidateDay === bestDay && candidate.id > best.id)) {
      best = candidate;
    }
  }
  return best;
}

/** Every price for a product, newest first, for the "why was it this price?" view.
 *
 *  Copies before sorting: the caller's array is usually the rows straight off a query
 *  that something else is also reading, and a helper that reorders its own input is a
 *  bug waiting for a second caller. On a shared start date the correction sorts above
 *  the row it corrects, matching what priceAt would have picked.
 */
export function priceHistory<T extends PriceRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byDate = b.valid_from.slice(0, 10).localeCompare(a.valid_from.slice(0, 10));
    return byDate !== 0 ? byDate : b.id - a.id;
  });
}
