import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-daylim-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { dayTaken } = await import("@/lib/repo/dayCapacity");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

let user = 0, cust = 0, product = 0, packaging = 0;
const place = (extra: Record<string, unknown>) =>
  createOrder(getDb(), { customer_id: cust, order_date: "2026-11-13", requested_day: "2026-11-20", created_by: user, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }], ...extra } as never);

beforeAll(async () => {
  const db = getDb();
  user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('dl-u','x:y','م','owner',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
  cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('D1','x','RESTAURANT','active','2026-01-01',1)").run()).lastInsertRowid);
  await ensureWarehouse(db);
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  await setPrice(db, { product_id: product, packaging_id: packaging, price_toman: 1000, valid_from: "2026-01-01", organization_id: 1 } as never);
});

describe("orders per delivery day", () => {
  it("takes orders up to the limit, then refuses a seller, lets a manager past it, and does not count other days", async () => {
    await place({ day_order_limit: 2 });
    expect(await dayTaken(1, "2026-11-20")).toBe(1);
    await place({ day_order_limit: 2 });
    await expect(place({ day_order_limit: 2 })).rejects.toThrow(/جا نیست/);
    await expect(place({ day_order_limit: 2, over_day_limit_ok: true })).resolves.toBeTruthy();
    await expect(place({ day_order_limit: 2, requested_day: "2026-11-21" })).resolves.toBeTruthy();
    await expect(place({ day_order_limit: 0 })).resolves.toBeTruthy(); // no limit: not checked
  });
});
