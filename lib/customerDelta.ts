/** Applying a customer-list change to the list a screen already holds (the answer of GET /api/customers?since=,
 *  built by customersChangedSince in lib/repo/customerList.ts). Browser-safe: no database. */
export interface CustomerDelta<T extends { id: number } = { id: number }> {
  token: string;
  customers: T[];
  removed: number[];
  total: number;
}

/** The held list with the changed customers replaced or added and the removed ones dropped, in the order the
 *  server sends a full list (by name) only when something changed. Returns the SAME array when nothing did, so
 *  a quiet answer costs no re-render. The caller compares the length with `delta.total` and reads the whole
 *  list on a mismatch. */
export function applyCustomerDelta<T extends { id: number; business_name?: string }>(held: T[], delta: Pick<CustomerDelta<T>, "customers" | "removed">): T[] {
  if (delta.customers.length === 0 && delta.removed.length === 0) return held;
  const byId = new Map(held.map((c) => [c.id, c]));
  for (const id of delta.removed) byId.delete(id);
  for (const c of delta.customers) byId.set(c.id, c);
  return [...byId.values()].sort((a, b) => (a.business_name ?? "").localeCompare(b.business_name ?? "", "fa"));
}
