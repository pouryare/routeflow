import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-driver-stop-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("../helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop } = await import("@/lib/delivery");
const { POST } = await import("@/app/api/driver/stops/[id]/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { tehranTodayIso } = await import("@/lib/jalali");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let driver = 0, owner = 0, stopId = 0, lineId = 0;

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)");
  owner = Number((await u.run("o", "x", "م", "owner", now)).lastInsertRowid);
  driver = Number((await u.run("d", "x", "ر", "delivery_driver", now)).lastInsertRowid);
  const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C','x','active',?,1)").run(now)).lastInsertRowid);
  const product = await createProduct(db, { name: "کره", kg_per_base_unit: 1, organization_id: 1 });
  const packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 1 });
  await setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2020-01-01" });
  const today = tehranTodayIso();
  const order = await createOrder(db, { customer_id: cust, order_date: today, created_by: owner, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 4 }] });
  await confirmOrder(db, order.id);
  const run = await createRun(db, { driver_user_id: driver, run_date: today, created_by: owner, organization_id: 1 });
  stopId = await addStop(db, run, order.id, 0);
  lineId = (await db.prepare("SELECT id FROM order_lines WHERE order_id = ?").get(order.id) as { id: number }).id;
});

const cookie = (uid: number, role: string) =>
  `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "ر" })}`;
const post = (body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/driver/stops/${stopId}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", cookie: cookie(driver, "delivery_driver") },
    }),
    { params: Promise.resolve({ id: String(stopId) }) },
  );

describe("/api/driver/stops/[id]", () => {
  it("refuses cash far beyond the invoice and the customer's debt", async () => {
    expect((await post({ lines: [{ line_id: lineId, packs_delivered: 4 }], collected_toman: 1e12 })).status).toBe(400);
  });
  it("records the delivery once", async () => {
    expect((await post({ lines: [{ line_id: lineId, packs_delivered: 4 }], collected_toman: 4000 })).status).toBe(200);
  });
  it("answers an identical resend as a harmless duplicate", async () => {
    const res = await post({ lines: [{ line_id: lineId, packs_delivered: 4 }], collected_toman: 4000 });
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
  });
  it("refuses a different resubmission on a finished stop", async () => {
    expect((await post({ lines: [{ line_id: lineId, packs_delivered: 3 }], collected_toman: 4000 })).status).toBe(409);
    expect((await post({ lines: [{ line_id: lineId, packs_delivered: 4 }], collected_toman: 9000 })).status).toBe(409);
  });
});
