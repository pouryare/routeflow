import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-xfer-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { requestTransfer, decideTransfer, listTransfers } = await import("@/lib/repo/orderTransfers");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

let owner = 0, ga = 0, gb = 0, cust = 0, order = 0;
const session = (groupId: number | null, role = "owner") => ({ organizationId: 1, role, roles: [role], groupId, user: { id: owner }, hasRole: (r: string) => r === role }) as never;

beforeAll(async () => {
  const db = getDb();
  owner = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('x-own','x:y','م','owner',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
  ga = Number((await db.prepare("INSERT INTO groups (name, slug, organization_id, created_at) VALUES ('الف','alef',1,'2026-01-01')").run()).lastInsertRowid);
  gb = Number((await db.prepare("INSERT INTO groups (name, slug, organization_id, created_at) VALUES ('ب','be',1,'2026-01-01')").run()).lastInsertRowid);
  cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id,group_id) VALUES ('X1','x','RESTAURANT','active','2026-01-01',1,?)").run(ga)).lastInsertRowid);
  await ensureWarehouse(db);
  const product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  const packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 100 });
  await setPrice(db, { product_id: product, packaging_id: packaging, price_toman: 1000, valid_from: "2026-01-01", organization_id: 1 } as never);
  order = ((await createOrder(db, { customer_id: cust, order_date: "2026-11-13", created_by: owner, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }] } as never)) as unknown as { id: number }).id;
  await db.prepare("UPDATE orders SET status = 'CONFIRMED', group_id = ? WHERE id = ?").run(ga, order);
});

describe("order transfers between groups", () => {
  it("asks, refuses a second open ask, and moves the order only when the other group accepts", async () => {
    expect(await requestTransfer(session(null), order, ga)).toMatch(/همین/);
    expect(await requestTransfer(session(null), order, gb)).toBeNull();
    expect(await requestTransfer(session(null), order, gb)).toMatch(/باز/);
    const [t] = await listTransfers(session(null));
    expect(t.status).toBe("pending");
    expect(((await getDb().prepare("SELECT group_id FROM orders WHERE id = ?").get(order)) as { group_id: number }).group_id).toBe(ga);
    expect(await decideTransfer(session(null), t.id, true)).toBeNull();
    expect(((await getDb().prepare("SELECT group_id FROM orders WHERE id = ?").get(order)) as { group_id: number }).group_id).toBe(gb);
    expect(await decideTransfer(session(null), t.id, false)).toMatch(/قبلاً/);
  });
  it("a group manager cannot answer a request meant for another group, and only confirmed orders move", async () => {
    await getDb().prepare("UPDATE orders SET status = 'PLANNED' WHERE id = ?").run(order);
    expect(await requestTransfer(session(null), order, ga)).toMatch(/تأییدشده/);
    await getDb().prepare("UPDATE orders SET status = 'CONFIRMED' WHERE id = ?").run(order);
    expect(await requestTransfer(session(gb, "group_manager"), order, ga)).toBeNull();
    const [t] = await listTransfers(session(null));
    expect(await decideTransfer(session(gb, "group_manager"), t.id, true)).toMatch(/پیدا نشد/);
    expect(await decideTransfer(session(ga, "group_manager"), t.id, false)).toBeNull();
  });
});
