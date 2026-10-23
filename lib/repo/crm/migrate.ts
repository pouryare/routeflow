import type { Db } from "@/lib/database/client";
import { normPhone } from "@/lib/crm/phone";
import { replayCrmState, type ActivityFacts } from "@/lib/crm/replay";
import type { SalesStage, Temperature } from "@/lib/crm/vocab";

/** The activity columns the replay folds, as a SELECT list. */
export const ACTIVITY_FACT_COLUMNS =
  "occurred_at, contact_status_to, stage_to, verification_to, signal, attempt, miss, talked";

/** Called from getDb() before the TENANT_TABLES loop, which ALTERs every listed table. */
export async function createCrmTables(db: Db): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      name TEXT,
      role TEXT NOT NULL DEFAULT 'OTHER',
      phone TEXT,
      phone_norm TEXT,
      whatsapp TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      is_decider INTEGER NOT NULL DEFAULT 0,
      best_time TEXT,
      note TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_contacts_customer ON contacts(customer_id);
    CREATE INDEX IF NOT EXISTS ix_contacts_phone ON contacts(organization_id, phone_norm);

    /* Append-only: a correction is a new row pointing at the one it corrects. The replay
       folds the *_to / signal / flag columns, never the outcome code. */
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      user_id INTEGER REFERENCES users(id),
      contact_id INTEGER REFERENCES contacts(id),
      type TEXT NOT NULL,
      outcome_code TEXT,
      attempt_no INTEGER,
      phone_used TEXT,
      note TEXT,
      answers_json TEXT,
      contact_status_to TEXT,
      stage_to TEXT,
      verification_to TEXT,
      signal TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      miss INTEGER NOT NULL DEFAULT 0,
      talked INTEGER NOT NULL DEFAULT 0,
      completed_task_id INTEGER,
      next_task_id INTEGER,
      corrects_activity_id INTEGER REFERENCES activities(id),
      client_uuid TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_activities_customer ON activities(customer_id, occurred_at, id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_activities_client_uuid ON activities(organization_id, client_uuid) WHERE client_uuid IS NOT NULL;
    CREATE TRIGGER IF NOT EXISTS activities_no_update BEFORE UPDATE ON activities
      BEGIN SELECT RAISE(ABORT, 'activities is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS activities_no_delete BEFORE DELETE ON activities
      BEGIN SELECT RAISE(ABORT, 'activities is append-only'); END;

    /* Tags a rep or manager pins to a business (فهرست‌ها، not free text in notes). */
    CREATE TABLE IF NOT EXISTS customer_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (customer_id, tag)
    );

    /* A driver's visit to a saved lead location (saved_locations). */
    CREATE TABLE IF NOT EXISTS lead_visit_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      location_id INTEGER NOT NULL REFERENCES saved_locations(id),
      user_id INTEGER REFERENCES users(id),
      outcome_code TEXT,
      answers_json TEXT,
      client_uuid TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_lva_location ON lead_visit_activities(organization_id, location_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_lva_client_uuid ON lead_visit_activities(organization_id, location_id, client_uuid) WHERE client_uuid IS NOT NULL;
  `);
}

const CUSTOMER_COLUMNS: [string, string][] = [
  ["owner_user_id", "INTEGER REFERENCES users(id)"], ["business_type", "TEXT"], ["secondary_phone", "TEXT"],
  ["whatsapp", "TEXT"], ["instagram", "TEXT"], ["website", "TEXT"], ["phone_norm", "TEXT"], ["size_band", "TEXT"],
  ["price_tier", "TEXT"], ["working_hours_json", "TEXT"], ["location_precision", "TEXT"], ["maps_url", "TEXT"],
  ["rating_potential", "INTEGER"], ["rating_volume", "INTEGER"], ["rating_ease", "INTEGER"], ["district_id", "INTEGER"],
  ["area_label", "TEXT"], ["source_code", "TEXT"], ["source_detail", "TEXT"], ["source_url", "TEXT"],
  ["referred_by_customer_id", "INTEGER"], ["verification", "TEXT"], ["contact_status", "TEXT"], ["sales_stage", "TEXT"],
  ["temperature", "TEXT"], ["temperature_manual", "INTEGER NOT NULL DEFAULT 0"], ["attempt_count", "INTEGER NOT NULL DEFAULT 0"],
  ["consecutive_misses", "INTEGER NOT NULL DEFAULT 0"], ["last_activity_at", "TEXT"], ["last_contacted_at", "TEXT"],
  ["next_task_id", "INTEGER"], ["lost_reason_code", "TEXT"], ["merged_into_id", "INTEGER"], ["closed_at", "TEXT"],
  // Walk-in intel (lib/crm/flows/intel.ts); size_band above is shared with it.
  ["supply_channel", "TEXT"], ["visit_window", "TEXT"], ["visit_note", "TEXT"], ["uses_products_json", "TEXT"],
];

/** Called from getDb() after backfillReminderTasks, when every customers column it reads exists. */
export async function migrateCrm(db: Db): Promise<void> {
  const have = new Set((await db.prepare("PRAGMA table_info(customers)").all() as { name: string }[]).map((c) => c.name));
  for (const [col, type] of CUSTOMER_COLUMNS) if (!have.has(col)) await db.exec(`ALTER TABLE customers ADD COLUMN ${col} ${type}`);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS ix_customers_phone_norm ON customers(organization_id, phone_norm);
    CREATE INDEX IF NOT EXISTS ix_customers_owner ON customers(organization_id, owner_user_id);
    CREATE INDEX IF NOT EXISTS ix_customers_next_task ON customers(next_task_id);
    CREATE INDEX IF NOT EXISTS ix_customers_instagram ON customers(organization_id, instagram);
  `);
  // saved_locations columns added after the initial CREATE TABLE.
  const locHave = new Set((await db.prepare("PRAGMA table_info(saved_locations)").all() as { name: string }[]).map((c) => c.name));
  if (!locHave.has("rating_potential")) await db.exec("ALTER TABLE saved_locations ADD COLUMN rating_potential REAL");
  if (!locHave.has("rating_volume")) await db.exec("ALTER TABLE saved_locations ADD COLUMN rating_volume REAL");
  if (!locHave.has("rating_ease")) await db.exec("ALTER TABLE saved_locations ADD COLUMN rating_ease REAL");
  if (!locHave.has("visit_outcome")) await db.exec("ALTER TABLE saved_locations ADD COLUMN visit_outcome TEXT");
  await backfillCrm(db);
}

