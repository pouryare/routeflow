/** Change signature of the customer list, for its ETag. Scoped to the company so one company's
 *  edits or payments do not invalidate another's cache (and reveal that they happened). */

import { getDb } from "@/lib/db";
import { orgClause } from "@/lib/orgScope";

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
