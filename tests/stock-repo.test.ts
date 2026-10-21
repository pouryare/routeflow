import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-stock-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { recordMovement, onHand, allocateFEFO, defaultFacilityId, batchStock, stockLevels, onHandByProduct } =
  await import("@/lib/repo/stock");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let fac = 0;
let prod = 0;
let b1 = 0;
let b2 = 0;

function batch(code: string, expiry: string | null, qtyIn: number): number {
  const db = getDb();
  const now = new Date().toISOString();
  const id = Number(
    db
      .prepare(
        `INSERT INTO batches (organization_id, product_id, batch_code, expiry_date, qty_received_base, unit_cost_toman, status, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, 0, 'active', ?, ?)`
      )
      .run(prod, code, expiry, qtyIn, now, now).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO stock_movements (organization_id, facility_id, product_id, batch_id, base_qty, kind, occurred_at, created_at)
     VALUES (1, ?, ?, ?, ?, 'PURCHASE_IN', ?, ?)`
  ).run(fac, prod, id, qtyIn, now, now);
  return id;
}

beforeEach(() => {
  const db = getDb();
  db.exec(
    "DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM products; DELETE FROM facilities;"
  );
  const now = new Date().toISOString();
  fac = Number(
    db
      .prepare(
        "INSERT INTO facilities (slug, kind, name, lat, lng, updated_at, organization_id, created_at) VALUES (?,?,?,35,51,?,1,?)"
      )
      .run(`w${Date.now()}`, "warehouse", "انبار", now, now).lastInsertRowid
  );
  prod = Number(
    db
      .prepare(
        "INSERT INTO products (name, sku, created_at, updated_at, organization_id) VALUES ('کره', ?, ?, ?, 1)"
      )
      .run(`s${Date.now()}`, now, now).lastInsertRowid
  );
  b1 = batch("B1", "2026-03-01", 10);
  b2 = batch("B2", "2026-02-01", 5);
});

describe("allocateFEFO", () => {
  it("draws the earliest-expiry batch first", () => {
    expect(allocateFEFO(1, prod, 7, fac)).toEqual([
      { batch_id: b2, base_qty: 5 },
      { batch_id: b1, base_qty: 2 },
    ]);
  });

  it("puts an oversell shortfall on batch_id null", () => {
    expect(allocateFEFO(1, prod, 20, fac)).toEqual([
      { batch_id: b2, base_qty: 5 },
      { batch_id: b1, base_qty: 10 },
      { batch_id: null, base_qty: 5 },
    ]);
  });

  it("skips a quarantined batch", () => {
    getDb().prepare("UPDATE batches SET status='quarantined' WHERE id=?").run(b2);
    expect(allocateFEFO(1, prod, 3, fac)).toEqual([{ batch_id: b1, base_qty: 3 }]);
  });

  it("returns nothing for a non-positive quantity", () => {
    expect(allocateFEFO(1, prod, 0, fac)).toEqual([]);
  });
});

describe("onHand", () => {
  it("nets signed movements, including negative", () => {
    recordMovement(1, {
      facility_id: fac,
      product_id: prod,
      batch_id: b1,
      base_qty: -4,
      kind: "DELIVERY_OUT",
      occurred_at: "2026-02-05",
    });
    expect(onHand(1, { product_id: prod })).toBe(11); // 10 + 5 - 4
    expect(onHand(1, { batch_id: b1 })).toBe(6);
    recordMovement(1, {
      facility_id: fac,
      product_id: prod,
      batch_id: null,
      base_qty: -20,
      kind: "ADJUSTMENT",
      occurred_at: "2026-02-06",
    });
    expect(onHand(1, { product_id: prod })).toBe(-9);
    expect(onHand(1, { batch_id: null })).toBe(-20);
  });
});

describe("defaultFacilityId", () => {
  it("prefers a warehouse, then home, then lowest id", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO facilities (slug, kind, name, lat, lng, updated_at, organization_id, created_at) VALUES (?,?,?,35,51,?,1,?)"
    ).run(`h${Date.now()}`, "home", "خانه", now, now);
    expect(defaultFacilityId(1)).toBe(fac); // the warehouse, not the home
  });
});

describe("stockLevels", () => {
  it("reports on-hand and earliest expiry among stocked batches", () => {
    const levels = stockLevels(1);
    const row = levels.find((l) => l.product_id === prod)!;
    expect(row.on_hand).toBe(15);
    expect(row.earliest_expiry).toBe("2026-02-01");
  });
});

describe("batchStock", () => {
  it("is FEFO-ordered with computed on-hand", () => {
    const rows = batchStock(1, prod, fac);
    expect(rows.map((r) => r.batch_id)).toEqual([b2, b1]);
    expect(rows[0].on_hand).toBe(5);
  });
});

describe("onHandByProduct", () => {
  it("sums one facility only, so a van's stock is not mistaken for the shelf", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const van = Number(
      db
        .prepare("INSERT INTO facilities (slug, kind, name, lat, lng, updated_at, organization_id, created_at) VALUES (?,?,?,35,51,?,1,?)")
        .run(`v${Date.now()}`, "van", "وانت", now, now).lastInsertRowid
    );
    // beforeEach put 10 + 5 into the warehouse; now move 4 to a van and write 1 off on the shelf.
    recordMovement(1, { facility_id: fac, product_id: prod, batch_id: null, base_qty: -4, kind: "TRANSFER_OUT", occurred_at: now });
    recordMovement(1, { facility_id: van, product_id: prod, batch_id: null, base_qty: 4, kind: "TRANSFER_IN", occurred_at: now });
    recordMovement(1, { facility_id: fac, product_id: prod, batch_id: null, base_qty: -1, kind: "WRITE_OFF", occurred_at: now });
    expect(onHandByProduct(1, fac).get(prod)).toBe(10);
    expect(onHandByProduct(1, van).get(prod)).toBe(4);
    expect(onHand(1, { product_id: prod })).toBe(14);
  });
  it("leaves out products with no movement at that facility", () => {
    expect(onHandByProduct(1, fac + 999).size).toBe(0);
  });
});
