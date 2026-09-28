import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, TENANT_TABLES } = await import("@/lib/db");
const { backfillCrm, initialFacts } = await import("@/lib/repo/crm/migrate");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const cols = (t: string) => (getDb().prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const NOW = "2026-09-01T00:00:00.000Z";

describe("CRM schema", () => {
  it("creates contacts and activities as tenant tables", () => {
    expect((TENANT_TABLES as readonly string[]).includes("contacts")).toBe(true);
    expect((TENANT_TABLES as readonly string[]).includes("activities")).toBe(true);
    expect(cols("contacts")).toEqual(expect.arrayContaining(["customer_id", "role", "phone_norm", "is_primary", "is_decider"]));
    expect(cols("activities")).toEqual(expect.arrayContaining(["contact_status_to", "stage_to", "verification_to", "signal", "attempt", "miss", "talked", "answers_json"]));
  });
  it("adds the business columns to customers", () => {
    expect(cols("customers")).toEqual(expect.arrayContaining([
      "owner_user_id", "business_type", "phone_norm", "price_tier", "working_hours_json", "location_precision",
      "district_id", "area_label", "source_code", "verification", "contact_status", "sales_stage", "temperature",
      "temperature_manual", "attempt_count", "consecutive_misses", "last_activity_at", "last_contacted_at",
      "next_task_id", "lost_reason_code", "merged_into_id", "closed_at",
    ]));
  });
  it("keeps activities append-only", () => {
    const db = getDb();
    const cid = Number(db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('AO-1','الف',?,1)").run(NOW).lastInsertRowid);
    const aid = Number(db.prepare("INSERT INTO activities (organization_id, customer_id, type, occurred_at, created_at) VALUES (1,?,'note',?,?)").run(cid, NOW, NOW).lastInsertRowid);
    expect(() => db.prepare("UPDATE activities SET note = 'x' WHERE id = ?").run(aid)).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM activities WHERE id = ?").run(aid)).toThrow(/append-only/);
  });
});

describe("backfillCrm", () => {
  it("maps lifecycle to the initial facts", () => {
    expect(initialFacts("lead", 0, NOW)).toMatchObject({ verification_to: "unverified", stage_to: null, contact_status_to: null, signal: null });
    expect(initialFacts("qualified", 0, NOW)).toMatchObject({ stage_to: "interested", signal: "warm", contact_status_to: "contacted" });
    expect(initialFacts("active", 2, NOW).stage_to).toBe("repeat_customer");
    expect(initialFacts("active", 1, NOW).stage_to).toBe("first_order");
    expect(initialFacts("dormant", 0, NOW).stage_to).toBe("customer");
  });
  it("backfills owner, primary contact, phone_norm and state = replay", () => {
    const db = getDb();
    const uid = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('bf1','x','فاطمه','phone_sales',?,1)").run(NOW).lastInsertRowid);
    const lead = Number(db.prepare("INSERT INTO customers (customer_code,business_name,contact_person,phone,synced_at,organization_id,lifecycle) VALUES ('BF-1','سرنخ','علی','0912 000 1234',?,1,'lead')").run(NOW).lastInsertRowid);
    const qual = Number(db.prepare("INSERT INTO customers (customer_code,business_name,salesperson,synced_at,organization_id,lifecycle) VALUES ('BF-2','پیگیری','فاطمه',?,1,'qualified')").run(NOW).lastInsertRowid);
    db.prepare("DELETE FROM app_meta WHERE key = 'crm_backfill_v1'").run();
    backfillCrm(db);

    const l = db.prepare("SELECT * FROM customers WHERE id = ?").get(lead) as Record<string, unknown>;
    expect(l).toMatchObject({ phone_norm: "9120001234", verification: "unverified", contact_status: "not_contacted", sales_stage: "unknown", temperature: "cold" });
    expect(db.prepare("SELECT name, is_primary FROM contacts WHERE customer_id = ?").get(lead)).toEqual({ name: "علی", is_primary: 1 });

    const q = db.prepare("SELECT * FROM customers WHERE id = ?").get(qual) as Record<string, unknown>;
    expect(q).toMatchObject({ owner_user_id: uid, verification: "verified", contact_status: "contacted", sales_stage: "interested", temperature: "warm", last_contacted_at: NOW });
    expect((db.prepare("SELECT COUNT(*) n FROM activities WHERE customer_id = ? AND type = 'system'").get(qual) as { n: number }).n).toBe(1);

    // idempotent: a second run is a no-op
    backfillCrm(db);
    expect((db.prepare("SELECT COUNT(*) n FROM activities WHERE customer_id = ?").get(qual) as { n: number }).n).toBe(1);
  });
});
