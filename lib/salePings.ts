export interface PingOrder {
  id: number;
  order_no: string;
  customer_name: string;
  total_toman: number;
}

/** How many new orders one check shows; the rest are folded into the count. */
export const PING_MAX = 3;

/** What a check for new orders answers. `orders` is the caller's newest orders, newest first.
 *
 *  Without `after` (the first check on a page) nothing is new: it only reports where the
 *  list stands, so opening the page never replays old orders as pings. With it, the orders
 *  above that id are new; at most `PING_MAX` come back, and `more` counts the rest. */
export function pingsAfter(orders: PingOrder[], after: number | null): { latest: number; fresh: PingOrder[]; more: number } {
  const latest = orders.reduce((m, o) => Math.max(m, o.id), after ?? 0);
  if (after === null) return { latest, fresh: [], more: 0 };
  const all = orders.filter((o) => o.id > after);
  return { latest, fresh: all.slice(0, PING_MAX), more: Math.max(0, all.length - PING_MAX) };
}
