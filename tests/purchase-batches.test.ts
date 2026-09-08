import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-purchase-batches-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct } = await import("@/lib/catalogue");
const { recordPurchase, stockPosition } = await import("@/lib/purchases");
const { onHand } = await import("@/lib/repo/stock");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let pA = 0;
let pB = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM purchase_lines; DELETE FROM purchases; DELETE FROM products; DELETE FROM users WHERE id > 0;"
  );
  const now = new Date().toISOString();
  owner = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'owner',NULL,1,?,1)"
      )
      .run(`o${Date.now()}`, "x:y", "م", now).lastInsertRowid
  );
  pA = createProduct(db, { name: "کره A", kg_per_base_unit: 0.25, organization_id: 1 });
  pB = createProduct(db, { name: "کره B", kg_per_base_unit: 0.25, organization_id: 1 });
});

describe("recordPurchase creates batches", () => {
  it("makes one batch and one PURCHASE_IN movement per line", () => {
    const db = getDb();
    recordPurchase(db, {
      purchase_date: "2026-02-01",
      created_by: owner,
      organization_id: 1,
      lines: [
        { product_id: pA, base_qty: 100, unit_cost_toman: 1000, batch_code: "LOT-A1", expiry_date: "2026-05-01" },
        { product_id: pB, base_qty: 50, unit_cost_toman: 2000 },
      ],
    });

    const batches = db.prepare("SELECT product_id, batch_code, expiry_date FROM batches ORDER BY id").all() as {
      product_id: number;
      batch_code: string;
      expiry_date: string | null;
    }[];
    expect(batches).toHaveLength(2);
    expect(batches[0]).toMatchObject({ product_id: pA, batch_code: "LOT-A1", expiry_date: "2026-05-01" });
    expect(batches[1].batch_code).toMatch(/^260201-\d+$/); // auto code for line B

    const moves = db
      .prepare("SELECT product_id, base_qty, kind FROM stock_movements ORDER BY id")
      .all() as { product_id: number; base_qty: number; kind: string }[];
    expect(moves).toEqual([
      { product_id: pA, base_qty: 100, kind: "PURCHASE_IN" },
      { product_id: pB, base_qty: 50, kind: "PURCHASE_IN" },
    ]);

    expect(onHand(1, { product_id: pA })).toBe(100);
    expect(onHand(1, { product_id: pB })).toBe(50);
  });

  it("leaves the moving-average cost roll unchanged", () => {
    const db = getDb();
    recordPurchase(db, {
      purchase_date: "2026-02-01",
      created_by: owner,
      organization_id: 1,
      lines: [{ product_id: pA, base_qty: 900, unit_cost_toman: 1000 }],
    });
    recordPurchase(db, {
      purchase_date: "2026-02-02",
      created_by: owner,
      organization_id: 1,
      lines: [{ product_id: pA, base_qty: 100, unit_cost_toman: 2000 }],
    });
    const cost = (db.prepare("SELECT avg_cost_toman FROM products WHERE id=?").get(pA) as {
      avg_cost_toman: number;
    }).avg_cost_toman;
    expect(cost).toBe(1100); // (900*1000 + 100*2000) / 1000
    const pos = stockPosition(db).find((r) => r.product_id === pA)!;
    expect(pos.on_hand).toBe(1000);
  });
});
