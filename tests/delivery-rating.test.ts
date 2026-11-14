import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-rating-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { rateDelivery, ratingOf } = await import("@/lib/repo/deliveryRatings");
const { ratingProblem, isLowRating } = await import("@/lib/deliveryRating");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("rating rules", () => {
  it("takes 1 to 5 and calls 1 or 2 low", () => {
    expect(ratingProblem({ stars: 0, reason: null })).toMatch(/۵/);
    expect(ratingProblem({ stars: 3.5, reason: null })).not.toBeNull();
    expect(ratingProblem({ stars: 4, reason: "x".repeat(101) })).not.toBeNull();
    expect(ratingProblem({ stars: 4, reason: null })).toBeNull();
    expect([1, 2, 3].map(isLowRating)).toEqual([true, true, false]);
  });
});

const db = getDb();
const now = new Date().toISOString();
const rep = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('rt-rep','x:y','م','phone_sales',1,?,1)").run(now)).lastInsertRowid);
const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id,owner_user_id) VALUES ('R1','x','RESTAURANT','active','2026-01-01',1,?)").run(rep)).lastInsertRowid);
const order = async (status: string, no: string) =>
  Number((await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,created_by,created_at,updated_at,organization_id) VALUES (?,?,'2026-11-01',?,?,?,?,1)").run(no, cust, status, rep, now, now)).lastInsertRowid);

describe("rating a delivery", () => {
  it("refuses an order not delivered yet, makes one task for a low rating, and a second low one changes nothing", async () => {
    expect(await rateDelivery(1, await order("CONFIRMED", "R-1"), rep, { stars: 5 })).toMatch(/تحویل/);
    const o = await order("DELIVERED", "R-2");
    expect(await rateDelivery(1, o, rep, { stars: 2, reason: "دیر رسید" })).toBeNull();
    expect(await rateDelivery(1, o, rep, { stars: 1, reason: "دیر رسید" })).toBeNull();
    expect(await ratingOf(1, o)).toMatchObject({ stars: 1, reason: "دیر رسید" });
    const tasks = (await db.prepare("SELECT assignee_user_id, entity_id FROM tasks WHERE title LIKE '%R-2%'").all()) as { assignee_user_id: number; entity_id: number }[];
    expect(tasks).toHaveLength(1);
    expect(Number(tasks[0].assignee_user_id)).toBe(rep);
    const good = await order("DELIVERED", "R-3");
    expect(await rateDelivery(1, good, rep, { stars: 5 })).toBeNull();
    expect((await db.prepare("SELECT 1 FROM tasks WHERE title LIKE '%R-3%'").all()).length).toBe(0);
  });
});
