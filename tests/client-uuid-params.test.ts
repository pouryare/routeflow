import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-cuuid-params-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { recordPayment } = await import("@/lib/repo/payments");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
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
    "PRAGMA foreign_keys=OFF; DELETE FROM order_events; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  owner = Number(
    db
      .prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','م','owner',?,1)")
      .run(now).lastInsertRowid
  );
  custId = Number(
    db
      .prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C1','x','active','2026-01-01',1)")
      .run().lastInsertRowid
  );
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1_000, valid_from: "2026-01-01" });
});

describe("client_uuid threading", () => {
  it("createOrder writes the client_uuid when given, NULL when not", () => {
    const db = getDb();
    const a = createOrder(db, {
      customer_id: custId,
      order_date: "2026-01-01",
      created_by: owner,
      organization_id: 1,
      client_uuid: "cuuid-1",
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    });
    const b = createOrder(db, {
      customer_id: custId,
      order_date: "2026-01-01",
      created_by: owner,
      organization_id: 1,
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    });
    expect((db.prepare("SELECT client_uuid FROM orders WHERE id=?").get(a.id) as { client_uuid: string | null }).client_uuid).toBe("cuuid-1");
    expect((db.prepare("SELECT client_uuid FROM orders WHERE id=?").get(b.id) as { client_uuid: string | null }).client_uuid).toBeNull();
  });

  it("a replayed client_uuid is refused by the partial unique index", () => {
    const db = getDb();
    createOrder(db, {
      customer_id: custId,
      order_date: "2026-01-01",
      created_by: owner,
      organization_id: 1,
      client_uuid: "dupe",
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    });
    expect(() =>
      createOrder(db, {
        customer_id: custId,
        order_date: "2026-01-01",
        created_by: owner,
        organization_id: 1,
        client_uuid: "dupe",
        lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
      })
    ).toThrow();
  });

  it("recordPayment writes the client_uuid", () => {
    const db = getDb();
    const pid = recordPayment(1, {
      customer_id: custId,
      amount_toman: 500,
      method: "CASH",
      received_at: new Date().toISOString(),
      received_by: owner,
      client_uuid: "pay-cuuid",
      allocations: [{ order_id: null, amount_toman: 500 }],
    });
    expect((db.prepare("SELECT client_uuid FROM payments WHERE id=?").get(pid) as { client_uuid: string }).client_uuid).toBe("pay-cuuid");
  });
});
