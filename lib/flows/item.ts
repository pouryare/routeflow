/** A line a non-CRM flow asks about: a delivery line, a product, a customer. `qty` is what the
 *  system expects; the flow's answer is what actually happened. */
export interface FlowItem {
  id: number;
  label: string;
  qty?: number;
  /** The most a stepper lets the count reach. Defaults to `qty` (a delivery cannot exceed what
   *  was ordered); an order the customer wants MORE of than last time sets it higher. */
  max?: number;
  unit?: string;
  price?: number;
  /** The thing this item belongs to -- a packaging's product id -- when the request needs both. */
  parent?: number;
}

/** A count can be anything from none to what was expected -- never more, never negative. */
export function clampCount(qty: number, n: number): number {
  return Math.min(qty, Math.max(0, Math.trunc(n)));
}
