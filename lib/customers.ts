import type { DatabaseSync } from "node:sqlite";
import { Customer, getDb } from "./db";
import { customerDebtsForOrg } from "./repo/payments";

/** node:sqlite hands back rows with a null prototype. JSON.stringify doesn't care, so
 *  the API route never had to, but React refuses to pass one across the server/client
 *  boundary ("Only plain objects ... can be passed to Client Components"), which the
 *  server-rendered map page does. Rebuilding each row as an object literal is also the
 *  explicit column list -- the page and the API can't drift apart in what they send. */
export function readCustomers(
  db: DatabaseSync = getDb(),
  groupIds: number[] | "all" = "all",
  attachDebt?: { organizationId: number }
): Customer[] {
  // An empty scope means "this caller can reach nothing" -- a non-owner with no group
  // assigned yet. Returning early matters: `IN ()` is a syntax error in SQLite, and
  // dropping the clause instead would widen the query to every customer in the province,
  // which is the exact failure the scope exists to prevent.
  if (groupIds !== "all" && groupIds.length === 0) return [];
  const where = groupIds === "all" ? "" : ` WHERE group_id IN (${groupIds.map(() => "?").join(", ")})`;
  const params = groupIds === "all" ? [] : groupIds;
  const rows = db
    .prepare(`SELECT * FROM customers${where} ORDER BY business_name`)
    .all(...params) as unknown as Customer[];

  const debtByCustomer = attachDebt
    ? customerDebtsForOrg(attachDebt.organizationId)
    : undefined;

  return rows.map((r) => ({
    id: r.id,
    customer_code: r.customer_code,
    business_name: r.business_name,
    contact_person: r.contact_person,
    phone: r.phone,
    address: r.address,
    city: r.city,
    province: r.province,
    lat: r.lat,
    lng: r.lng,
    lifecycle: r.lifecycle,
    customer_type: r.customer_type,
    parent_customer_id: r.parent_customer_id,
    payment_terms_days: r.payment_terms_days,
    hard_credit_block: r.hard_credit_block,
    credit_limit_toman: r.credit_limit_toman,
    qualified_at: r.qualified_at,
    first_order_at: r.first_order_at,
    salesperson: r.salesperson,
    opening_balance_toman: r.opening_balance_toman,
    debt: debtByCustomer?.get(r.id),
    notes: r.notes,
    synced_at: r.synced_at,
    last_purchase_date: r.last_purchase_date,
  }));
}
