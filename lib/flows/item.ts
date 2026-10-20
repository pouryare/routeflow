/** A line a non-CRM flow asks about: a delivery line, a product, a customer. `qty` is what the
 *  system expects; the flow's answer is what actually happened. */
export interface FlowItem {
  id: number;
  label: string;
  qty?: number;
  unit?: string;
  price?: number;
}

/** A count can be anything from none to what was expected -- never more, never negative. */
export function clampCount(qty: number, n: number): number {
  return Math.min(qty, Math.max(0, Math.trunc(n)));
}
