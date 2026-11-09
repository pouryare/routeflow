import { describe, it, expect, beforeAll } from "vitest";
import os from "node:os";
import path from "node:path";
import type { Session } from "@/lib/session";

/** Saved daily totals stay right when the past is edited (db/migrations/1762700100000_sales-daily.sql). */

process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-sales-daily-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { salesDashboard } = await import("@/lib/dashboard");
const { recordPayment } = await import("@/lib/repo/payments");

let userId = 0;
let custId = 0;
let productId = 0;
let packId = 0;

const owner = (): Session =>
  ({ user: { id: userId } as never, role: "owner", groupId: null, organizationId: 1, roles: ["owner"], hasRole: (x: string) => x === "owner" }) as unknown as Session;

async function order(day: string, price: number, packs = 1): Promise<{ orderId: number; lineId: number }> {
  const db = getDb();
  const now = new Date().toISOString();
  const orderId = Number((await db.prepare(
    `INSERT INTO orders (order_no,customer_id,order_date,status,delivered_at,salesperson_user_id,created_by,created_at,updated_at,organization_id)
     VALUES (?,?,?,'DELIVERED',?,?,?,?,?,1)`
  ).run(`sd-${Math.random().toString(36).slice(2)}`, custId, day, day, userId, userId, now, now)).lastInsertRowid);
  const lineId = Number((await db.prepare(
    `INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at)
     VALUES (?,?,?,?,?,?,0,1,1,0,?)`
  ).run(orderId, productId, packId, packs, packs, price, now)).lastInsertRowid);
  return { orderId, lineId };
}

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const tag = Date.now();
  userId = Number((await db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,'owner',1,?,1)"
  ).run(`sd${tag}`, "x:y", "فروشنده", now)).lastInsertRowid);
  custId = Number((await db.prepare(
    "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES (?,?,'RESTAURANT','active','2026-01-01',1)"
  ).run(`SD${tag}`, "رستوران")).lastInsertRowid);
  productId = Number((await db.prepare("INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES (?,?,?,?,1)").run(`p${tag}`, `s${tag}`, now, now)).lastInsertRowid);
  packId = Number((await db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,?,1,?)").run(productId, "box", now)).lastInsertRowid);
});

describe("saved daily totals", () => {
  it("count a new order, then an edit to an old order's line, a payment and a delete", async () => {
    const range = { from: "2025-01-01", to: "2025-12-31" };
    const before = (await salesDashboard(getDb(), owner(), range)).revenue_toman;
    const { orderId, lineId } = await order("2025-03-10", 1_000, 2);
    expect((await salesDashboard(getDb(), owner(), range)).revenue_toman).toBe(before + 2_000);

    // Months later, the March line is corrected: March is recounted on the next read.
    await getDb().prepare("UPDATE order_lines SET unit_price_toman = 1500 WHERE id = ?").run(lineId);
    await getDb().prepare("UPDATE orders SET total_toman = NULL WHERE id = ?").run(orderId);
    expect((await salesDashboard(getDb(), owner(), range)).revenue_toman).toBe(before + 3_000);

    // A payment changes what was earned in cash on that day's orders.
    const realizedBefore = (await salesDashboard(getDb(), owner(), range)).profit.realized_toman;
    await recordPayment(1, { customer_id: custId, amount_toman: 3_000, method: "CASH", received_at: "2026-11-01", received_by: userId });
    expect((await salesDashboard(getDb(), owner(), range)).profit.realized_toman).toBeGreaterThan(realizedBefore);

    // Moving the order to another day moves its money with it.
    await getDb().prepare("UPDATE orders SET order_date = '2024-06-01' WHERE id = ?").run(orderId);
    expect((await salesDashboard(getDb(), owner(), range)).revenue_toman).toBe(before);
    expect((await salesDashboard(getDb(), owner(), { from: "2024-06-01", to: "2024-06-01" })).revenue_toman).toBe(3_000);
  });

  it("limit the figures to the range, and an open range is all time", async () => {
    await order("2023-02-01", 700);
    const y2023 = await salesDashboard(getDb(), owner(), { from: "2023-01-01", to: "2023-12-31" });
    const all = await salesDashboard(getDb(), owner());
    expect(y2023.revenue_toman).toBe(700);
    expect(all.revenue_toman).toBeGreaterThan(y2023.revenue_toman);
    expect(y2023.revenue_by_product.reduce((a, p) => a + p.value, 0)).toBe(700);
  });

  it("leave no marks behind after a read", async () => {
    await salesDashboard(getDb(), owner());
    expect((await getDb().prepare("SELECT COUNT(*) AS n FROM sales_daily_marks WHERE organization_id = 1").get())!.n).toBe(0);
  });
});
