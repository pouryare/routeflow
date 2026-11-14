import { getDb } from "@/lib/db";
import { reasonLabel, reviveDue } from "@/lib/leadRevive";
import { createTask } from "./tasks";

/** S16: lost leads whose rest is over go back to the pool with a call-again task that names the reason they were lost.
 *  A lead that asked not to be called (S15) stays lost. Returns how many came back. Runs once a day per company. */
export async function reviveLostLeads(organizationId: number, now = new Date()): Promise<number> {
  const db = getDb();
  const overrideRow = (await db.prepare("SELECT value FROM app_meta WHERE key = ?").get(`revive_days:${organizationId}`)) as { value: string } | undefined;
  // shortcut: the owner's own days live in app_meta by hand until a settings form exists.
  const overrides = overrideRow ? (JSON.parse(overrideRow.value) as Record<string, number>) : undefined;
  const rows = (await db
    .prepare(
      `SELECT c.id, c.business_name, c.group_id, c.lost_reason_code AS reason,
              COALESCE(c.last_activity_at, c.last_contacted_at, c.synced_at) AS last_at
         FROM customers c
        WHERE c.organization_id = ? AND c.sales_stage IN ('lost', 'not_interested') AND c.lifecycle IN ('lead', 'lost')
          AND c.closed_at IS NULL AND c.merged_into_id IS NULL AND c.lost_reason_code IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM contact_preferences p WHERE p.customer_id = c.id AND p.channel = 'calls')`
    )
    .all(organizationId)) as unknown as { id: number; business_name: string; group_id: number | null; reason: string; last_at: string }[];
  let back = 0;
  for (const r of rows) {
    if (!reviveDue(r.reason, r.last_at, now, overrides)) continue;
    await db.tx(async () => {
      await db
        .prepare("UPDATE customers SET sales_stage = 'unknown', lifecycle = 'lead', owner_user_id = NULL, last_activity_at = ? WHERE id = ? AND organization_id = ?")
        .run(now.toISOString(), r.id, organizationId);
      await createTask(organizationId, {
        title: `تماس دوباره · ${r.business_name} · قبلاً: ${reasonLabel(r.reason)}`,
        kind: "call",
        role_hint: "phone_sales",
        group_id: r.group_id,
        entity_type: "customer",
        entity_id: r.id,
        due_at: now.toISOString(),
      });
    });
    back++;
  }
  return back;
}
