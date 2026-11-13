/** FB6 / T2: a saved view is the list's filter keys as one query string. Pure. Example: "status=open&day=today&page=3&x=1"
 *  keeps "day=today&status=open" (known keys only, no page, sorted), so two spellings of one filter compare equal. */
const ORDER_VIEW_KEYS = ["q", "status", "payment", "rep", "day", "min", "max"] as const;

export function canonicalQuery(search: string, keys: readonly string[] = ORDER_VIEW_KEYS): string {
  const from = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const k of [...keys].sort()) {
    const v = from.get(k);
    if (v) out.set(k, v);
  }
  return out.toString();
}

export const sameView = (a: string, b: string): boolean => canonicalQuery(a) === canonicalQuery(b);

export function viewNameProblem(name: string): string | null {
  const n = name.trim();
  return n.length === 0 ? "برای این نما یک نام بنویسید" : n.length > 40 ? "نام نما خیلی بلند است" : null;
}
