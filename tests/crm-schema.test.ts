import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { tableInfo } from "./helpers/schema";

const testDbPath = path.join(os.tmpdir(), `rf-crm-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, TENANT_TABLES } = await import("@/lib/db");
const { initialFacts } = await import("@/lib/repo/crm/migrate");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const cols = async (t: string) => (await tableInfo(t) as { name: string }[]).map((c) => c.name);
const NOW = "2026-09-01T00:00:00.000Z";

describe("CRM schema", () => {
  it("creates contacts and activities as tenant tables", async () => {
    expect((TENANT_TABLES as readonly string[]).includes("contacts")).toBe(true);
    expect((TENANT_TABLES as readonly string[]).includes("activities")).toBe(true);
    expect(await cols("contacts")).toEqual(expect.arrayContaining(["customer_id", "role", "phone_norm", "is_primary", "is_decider"]));
    expect(await cols("activities")).toEqual(expect.arrayContaining(["contact_status_to", "stage_to", "verification_to", "signal", "attempt", "miss", "talked", "answers_json"]));
  });
  it("adds the business columns to customers", async () => {
    expect(await cols("customers")).toEqual(expect.arrayContaining([
      "owner_user_id", "business_type", "phone_norm", "price_tier", "working_hours_json", "location_precision",
      "district_id", "area_label", "source_code", "verification", "contact_status", "sales_stage", "temperature",
      "temperature_manual", "attempt_count", "consecutive_misses", "last_activity_at", "last_contacted_at",
      "next_task_id", "lost_reason_code", "merged_into_id", "closed_at",
    ]));
  });
  it("keeps activities append-only", async () => {
    const db = getDb();
    const cid = Number((await db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('AO-1','الف',?,1)").run(NOW)).lastInsertRowid);
    const aid = Number((await db.prepare("INSERT INTO activities (organization_id, customer_id, type, occurred_at, created_at) VALUES (1,?,'note',?,?)").run(cid, NOW, NOW)).lastInsertRowid);
    await expect((async () => await db.prepare("UPDATE activities SET note = 'x' WHERE id = ?").run(aid))()).rejects.toThrow(/append-only/);
    await expect((async () => await db.prepare("DELETE FROM activities WHERE id = ?").run(aid))()).rejects.toThrow(/append-only/);
  });
});

describe("initialFacts", () => {
  it("maps lifecycle to the initial facts", () => {
    expect(initialFacts("lead", 0, NOW)).toMatchObject({ verification_to: "unverified", stage_to: null, contact_status_to: null, signal: null });
    expect(initialFacts("qualified", 0, NOW)).toMatchObject({ stage_to: "interested", signal: "warm", contact_status_to: "contacted" });
    expect(initialFacts("active", 2, NOW).stage_to).toBe("repeat_customer");
    expect(initialFacts("active", 1, NOW).stage_to).toBe("first_order");
    expect(initialFacts("dormant", 0, NOW).stage_to).toBe("customer");
  });
});
