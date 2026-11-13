import { describe, it, expect } from "vitest";
import { dueDateFor, parseDays, serializeDays } from "@/lib/dueReminders";

process.env.ROUTEFLOW_DB_PATH = `/tmp/rf-due-reminders-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { queueDueReminders, setDueReminderDays } = await import("@/lib/repo/dueReminders");

describe("A8 reminder days (pure)", () => {
  it("reads and writes the list, and finds the due date for a day", () => {
    expect(parseDays("3, -3,0,x,3")).toEqual([-3, 0, 3]);
    expect(parseDays(null)).toEqual([]);
    expect(serializeDays([])).toBeNull();
    expect(dueDateFor("2026-03-10", -3)).toBe("2026-03-13");
    expect(dueDateFor("2026-03-10", 3)).toBe("2026-03-07");
  });
});

describe("A8 reminder tasks", () => {
  it("makes one call task per order and day for an unpaid order, none for a paid one, and not twice", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('dr','x','d','owner',?,1)").run(now)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('D1','فروشگاه',  'active',?,1)").run(now)).lastInsertRowid);
    const order = async (no: string, status: string) => Number((await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,payment_status,due_date,salesperson_user_id,created_by,created_at,updated_at,organization_id) VALUES (?,?,'2026-03-01','DELIVERED',?, '2026-03-13',?,?,?,?,1)").run(no, cust, status, user, user, now, now)).lastInsertRowid);
    await order("DR-1", "unpaid");
    await order("DR-2", "paid");
    await setDueReminderDays(1, [-3]);
    expect(await queueDueReminders(1, "2026-03-10")).toBe(1);
    expect(await queueDueReminders(1, "2026-03-10")).toBe(0);
    expect(await queueDueReminders(1, "2026-03-11")).toBe(0);
  });
});
