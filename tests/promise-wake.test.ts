import { describe, it, expect } from "vitest";

process.env.ROUTEFLOW_DB_PATH = `/tmp/rf-promise-wake-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { wakePromises } = await import("@/lib/repo/promises");

describe("T23 promise wake-up", () => {
  it("wakes an unpaid promise once on its day, and closes the task when it is paid", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('pw','x','p','owner',?,1)").run(now)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,owner_user_id,synced_at,organization_id) VALUES ('P1','فروشگاه',  'active',?,?,1)").run(user, now)).lastInsertRowid);
    await db.prepare("INSERT INTO payment_promises (organization_id, customer_id, amount_toman, promised_date, created_by, created_at) VALUES (1,?,500,'2026-03-10',?,'2026-03-01T00:00:00Z')").run(cust, user);
    expect(await wakePromises(1, "2026-03-09")).toBe(0);
    expect(await wakePromises(1, "2026-03-10")).toBe(1);
    expect(await wakePromises(1, "2026-03-11")).toBe(0);
    const open = async () => Number(((await db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE entity_type = 'customer' AND entity_id = ? AND status = 'open'").get(cust)) as { n: number }).n);
    expect(await open()).toBe(1);
    await db.prepare("INSERT INTO payments (organization_id, customer_id, amount_toman, method, received_at, received_by, created_at) VALUES (1,?,500,'CASH','2026-03-10T10:00:00Z',?,'2026-03-10T10:00:00Z')").run(cust, user);
    await wakePromises(1, "2026-03-11");
    expect(await open()).toBe(0);
  });
});
