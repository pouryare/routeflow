import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-batches-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const {
  createBatch,
  advanceBatchStatus,
  sweepBatchStatuses,
  expiringBatches,
  batchTrace,
  BatchError,
} = await import("@/lib/repo/batches");
const { recordMovement } = await import("@/lib/repo/stock");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let fac = 0;
let prod = 0;
let pack = 0;
let userId = 0;

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "DELETE FROM reminders; DELETE FROM delivery_line_batches; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM orders; DELETE FROM products; DELETE FROM facilities; DELETE FROM customers; DELETE FROM users WHERE id > 0;"
  );
  const now = new Date().toISOString();
  userId = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'group_manager',NULL,1,?,1)"
      )
      .run(`u${Date.now()}`, "x:y", "م", now)).lastInsertRowid
  );
  fac = Number(
    (await db
      .prepare(
        "INSERT INTO facilities (slug,kind,name,lat,lng,updated_at,organization_id,created_at) VALUES (?,?,?,35,51,?,1,?)"
      )
      .run(`w${Date.now()}`, "warehouse", "انبار", now, now)).lastInsertRowid
  );
  prod = Number(
    (await db
      .prepare(
        "INSERT INTO products (name,sku,shelf_life_days,created_at,updated_at,organization_id) VALUES ('کره',?,40,?,?,1)"
      )
      .run(`s${Date.now()}`, now, now)).lastInsertRowid
  );
  pack = Number(
    (await db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'b',1,?)").run(prod, now)).lastInsertRowid
  );
});

describe("createBatch", () => {
  it("auto-codes uniquely per product+date and defaults expiry from shelf life", async () => {
    const b1 = await createBatch(1, { product_id: prod, produced_at: "2026-01-10", qty_received_base: 10 });
    const b2 = await createBatch(1, { product_id: prod, produced_at: "2026-01-10", qty_received_base: 5 });
    const db = getDb();
    const rows = await db
      .prepare("SELECT id, batch_code, expiry_date FROM batches ORDER BY id")
      .all() as { id: number; batch_code: string; expiry_date: string }[];
    expect(rows[0].batch_code).toBe("260110-1");
    expect(rows[1].batch_code).toBe("260110-2");
    expect(rows[0].expiry_date).toBe("2026-02-19"); // 2026-01-10 + 40 days
    expect(b1).toBeLessThan(b2);
  });

  it("rejects a duplicate explicit code for the same product", async () => {
    await createBatch(1, { product_id: prod, batch_code: "LOT-A", qty_received_base: 1 });
    await expect((async () =>
      await createBatch(1, { product_id: prod, batch_code: "LOT-A", qty_received_base: 1 }))()).rejects.toThrow(BatchError);
  });
});

describe("sweepBatchStatuses", () => {
  it("sets expired past the date and depleted at zero stock, idempotently", async () => {
    const db = getDb();
    const expiredId = await createBatch(1, { product_id: prod, expiry_date: "2020-01-01", qty_received_base: 3 });
    await recordMovement(1, { facility_id: fac, product_id: prod, batch_id: expiredId, base_qty: 3, kind: "PURCHASE_IN", occurred_at: "2020-01-01" });
    const depletedId = await createBatch(1, { product_id: prod, expiry_date: "2099-01-01", qty_received_base: 2 });
    await recordMovement(1, { facility_id: fac, product_id: prod, batch_id: depletedId, base_qty: 2, kind: "PURCHASE_IN", occurred_at: "2026-01-01" });
    await recordMovement(1, { facility_id: fac, product_id: prod, batch_id: depletedId, base_qty: -2, kind: "DELIVERY_OUT", occurred_at: "2026-01-02" });

    const first = await sweepBatchStatuses(1);
    expect(first.expired).toBe(1);
    expect(first.depleted).toBeGreaterThanOrEqual(1);
    expect((await db.prepare("SELECT status FROM batches WHERE id=?").get(expiredId) as { status: string }).status).toMatch(/expired|depleted/);
    expect((await db.prepare("SELECT status FROM batches WHERE id=?").get(depletedId) as { status: string }).status).toBe("depleted");

    const second = await sweepBatchStatuses(1);
    expect(second.expired + second.depleted).toBe(0);
  });
});

