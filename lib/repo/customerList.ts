/** Change signature of the customer list, for its ETag. Scoped to the company so one company's
 *  edits or payments do not invalidate another's cache (and reveal that they happened). */

import { getDb } from "@/lib/db";
import { orgClause } from "@/lib/orgScope";
import { readCustomers } from "@/lib/customers";
import { tombstonesSinceXid } from "@/lib/repo/tombstones";
import type { Customer } from "@/lib/db";

export async function customerListSignature(organizationId: number | null): Promise<{ customers: { c: number; m: string | null }; payments: { c: number; m: string | null } }> {
  const db = getDb();
  const org = orgClause("organization_id", organizationId);
  const customers = await db.prepare(`SELECT COUNT(*) c, MAX(synced_at) m FROM customers WHERE 1 = 1${org.sql}`).get(...org.params) as {
    c: number;
    m: string | null;
  };
  // Debt is computed and attached per row, so a payment changes the body without touching
  // customers.synced_at: the payments ledger is part of the key.
  const payments = await db
    .prepare(`SELECT COUNT(*) c, MAX(COALESCE(voided_at, created_at)) m FROM payments WHERE 1 = 1${org.sql}`)
    .get(...org.params) as { c: number; m: string | null };
  return { customers, payments };
}

/** A bookmark into the customer list: `d1.<transaction id>.<ms>`. The transaction id finds customers and
 *  orders that changed (their sync_xid, as the offline sync does); the time finds payments, which carry no
 *  sync_xid but move a customer's debt. */
function customerToken(xmin: string, nowMs: number): string {
  return `d1.${xmin}.${nowMs}`;
}
export function parseCustomerToken(token: string | null): { xid: string; ms: number } | null {
  const m = /^d1\.(\d{1,20})\.(\d{10,15})$/.exec(token ?? "");
  return m ? { xid: m[1], ms: Number(m[2]) } : null;
}
/** Payments are looked back this far before the bookmark, because one written just before it may commit just after. */
const PAYMENT_OVERLAP_MS = 60_000;

export async function currentCustomerToken(): Promise<string> {
  const row = (await getDb().prepare("SELECT CAST(pg_snapshot_xmin(pg_current_snapshot()) AS text) AS x").get()) as { x: string };
  return customerToken(row.x, Date.now());
}

/** What changed in the customer list since a bookmark: the customers whose row, orders or payments changed,
 *  the ids that were deleted, the list's size now (the phone checks its own count against it and starts over
 *  on a mismatch, which also covers a customer that moved out of this person's groups), and the next
 *  bookmark. Taken BEFORE the rows are read, so nothing committed in between is missed; a row seen twice is
 *  harmless because the phone upserts by id. Null when the bookmark is not one of ours.
 *  shortcut: reads the whole scoped list and keeps the changed rows, as the full endpoint does; move the id
 *  filter into SQL if the customer count grows past a few thousand. */
export async function customersChangedSince(
  organizationId: number,
  groupIds: number[] | "all",
  token: string | null
): Promise<{ token: string; customers: Customer[]; removed: number[]; total: number } | null> {
  const since = parseCustomerToken(token);
  if (!since) return null;
  const db = getDb();
  const next = await currentCustomerToken();
  const sinceIso = new Date(since.ms - PAYMENT_OVERLAP_MS).toISOString();
  const changedRows = (await db
    .prepare(
      `SELECT id FROM customers WHERE organization_id = ? AND COALESCE(sync_xid, '0') >= CAST(? AS xid8)
       UNION SELECT customer_id FROM orders WHERE organization_id = ? AND COALESCE(sync_xid, '0') >= CAST(? AS xid8)
       UNION SELECT customer_id FROM payments WHERE organization_id = ? AND COALESCE(voided_at, created_at) >= ?`
    )
    .all(organizationId, since.xid, organizationId, since.xid, organizationId, sinceIso)) as { id: number }[];
  const changed = new Set(changedRows.map((r) => Number(r.id)));
  const all = await readCustomers(db, groupIds, { organizationId });
  const removed = (await tombstonesSinceXid(organizationId, since.xid, db))
    .filter((t) => t.entity_type === "customers")
    .map((t) => t.entity_id);
  return { token: next, customers: all.filter((c) => changed.has(c.id)), removed, total: all.length };
}
