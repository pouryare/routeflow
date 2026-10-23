import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-conv-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { advanceOrder } = await import("@/lib/repo/orders");
afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const NOW = "2026-09-10T08:00:00.000Z";
const db = getDb();
const rep = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('cv','x','cv','phone_sales',?,1)").run(NOW)).lastInsertRowid);
const lead = Number((await db.prepare(`INSERT INTO customers (customer_code, business_name, owner_user_id, lifecycle, verification, sales_stage, contact_status, temperature, synced_at, organization_id)
  VALUES ('CV-1', 'سرنخ خریدار', ?, 'lead', 'unverified', 'unknown', 'not_contacted', 'cold', ?, 1)`).run(rep, NOW)).lastInsertRowid);
let n = 0;
const order = async (type = "SALE") => Number((await db.prepare(`INSERT INTO orders (order_no, customer_id, order_date, status, order_type, created_by, created_at, updated_at, organization_id)
  VALUES (?, ?, '2026-09-10', 'OUT_FOR_DELIVERY', ?, ?, ?, ?, 1)`).run(`CV-${++n}`, lead, type, rep, NOW, NOW)).lastInsertRowid);
const row = async () => await db.prepare("SELECT sales_stage, lifecycle, verification, first_order_at FROM customers WHERE id = ?").get(lead) as Record<string, unknown>;

describe("conversion on delivery", () => {
  it("a delivered sample changes nothing", async () => {
    await advanceOrder(1, await order("SAMPLE"), "deliver", { id: null, role: "system" });
    expect(await row()).toMatchObject({ sales_stage: "unknown", lifecycle: "lead", first_order_at: null });
  });
  it("the first delivered sale makes a customer, verified, with first_order_at", async () => {
    await advanceOrder(1, await order(), "deliver", { id: null, role: "system" });
    expect(await row()).toMatchObject({ sales_stage: "first_order", lifecycle: "active", verification: "verified" });
    expect((await row()).first_order_at).toBeTruthy();
    expect(await db.prepare("SELECT COUNT(*) n FROM activities WHERE customer_id = ? AND type = 'order'").get(lead)).toEqual({ n: 1 });
  });
  it("the second makes a repeat customer and keeps the first date", async () => {
    const first = (await row()).first_order_at;
    await advanceOrder(1, await order(), "deliver", { id: null, role: "system" });
    expect(await row()).toMatchObject({ sales_stage: "repeat_customer", first_order_at: first });
  });
});
