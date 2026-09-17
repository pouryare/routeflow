import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-intel-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  getDb().close();
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const cols = (t: string) => (getDb().prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const NOW = "2026-09-01T00:00:00.000Z";

describe("walk-in intel + tags schema", () => {
  it("adds the intel columns and the tenant-scoped customer_tags table", () => {
    expect(cols("customers")).toEqual(expect.arrayContaining(["supply_channel", "visit_window", "visit_note", "uses_products_json"]));
    expect((TENANT_TABLES as readonly string[]).includes("customer_tags")).toBe(true);
    expect(cols("customer_tags")).toEqual(expect.arrayContaining(["organization_id", "customer_id", "tag", "created_at"]));
  });

  it("persists intel facts and a tag on a lead and reads them back", () => {
    const db = getDb();
    const id = Number(db.prepare("INSERT INTO customers (customer_code,business_name,synced_at,organization_id,lifecycle) VALUES ('IT-1','کافه اینتل',?,1,'lead')").run(NOW).lastInsertRowid);
    db.prepare("UPDATE customers SET supply_channel = ?, visit_window = ?, visit_note = ?, uses_products_json = ? WHERE id = ?")
      .run("competitor", "morning", "سراغ آقای رضایی", JSON.stringify([3, 7]), id);
    db.prepare("INSERT INTO customer_tags (organization_id, customer_id, tag, created_at) VALUES (1, ?, 'snappfood', ?)").run(id, NOW);
    const row = db.prepare("SELECT supply_channel, visit_window, visit_note, uses_products_json FROM customers WHERE id = ?").get(id) as Record<string, unknown>;
    expect(row).toEqual({ supply_channel: "competitor", visit_window: "morning", visit_note: "سراغ آقای رضایی", uses_products_json: "[3,7]" });
    const tags = db.prepare("SELECT tag FROM customer_tags WHERE customer_id = ? ORDER BY tag").all(id) as { tag: string }[];
    expect(tags.map((t) => t.tag)).toEqual(["snappfood"]);
    expect(() => db.prepare("INSERT INTO customer_tags (organization_id, customer_id, tag, created_at) VALUES (1, ?, 'snappfood', ?)").run(id, NOW)).toThrow(/UNIQUE/);
  });
});
