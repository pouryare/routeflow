import type { DatabaseSync } from "node:sqlite";
import { Customer, getDb } from "./db";

/** node:sqlite hands back rows with a null prototype. JSON.stringify doesn't care, so
 *  the API route never had to, but React refuses to pass one across the server/client
 *  boundary ("Only plain objects ... can be passed to Client Components"), which the
 *  server-rendered map page does. Rebuilding each row as an object literal is also the
 *  explicit column list -- the page and the API can't drift apart in what they send. */
export function readCustomers(db: DatabaseSync = getDb()): Customer[] {
  const rows = db
    .prepare("SELECT * FROM customers ORDER BY business_name")
    .all() as unknown as Customer[];

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
    status: r.status,
    salesperson: r.salesperson,
    debt_0_7: r.debt_0_7,
    debt_8_30: r.debt_8_30,
    debt_30_plus: r.debt_30_plus,
    notes: r.notes,
    synced_at: r.synced_at,
    last_purchase_date: r.last_purchase_date,
  }));
}
