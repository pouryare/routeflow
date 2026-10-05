import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-events-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());
const { emitEvent, recentEvents } = await import("@/lib/repo/events");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, recordDelivery } = await import("@/lib/delivery");
const { recordPayment } = await import("@/lib/repo/payments");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let custId = 0;
let product = 0;
let packaging = 0;

beforeEach(() => {
  const db = getDb();
  /* The ledger is append-only by trigger and its AR leg REFERENCES customers(id), so
     `DELETE FROM customers` below raises FOREIGN KEY constraint failed once any test in
     this file has recorded a payment. Children before parents -- see
     tests/helpers/ledgerTeardown.ts, and note the scope warning in it: many suites do not
     set ROUTEFLOW_DB_PATH, so this must stay an explicit per-suite call and never a global
     setupFiles hook, which would run against the real data/routeflow.db. */
  clearLedger(db);

  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM events; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM deliveries; DELETE FROM delivery_lines; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM facilities; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x:y", "م", "owner", now).lastInsertRowid);
  driver = Number(u.run(`d${Date.now()}`, "x:y", "ر", "delivery_driver", now).lastInsertRowid);
  custId = Number(
    db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C1','x','active','2026-01-01',1)").run().lastInsertRowid
  );
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
});

describe("events bus", () => {
  it("emitEvent writes a row recentEvents reads back, filterable by kind and since", () => {
    emitEvent(1, { kind: "test.a", metadata: { x: 1 }, occurred_at: "2026-01-01T00:00:00.000Z" });
    emitEvent(1, { kind: "test.b", occurred_at: "2026-01-02T00:00:00.000Z" });
    expect(recentEvents(1, { kind: "test.a" })).toHaveLength(1);
    expect(recentEvents(1, { since: "2026-01-01T12:00:00.000Z" }).map((e) => e.kind)).toEqual(["test.b"]);
  });

  it("recordPayment emits payment.recorded", () => {
    recordPayment(1, {
      customer_id: custId,
      amount_toman: 500,
      method: "CASH",
      received_at: new Date().toISOString(),
      received_by: owner,
      allocations: [{ order_id: null, amount_toman: 500 }],
    });
    expect(recentEvents(1, { kind: "payment.recorded" })).toHaveLength(1);
  });

  it("a nothing-taken delivery emits delivery.failed", () => {
    const db = getDb();
    const o = createOrder(db, {
      customer_id: custId,
      order_date: "2026-01-01",
      created_by: owner,
      organization_id: 1,
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    });
    confirmOrder(db, o.id);
    const run = createRun(db, { driver_user_id: driver, run_date: "2026-01-02", created_by: owner, organization_id: 1 });
    const stopId = addStop(db, run, o.id);
    const lineId = (db.prepare("SELECT id FROM order_lines WHERE order_id = ?").get(o.id) as { id: number }).id;
    recordDelivery(db, stopId, { lines: [{ line_id: lineId, packs_delivered: 0 }], collected_toman: 0, by: driver });
    const evs = recentEvents(1, { kind: "delivery.failed" });
    expect(evs).toHaveLength(1);
    expect(JSON.parse(evs[0].metadata_json!).customer_id).toBe(custId);
  });
});
