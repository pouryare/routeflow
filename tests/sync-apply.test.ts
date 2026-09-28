import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { IncomingMutation } from "@/lib/repo/syncMutations";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-sync-apply-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop } = await import("@/lib/delivery");
const { deliveryForStop } = await import("@/lib/repo/deliveries");
const { advanceOrder } = await import("@/lib/repo/orders");
const { applyMutations } = await import("@/lib/repo/syncMutations");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let custId = 0;
let product = 0;
let packaging = 0;

function mut(o: Partial<IncomingMutation> & { client_uuid: string; op: string }): IncomingMutation {
  return {
    payload: {},
    occurred_at: "2026-01-01T10:00:00.000Z",
    clock_skew_ms: 0,
    ...o,
  } as IncomingMutation;
}

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM sync_mutations; DELETE FROM reminders; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM delivery_lines; DELETE FROM deliveries; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM facilities; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x:y", "م", "owner", now).lastInsertRowid);
  driver = Number(u.run(`d${Date.now()}`, "x:y", "ر", "delivery_driver", now).lastInsertRowid);
  custId = Number(
    db
      .prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C1','x','active','2026-01-01',1)")
      .run().lastInsertRowid
  );
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1_000, valid_from: "2026-01-01" });
});

describe("applyMutations", () => {
  it("applies an offline order then its dependent payment, resolving the client ref", () => {
    const res = applyMutations(1, owner, [
      mut({
        client_uuid: "o1",
        op: "order.draftCreate",
        payload: {
          customer_id: custId,
          order_date: "2026-01-01",
          lines: [{ product_id: product, packaging_id: packaging, packs: 2 }],
        },
      }),
      mut({
        client_uuid: "p1",
        op: "payment.record",
        depends_on: ["o1"],
        payload: {
          customer_id: custId,
          amount_toman: 2000,
          method: "CASH",
          order_ref: "o1",
          allocations: [{ order_id: 0, amount_toman: 2000 }],
        },
      }),
    ]);
    expect(res.o1.status).toBe("applied");
    expect(res.p1.status).toBe("applied");
    const orderId = (res.o1 as { server_id: number }).server_id;
    const alloc = getDb()
      .prepare(
        "SELECT pa.order_id FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE p.client_uuid = 'p1'"
      )
      .get() as { order_id: number };
    expect(alloc.order_id).toBe(orderId);
  });

  it("is idempotent -- replaying the batch makes no new rows", () => {
    const batch: IncomingMutation[] = [
      mut({
        client_uuid: "o2",
        op: "order.draftCreate",
        payload: {
          customer_id: custId,
          order_date: "2026-01-01",
          lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
        },
      }),
    ];
    applyMutations(1, owner, batch);
    const first = getDb().prepare("SELECT COUNT(*) n FROM orders").get() as { n: number };
    const res2 = applyMutations(1, owner, batch);
    expect(res2.o2.status).toBe("duplicate");
    expect((getDb().prepare("SELECT COUNT(*) n FROM orders").get() as { n: number }).n).toBe(first.n);
  });

  it("conflicts a delivery.complete for an order the server has cancelled, and raises a reminder", () => {
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
    const deliveryId = deliveryForStop(1, stopId)!.id;
    advanceOrder(1, o.id, "unplan", { id: owner, role: "owner" });
    advanceOrder(1, o.id, "cancel", { id: owner, role: "owner" });

    const res = applyMutations(1, driver, [
      mut({
        client_uuid: "d1",
        op: "delivery.complete",
        payload: { delivery_id: deliveryId, outcome: "delivered", collected_toman: 1000 },
      }),
    ]);
    expect(res.d1.status).toBe("conflict");
    expect((db.prepare("SELECT COUNT(*) n FROM reminders").get() as { n: number }).n).toBe(1);
    expect(
      (db.prepare("SELECT status FROM sync_mutations WHERE client_uuid='d1'").get() as { status: string }).status
    ).toBe("conflict");
  });

  it("fails a bad payment with the PaymentError message and stamps the mutation failed", () => {
    const res = applyMutations(1, owner, [
      mut({
        client_uuid: "bad1",
        op: "payment.record",
        payload: { customer_id: custId, amount_toman: 12.5, method: "CASH" },
      }),
    ]);
    expect(res.bad1.status).toBe("failed");
    expect(
      (getDb().prepare("SELECT status FROM sync_mutations WHERE client_uuid='bad1'").get() as { status: string }).status
    ).toBe("failed");
  });
});
