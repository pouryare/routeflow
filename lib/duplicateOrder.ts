/** F72: is the order being entered most likely a second copy of one already open?
 *
 *  The rule is the entry's first slice: the same customer has another open order created in the
 *  last 24 hours with exactly the same set of products (packs may differ). A big customer who
 *  really orders twice a day answers once, «this is a new order», and carries on; nothing blocks. */

export const DUPLICATE_WINDOW_HOURS = 24;

export interface OpenOrderBrief {
  id: number;
  order_no: string;
  created_at: string;
  product_ids: number[];
}

/** The open order the new lines repeat, newest first, or null. */
export function duplicateOf(recent: OpenOrderBrief[], productIds: number[]): OpenOrderBrief | null {
  const want = [...new Set(productIds)].sort((a, b) => a - b).join(",");
  if (want === "") return null;
  return recent.find((o) => [...new Set(o.product_ids)].sort((a, b) => a - b).join(",") === want) ?? null;
}