export function initialFacts(lifecycle: string, deliveredOrders: number, at: string): ActivityFacts {
  const lead = lifecycle === "lead";
  let stage: SalesStage;
  if (lead) stage = "unknown";
  else if (lifecycle === "qualified") stage = "interested";
  else if (lifecycle === "sampled") stage = "sample";
  else if (lifecycle === "lost") stage = "lost";
  else stage = deliveredOrders >= 2 ? "repeat_customer" : deliveredOrders === 1 ? "first_order" : "customer";
  const signal: Temperature | null = lifecycle === "qualified" ? "warm" : lifecycle === "sampled" ? "hot" : null;
  return {
    occurred_at: at,
    contact_status_to: lead ? null : "contacted",
    stage_to: stage === "unknown" ? null : stage,
    verification_to: lead ? "unverified" : "verified",
    signal,
    attempt: 0,
    miss: 0,
    talked: lead ? 0 : 1,
  };
}

/** One-time: owner from the free-text salesperson, a primary contact from contact_person /
 *  phone, one 'system' activity carrying each business's starting facts, and the cached
 *  state columns written from the replay of that activity. Guarded on app_meta. */
export async function backfillCrm(db: Db): Promise<void> {
  if (await db.prepare("SELECT value FROM app_meta WHERE key = 'crm_backfill_v1'").get()) return;
  const now = new Date().toISOString();
  await db.tx(async () => {
    await db.exec(`
      UPDATE customers SET owner_user_id = (
        SELECT u.id FROM users u
         WHERE u.organization_id = customers.organization_id AND u.display_name = customers.salesperson
           AND u.role IN ('phone_sales', 'group_manager', 'rep_manager', 'owner') AND u.active = 1
         ORDER BY u.id LIMIT 1)
      WHERE owner_user_id IS NULL AND salesperson IS NOT NULL AND TRIM(salesperson) <> ''`);

    const delivered = new Map<number, number>(
      (await db.prepare(`SELECT customer_id, COUNT(*) n FROM orders
                    WHERE status IN ('DELIVERED', 'CLOSED') AND COALESCE(order_type, 'SALE') = 'SALE'
                    GROUP BY customer_id`).all() as { customer_id: number; n: number }[]).map((r) => [r.customer_id, r.n])
    );
    const customers = await db.prepare("SELECT id, organization_id, phone, contact_person, lifecycle, synced_at FROM customers").all() as {
      id: number; organization_id: number; phone: string | null; contact_person: string | null; lifecycle: string; synced_at: string;
    }[];
    const insContact = db.prepare(`INSERT INTO contacts (organization_id, customer_id, name, role, phone, phone_norm, is_primary, is_decider, created_at, updated_at)
                                   VALUES (?, ?, ?, 'OTHER', ?, ?, 1, 0, ?, ?)`);
    const insAct = db.prepare(`INSERT INTO activities (organization_id, customer_id, type, note, contact_status_to, stage_to, verification_to, signal, attempt, miss, talked, occurred_at, created_at)
                               VALUES (?, ?, 'system', 'وضعیت اولیه از داده‌های پیشین', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const openTask = db.prepare(`SELECT id FROM tasks WHERE entity_type = 'customer' AND entity_id = ? AND status = 'open'
                                 ORDER BY COALESCE(due_at, '9999'), id LIMIT 1`);
    const upd = db.prepare(`UPDATE customers SET phone_norm = ?, contact_status = ?, sales_stage = ?, verification = ?, temperature = ?,
                              attempt_count = ?, consecutive_misses = ?, last_activity_at = ?, last_contacted_at = ?, next_task_id = ?
                            WHERE id = ?`);
    for (const c of customers) {
      const norm = normPhone(c.phone);
      const name = c.contact_person?.trim() || null;
      if (name || norm) await insContact.run(c.organization_id, c.id, name, c.phone, norm, now, now);
      const f = initialFacts(c.lifecycle, delivered.get(c.id) ?? 0, c.synced_at);
      await insAct.run(c.organization_id, c.id, f.contact_status_to, f.stage_to, f.verification_to, f.signal, f.attempt, f.miss, f.talked, f.occurred_at, now);
      const s = replayCrmState([f]);
      const task = await openTask.get(c.id) as { id: number } | undefined;
      await upd.run(norm, s.contact_status, s.sales_stage, s.verification, s.temperature, s.attempt_count, s.consecutive_misses,
        s.last_activity_at, s.last_contacted_at, task?.id ?? null, c.id);
    }
    await db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('crm_backfill_v1', ?)").run(now);
  });
}



