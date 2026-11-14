import { getDb } from "@/lib/db";
import type { ContactChannel, ContactOff } from "@/lib/contactPrefs";

/** Turn one channel off (with the reason) or back on for a customer of this company. */
export async function setContactPref(organizationId: number, customerId: number, channel: ContactChannel, off: boolean, reason: string, by: number): Promise<boolean> {
  const db = getDb();
  if (!(await db.prepare("SELECT 1 FROM customers WHERE id = ? AND organization_id = ?").get(customerId, organizationId))) return false;
  if (!off) {
    await db.prepare("DELETE FROM contact_preferences WHERE customer_id = ? AND channel = ? AND organization_id = ?").run(customerId, channel, organizationId);
    return true;
  }
  await db
    .prepare(
      `INSERT INTO contact_preferences (organization_id, customer_id, channel, reason, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (customer_id, channel) DO UPDATE SET reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at`
    )
    .run(organizationId, customerId, channel, reason, by, new Date().toISOString());
  return true;
}

/** The switched-off channels of every customer that has any, by customer id. Sparse: most customers have none. */
export async function contactOffByCustomer(organizationId: number): Promise<Map<number, ContactOff[]>> {
  const rows = (await getDb()
    .prepare(
      `SELECT p.customer_id, p.channel, p.reason, p.set_at, u.display_name AS set_by_name
         FROM contact_preferences p LEFT JOIN users u ON u.id = p.set_by WHERE p.organization_id = ?`
    )
    .all(organizationId)) as unknown as (ContactOff & { customer_id: number })[];
  const out = new Map<number, ContactOff[]>();
  for (const r of rows) {
    const list = out.get(Number(r.customer_id)) ?? [];
    list.push({ channel: r.channel, reason: r.reason, set_at: r.set_at, set_by_name: r.set_by_name });
    out.set(Number(r.customer_id), list);
  }
  return out;
}
