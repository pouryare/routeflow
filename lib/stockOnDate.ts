/** D9: stock on a past day. Pure. Example: 100 in on day 1, 30 out on day 5, asked for day 3 → 100; asked for day 6 → 70. */
export interface Movement { productId: number; baseQty: number; occurredAt: string }

/** Quantity per product of every movement up to and including `isoDay` (a YYYY-MM-DD). Movements are signed
 *  (a delivery is negative), so the sum is what was on the shelves at the end of that day. */
export function quantitiesOn(movements: Movement[], isoDay: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of movements) {
    if (m.occurredAt.slice(0, 10) > isoDay) continue;
    out.set(m.productId, (out.get(m.productId) ?? 0) + m.baseQty);
  }
  return out;
}