describe("advanceBatchStatus", () => {
  it("refuses the computed statuses and an illegal move", async () => {
    const id = await createBatch(1, { product_id: prod, qty_received_base: 5 });
    await expect((async () => await advanceBatchStatus(1, id, "expired"))()).rejects.toThrow(BatchError);
    await advanceBatchStatus(1, id, "quarantined");
    await (async () => await advanceBatchStatus(1, id, "recalled"))();
    await expect((async () => await advanceBatchStatus(1, id, "active"))()).rejects.toThrow(BatchError); // recalled -> active illegal
  });

  it("raises one reminder per customer on a recall", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const id = await createBatch(1, { product_id: prod, qty_received_base: 20 });
    await recordMovement(1, { facility_id: fac, product_id: prod, batch_id: id, base_qty: 20, kind: "PURCHASE_IN", occurred_at: "2026-01-01" });
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C1','x','active','2026-01-01',1)").run()).lastInsertRowid);
    const ord = Number((await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,created_by,created_at,updated_at,organization_id) VALUES ('o1',?,?,'DELIVERED',?,?,?,1)").run(cust, "2026-01-01", userId, now, now)).lastInsertRowid);
    const run = Number((await db.prepare("INSERT INTO delivery_runs (driver_user_id,run_date,created_by,created_at,updated_at,organization_id) VALUES (?,?,?,?,?,1)").run(userId, "2026-01-01", userId, now, now)).lastInsertRowid);
    const stop = Number((await db.prepare("INSERT INTO delivery_stops (run_id,order_id,sort_order,created_at) VALUES (?,?,0,?)").run(run, ord, now)).lastInsertRowid);
    const ol = Number((await db.prepare("INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at) VALUES (?,?,?,1,1000,0,1,1,0,?)").run(ord, prod, pack, now)).lastInsertRowid);
    await db.prepare("INSERT INTO delivery_line_batches (organization_id,delivery_stop_id,order_line_id,batch_id,base_qty,created_at) VALUES (1,?,?,?,5,?)").run(stop, ol, id, now);

    await advanceBatchStatus(1, id, "recalled");
    expect(await db.prepare("SELECT COUNT(*) n FROM reminders WHERE entity_type='customer' AND entity_id=?").get(cust)).toEqual({ n: 1 });
  });
});

describe("expiringBatches", () => {
  it("lists stocked batches inside the alert window", async () => {
    const soon = await createBatch(1, { product_id: prod, expiry_date: "2026-03-05", qty_received_base: 4 });
    await recordMovement(1, { facility_id: fac, product_id: prod, batch_id: soon, base_qty: 4, kind: "PURCHASE_IN", occurred_at: "2026-01-01" });
    const far = await createBatch(1, { product_id: prod, expiry_date: "2027-01-01", qty_received_base: 4 });
    await recordMovement(1, { facility_id: fac, product_id: prod, batch_id: far, base_qty: 4, kind: "PURCHASE_IN", occurred_at: "2026-01-01" });
    const list = await expiringBatches(1, { asOf: "2026-03-01T00:00:00Z" }); // window = max(7, 10) = 10 days
    expect(list.map((b) => b.id)).toEqual([soon]);
    expect(list[0].days_to_expiry).toBe(4);
  });
});

describe("batchTrace", () => {
  it("returns the delivering customers for a batch", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const id = await createBatch(1, { product_id: prod, qty_received_base: 20 });
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C9','رستوران','active','2026-01-01',1)").run()).lastInsertRowid);
    const ord = Number((await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,delivered_at,created_by,created_at,updated_at,organization_id) VALUES ('o9',?,?,'DELIVERED',?,?,?,?,1)").run(cust, "2026-01-01", "2026-01-02", userId, now, now)).lastInsertRowid);
    const run = Number((await db.prepare("INSERT INTO delivery_runs (driver_user_id,run_date,created_by,created_at,updated_at,organization_id) VALUES (?,?,?,?,?,1)").run(userId, "2026-01-02", userId, now, now)).lastInsertRowid);
    const stop = Number((await db.prepare("INSERT INTO delivery_stops (run_id,order_id,sort_order,created_at) VALUES (?,?,0,?)").run(run, ord, now)).lastInsertRowid);
    const ol = Number((await db.prepare("INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at) VALUES (?,?,?,1,1000,0,1,1,0,?)").run(ord, prod, pack, now)).lastInsertRowid);
    await db.prepare("INSERT INTO delivery_line_batches (organization_id,delivery_stop_id,order_line_id,batch_id,base_qty,created_at) VALUES (1,?,?,?,7,?)").run(stop, ol, id, now);

    const trace = (await batchTrace(1, id))!;
    expect(trace.deliveries).toHaveLength(1);
    expect(trace.deliveries[0]).toMatchObject({ customer_id: cust, customer_name: "رستوران", base_qty: 7 });
  });
});
