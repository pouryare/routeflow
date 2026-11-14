import { describe, it, expect } from "vitest";

process.env.ROUTEFLOW_DB_PATH = `/tmp/rf-hex-map-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
process.env.SESSION_SECRET = "test-secret";

describe("hexCells", () => {
  it("counts leads and customers apart, and sums delivered sales only inside the window and the manager's group", async () => {
    const { getDb } = await import("@/lib/db");
    const { hexCells } = await import("@/lib/repo/hexMap");
    const db = getDb();
    const now = new Date().toISOString();
    const g1 = Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('h1','hx-g1',?,1)").run(now)).lastInsertRowid);
    const g2 = Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('h2','hx-g2',?,1)").run(now)).lastInsertRowid);
    const cust = async (code: string, life: string, group: number, lat: number, lng: number) =>
      Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,lat,lng,group_id,organization_id) VALUES (?,?,?,?,?,?,?,1)").run(code, code, life, now, lat, lng, group)).lastInsertRowid);
    const a = await cust("HX1", "active", g1, 35.7, 51.4);
    await cust("HX2", "lead", g1, 35.7001, 51.4001);
    const other = await cust("HX3", "active", g2, 35.7002, 51.4002);
    const owner = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('hx-o','x','o','owner',?,1)").run(now)).lastInsertRowid);
    const prod = Number((await db.prepare("INSERT INTO products (name, kg_per_base_unit, organization_id, created_at, updated_at) VALUES ('p', 1, 1, ?, ?)").run(now, now)).lastInsertRowid);
    const pack = Number((await db.prepare("INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, 'b', 1, ?)").run(prod, now)).lastInsertRowid);
    let n = 0;
    const order = async (customer: number, date: string, status: string, delivered: number | null) => {
      const o = Number((await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,created_by,created_at,updated_at,organization_id) VALUES (?,?,?,?,?,?,?,1)").run(`HX-${++n}`, customer, date, status, owner, now, now)).lastInsertRowid);
      await db.prepare("INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, packs_delivered, unit_price_toman, qty_per_pack, kg_per_base_unit, created_at) VALUES (?,?,?,?,?,100,1,1,?)").run(o, prod, pack, 10, delivered, now);
    };
    const recent = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    await order(a, recent, "DELIVERED", 8);          // 800
    await order(a, "2020-01-01", "DELIVERED", 10);   // outside the window
    await order(a, recent, "CONFIRMED", null);       // not delivered
    await order(other, recent, "DELIVERED", 10);     // another group

    const session = { user: { id: owner, display_name: "o" }, organizationId: 1, role: "owner" } as never;
    expect((await hexCells(session, "revenue", 8, 90))[0]).toMatchObject({ value: 1800, count: 2 }); // owner sees both groups
    expect((await hexCells(session, "customers", 8, 90))[0].count).toBe(2);
    expect((await hexCells(session, "leads", 8, 90))[0].count).toBe(1);
  });
});
