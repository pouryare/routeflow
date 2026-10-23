import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-stock-backfill-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, backfillStockLedger, rawSqlite } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { stockPosition } = await import("@/lib/purchases");
const { onHand } = await import("@/lib/repo/stock");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/** Seed legacy purchases + a delivered order with raw INSERTs (no recordPurchase /
 *  recordDelivery), then clear the movement/batch tables and the marker so the backfill
 *  has work to do. */
async function seedLegacy() {
  const db = getDb();
  /* The ledger is append-only by trigger and its AR leg REFERENCES customers(id), so
     `DELETE FROM customers` below raises FOREIGN KEY constraint failed once any test in
     this file has recorded a payment. Children before parents -- see
     tests/helpers/ledgerTeardown.ts, and note the scope warning in it: many suites do not
     set ROUTEFLOW_DB_PATH, so this must stay an explicit per-suite call and never a global
     setupFiles hook, which would run against the real data/routeflow.db. */
  await clearLedger(db);

  await db.exec(
    "DELETE FROM delivery_line_batches; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM purchase_lines; DELETE FROM purchases; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id > 0; DELETE FROM app_meta WHERE key = 'stock_ledger_backfill_done';"
  );
  const now = new Date().toISOString();
  const user = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,'owner',1,?,1)"
      )
      .run(`u${Date.now()}`, "x:y", "م", now)).lastInsertRowid
  );
  const prod = Number(
    (await db
      .prepare(
        "INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES ('کره',?,?,?,1)"
      )
      .run(`s${Date.now()}`, now, now)).lastInsertRowid
  );
  const pack = Number(
    (await db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'b',10,?)").run(prod, now)).lastInsertRowid
  );
  const cust = Number(
    (await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C1','x','active','2026-01-01',1)").run()).lastInsertRowid
  );

  const pu = Number(
    (await db.prepare("INSERT INTO purchases (purchase_date,created_by,created_at,organization_id) VALUES ('2026-01-01',?,?,1)").run(user, now)).lastInsertRowid
  );
  await db.prepare("INSERT INTO purchase_lines (purchase_id,product_id,base_qty,unit_cost_toman,created_at) VALUES (?,?,60,1000,?)").run(pu, prod, now);
  await db.prepare("INSERT INTO purchase_lines (purchase_id,product_id,base_qty,unit_cost_toman,created_at) VALUES (?,?,40,1000,?)").run(pu, prod, now);

  const ord = Number(
    (await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,delivered_at,created_by,created_at,updated_at,organization_id) VALUES ('o1',?,?,'DELIVERED',?,?,?,?,1)").run(cust, "2026-01-10", "2026-01-11", user, now, now)).lastInsertRowid
  );
  const run = Number(
    (await db.prepare("INSERT INTO delivery_runs (driver_user_id,run_date,created_by,created_at,updated_at,organization_id) VALUES (?,?,?,?,?,1)").run(user, "2026-01-11", user, now, now)).lastInsertRowid
  );
  const stop = Number(
    (await db.prepare("INSERT INTO delivery_stops (run_id,order_id,sort_order,created_at) VALUES (?,?,0,?)").run(run, ord, now)).lastInsertRowid
  );
  await db.prepare("INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at) VALUES (?,?,?,7,7,5000,0,10,1,0,?)").run(ord, prod, pack, now);

  return { prod, stop };
}

describe("backfillStockLedger", () => {
  it("makes SUM(movements) per product equal the legacy purchased - delivered, once", async () => {
    const db = getDb();
    const { prod } = await seedLegacy();

    backfillStockLedger(await rawSqlite());

    // 100 purchased - 70 delivered (7 packs * 10)
    expect(await onHand(1, { product_id: prod })).toBe(30);
    const batches = await db.prepare("SELECT batch_code FROM batches ORDER BY id").all() as { batch_code: string }[];
    expect(batches.map((b) => b.batch_code)).toEqual(["LEGACY-PL" + (await db.prepare("SELECT MIN(id) m FROM purchase_lines").get() as { m: number }).m, expect.any(String)]);
    expect(batches).toHaveLength(2);

    const outMoves = await db.prepare("SELECT COALESCE(SUM(base_qty),0) n FROM stock_movements WHERE kind='DELIVERY_OUT'").get() as { n: number };
    expect(outMoves.n).toBe(-70);

    const pos = (await stockPosition(db, 1)).find((r) => r.product_id === prod)!;
    expect(pos.on_hand).toBe(30);

    // idempotent
    backfillStockLedger(await rawSqlite());
    expect(await db.prepare("SELECT COUNT(*) n FROM batches").get()).toEqual({ n: 2 });
    expect(await onHand(1, { product_id: prod })).toBe(30);
  });

  it("writes delivery_line_batches rows for the delivered line", async () => {
    const db = getDb();
    const { stop } = await seedLegacy();
    backfillStockLedger(await rawSqlite());
    const dlb = await db
      .prepare("SELECT COALESCE(SUM(base_qty),0) n FROM delivery_line_batches WHERE delivery_stop_id = ?")
      .get(stop) as { n: number };
    expect(dlb.n).toBe(70);
  });
});
