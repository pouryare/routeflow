import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { dueDateFor } from "@/lib/paymentTerms";
import { tehranTodayIso } from "@/lib/jalali";

const testDbPath = path.join(os.tmpdir(), `rf-terms-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { advanceOrder } = await import("@/lib/repo/orders");
afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("D5 due date at delivery", () => {
  it("is written from the customer's terms and does not move when the terms change", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('tm','x','t','owner',?,1)").run(now)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,payment_terms_kind,payment_terms_days,synced_at,organization_id) VALUES ('T1','ف','active','days',10,?,1)").run(now)).lastInsertRowid);
    const orderId = Number((await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,created_by,created_at,updated_at,organization_id) VALUES ('TM-1',?,'2026-09-10','OUT_FOR_DELIVERY',?,?,?,1)").run(cust, user, now, now)).lastInsertRowid);
    await advanceOrder(1, orderId, "deliver", { id: null, role: "system" });
    const read = async () => (await db.prepare("SELECT due_date, delivered_at FROM orders WHERE id = ?").get(orderId)) as { due_date: string; delivered_at: string };
    const first = await read();
    expect(first.due_date).toBe(dueDateFor("days", 10, tehranTodayIso(new Date(first.delivered_at))));
    await db.prepare("UPDATE customers SET payment_terms_kind = 'cod' WHERE id = ?").run(cust);
    expect((await read()).due_date).toBe(first.due_date);
  });
});
