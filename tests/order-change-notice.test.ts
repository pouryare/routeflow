import { describe, it, expect } from "vitest";
import { orderChangeLine } from "@/lib/orderChangeText";

process.env.ROUTEFLOW_DB_PATH = `/tmp/rf-order-change-notice-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { applyOrderDetail } = await import("@/lib/repo/orderEdits");

describe("FB24 change line", () => {
  it("names what changed", () => {
    expect(orderChangeLine("requested_day", "۱۲ دی")).toBe("موعد تحویل به ۱۲ دی منتقل شد");
    expect(orderChangeLine("ship_address", "x")).toContain("آدرس");
  });
});

describe("FB24 driver push", () => {
  it("goes to the driver with a pending stop, not to one whose run is done", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const mk = async (n: string, role: string) => Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,'x',?,?,?,1)").run(n, n, role, now)).lastInsertRowid);
    const owner = await mk("oc-o", "owner");
    const d1 = await mk("oc-d1", "delivery_driver");
    const d2 = await mk("oc-d2", "delivery_driver");
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('OC1','فروشگاه','active',?,1)").run(now)).lastInsertRowid);
    const order = Number((await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,created_by,created_at,updated_at,organization_id) VALUES ('OC-1',?,'2026-09-10','READY',?,?,?,1)").run(cust, owner, now, now)).lastInsertRowid);
    const run = async (driver: number, status: string) => Number((await db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, created_at, updated_at, organization_id) VALUES (?, '2026-09-11', ?, ?, ?, ?, 1)").run(driver, status, owner, now, now)).lastInsertRowid);
    const r1 = await run(d1, "ready");
    const r2 = await run(d2, "done");
    await db.prepare("INSERT INTO delivery_stops (run_id, order_id, status, created_at) VALUES (?,?,'pending',?)").run(r1, order, now);
    await db.prepare("INSERT INTO delivery_stops (run_id, order_id, status, created_at) VALUES (?,?,'pending',?)").run(r2, order, now);
    await applyOrderDetail(1, order, "ship_address", "تهران، خیابان آزادی", owner, "اصلاح آدرس");
    const got = ((await db.prepare("SELECT user_id FROM notifications WHERE type_code = 'order.changed'").all()) as { user_id: number }[]).map((r) => Number(r.user_id));
    expect(got).toEqual([d1]);
  });
});
