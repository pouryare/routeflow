import type { DatabaseSync } from "node:sqlite";
import { replayCrmState } from "@/lib/crm/replay";
import { lifecycleFor } from "@/lib/crm/stage";
import type { CustomerLifecycle } from "@/lib/types";
import { ACTIVITY_FACT_COLUMNS } from "./migrate";

/** Rebuild cached state on the caller's transaction connection. */
export function recomputeState(db: DatabaseSync, customerId: number): void {
  const acts = db.prepare(`SELECT ${ACTIVITY_FACT_COLUMNS} FROM activities WHERE customer_id = ? ORDER BY occurred_at, id`).all(customerId) as never[];
  const s = replayCrmState(acts);
  const c = db.prepare("SELECT lifecycle, COALESCE(temperature_manual, 0) AS manual, temperature FROM customers WHERE id = ?").get(customerId) as
    { lifecycle: CustomerLifecycle; manual: number; temperature: string | null };
  db.prepare(`UPDATE customers SET contact_status = ?, sales_stage = ?, verification = ?, temperature = ?, attempt_count = ?,
                consecutive_misses = ?, last_activity_at = ?, last_contacted_at = ?, lifecycle = ? WHERE id = ?`)
    .run(s.contact_status, s.sales_stage, s.verification, c.manual ? c.temperature : s.temperature, s.attempt_count,
      s.consecutive_misses, s.last_activity_at, s.last_contacted_at, lifecycleFor(s.sales_stage, c.lifecycle), customerId);
}
