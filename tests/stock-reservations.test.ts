import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-stock-res-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const {
  reserveForOrder,
  releaseForOrder,
  consumeForOrder,
  availableToPromise,
  reservedQty,
  allocateFEFO,
  stockLevels,
} = await import("@/lib/repo/stock");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let fac = 0;
let prod = 0;
let pkg = 0;
let user = 0;
let cust = 0;
let b2 = 0;

async function batch(code: string, expiry: string, qtyIn: number): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  const id = Number(
    (await db
      .prepare(
        `INSERT INTO batches (organization_id, product_id, batch_code, expiry_date, qty_received_base, unit_cost_toman, status, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, 0, 'active', ?, ?)`
      )
      .run(prod, code, expiry, qtyIn, now, now)).lastInsertRowid
  );
  await db.prepare(
    `INSERT INTO stock_movements (organization_id, facility_id, product_id, batch_id, base_qty, kind, occurred_at, created_at)
     VALUES (1, ?, ?, ?, ?, 'PURCHASE_IN', ?, ?)`
  ).run(fac, prod, id, qtyIn, now, now);
  return id;
}

async function order(lines: { product_id: number; packs: number; qpp: number }[]): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  const oid = Number(
    (await db
      .prepare(
        `INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at, organization_id)
         VALUES ('o-' || abs(random()), ?, 'CONFIRMED', '2026-01-01', ?, ?, ?, 1)`
      )
      .run(cust, user, now, now)).lastInsertRowid
  );
  for (const l of lines) {
    await db.prepare(
      `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit, created_at)
       VALUES (?, ?, ?, ?, 100, 60, ?, 0.25, ?)`
    ).run(oid, l.product_id, pkg, l.packs, l.qpp, now);
  }
  return oid;
}

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "DELETE FROM stock_reservations; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM packagings; DELETE FROM products; DELETE FROM facilities; DELETE FROM customers; DELETE FROM users;"
  );
  const now = new Date().toISOString();
  fac = Number(
    (await db
      .prepare(
        "INSERT INTO facilities (slug, kind, name, lat, lng, updated_at, organization_id, created_at) VALUES (?,?,?,35,51,?,1,?)"
      )
      .run(`w${Date.now()}`, "warehouse", "انبار", now, now)).lastInsertRowid
  );
  user = Number(
    (await db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, created_at, organization_id) VALUES ('o','x','م','owner',?,1)"
      )
      .run(now)).lastInsertRowid
  );
  cust = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('C1','ر',?,1)"
      )
      .run(now)).lastInsertRowid
  );
  prod = Number(
    (await db
      .prepare("INSERT INTO products (name, sku, created_at, updated_at, organization_id) VALUES ('کره','S1',?,?,1)")
      .run(now, now)).lastInsertRowid
  );
  pkg = Number(
    (await db
      .prepare("INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?,?,?,?)")
      .run(prod, "کارتن", 100, now)).lastInsertRowid
  );
  await batch("B1", "2026-02-01", 100); // earliest expiry -- FEFO takes this first
  b2 = await batch("B2", "2026-03-01", 100);
});

describe("stock reservations", () => {
  it("claims stock without moving it, dropping availableToPromise", async () => {
    const oid = await order([{ product_id: prod, packs: 1, qpp: 150 }]); // 150 base
    const n = await reserveForOrder(1, oid);
    expect(n).toBe(2); // 100 from B1, 50 from B2
    expect(await availableToPromise(1, { product_id: prod })).toBe(50); // 200 on-hand - 150 reserved
    // on-hand itself is untouched
    const level = (await stockLevels(1)).find((l) => l.product_id === prod)!;
    expect(level.on_hand).toBe(200);
    expect(level.reserved).toBe(150);
    expect(level.available).toBe(50);
  });

  it("is idempotent", async () => {
    const oid = await order([{ product_id: prod, packs: 1, qpp: 100 }]);
    expect(await reserveForOrder(1, oid)).toBe(1);
    expect(await reserveForOrder(1, oid)).toBe(0);
    expect(await reservedQty(1, { product_id: prod })).toBe(100);
  });

  it("keeps a second order off the units the first reserved", async () => {
    const o1 = await order([{ product_id: prod, packs: 1, qpp: 100 }]); // all of B1
    await reserveForOrder(1, o1);
    const o2 = await order([{ product_id: prod, packs: 1, qpp: 100 }]);
    await reserveForOrder(1, o2);
    // o2's reservation should come from B2, not double-book B1
    const rows = await getDb()
      .prepare(
        "SELECT batch_id, base_qty FROM stock_reservations WHERE order_id = ? AND released_at IS NULL"
      )
      .all(o2) as { batch_id: number; base_qty: number }[];
    expect(rows).toEqual([{ batch_id: b2, base_qty: 100 }]);
  });

  it("releases a claim, restoring availableToPromise", async () => {
    const oid = await order([{ product_id: prod, packs: 1, qpp: 120 }]);
    await reserveForOrder(1, oid);
    expect(await availableToPromise(1, { product_id: prod })).toBe(80);
    await releaseForOrder(1, oid);
    expect(await availableToPromise(1, { product_id: prod })).toBe(200);
  });

  it("consume is a release -- the movement becomes the record", async () => {
    const oid = await order([{ product_id: prod, packs: 1, qpp: 50 }]);
    await reserveForOrder(1, oid);
    await consumeForOrder(1, oid);
    expect(await reservedQty(1, { product_id: prod })).toBe(0);
  });

  it("records a shortfall reservation as batch_id NULL", async () => {
    const oid = await order([{ product_id: prod, packs: 1, qpp: 260 }]); // 200 on hand
    await reserveForOrder(1, oid);
    const nullRow = await getDb()
      .prepare(
        "SELECT base_qty FROM stock_reservations WHERE order_id = ? AND batch_id IS NULL"
      )
      .get(oid) as { base_qty: number } | undefined;
    expect(nullRow?.base_qty).toBeCloseTo(60);
    expect(await availableToPromise(1, { product_id: prod })).toBeCloseTo(-60);
  });

  it("allocateFEFO with excludeReserved skips already-claimed units", async () => {
    const o1 = await order([{ product_id: prod, packs: 1, qpp: 100 }]);
    await reserveForOrder(1, o1);
    const slices = await allocateFEFO(1, prod, 100, fac, { excludeReserved: true });
    expect(slices).toEqual([{ batch_id: b2, base_qty: 100 }]);
  });
});
