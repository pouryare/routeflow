import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-deliveries-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, completeDelivery } = await import("@/lib/delivery");
const { listDeliveries, readDelivery, retryDelivery, deliveryForStop } = await import(
  "@/lib/repo/deliveries"
);

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let custId = 0;
let product = 0;
let packaging = 0;
let reason = 0;

beforeEach(async () => {
  const db = getDb();
  await db.exec("PRAGMA foreign_keys = OFF;");
  await db.exec(
    "DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM delivery_line_batches; DELETE FROM delivery_lines; DELETE FROM deliveries; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM facilities; DELETE FROM users WHERE id > 0;"
  );
  await db.exec("PRAGMA foreign_keys = ON;");
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number((await u.run(`o${Date.now()}`, "x:y", "م", "owner", now)).lastInsertRowid);
  driver = Number((await u.run(`d${Date.now()}`, "x:y", "ر", "delivery_driver", now)).lastInsertRowid);
  custId = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES (?,?,'active','2026-01-01',1)"
      )
      .run(`C${Date.now()}`, "x")).lastInsertRowid
  );
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  await setPrice(db, { product_id: product, price_toman: 1_000, valid_from: "2026-01-01" });
  reason = (
    await db
      .prepare("SELECT id FROM reason_codes WHERE domain='delivery_fail' AND code='CUSTOMER_ABSENT'")
      .get() as { id: number }
  ).id;
  // stock
  const fac = Number(
    (await db
      .prepare(
        "INSERT INTO facilities (slug,kind,name,lat,lng,updated_at,organization_id,created_at) VALUES ('w','warehouse','ا',0,0,?,1,?)"
      )
      .run(now, now)).lastInsertRowid
  );
  const b = Number(
    (await db
      .prepare(
        "INSERT INTO batches (organization_id,product_id,batch_code,expiry_date,qty_received_base,unit_cost_toman,status,created_at,updated_at) VALUES (1,?,?,?,1000,0,'active',?,?)"
      )
      .run(product, "B1", "2026-06-01", now, now)).lastInsertRowid
  );
  await db.prepare(
    "INSERT INTO stock_movements (organization_id,facility_id,product_id,batch_id,base_qty,kind,occurred_at,created_at) VALUES (1,?,?,?,1000,'PURCHASE_IN',?,?)"
  ).run(fac, product, b, now, now);
});

async function readyOrderOnRun(packs: number): Promise<{ orderId: number; stopId: number; runId: number }> {
  const db = getDb();
  const o = await createOrder(db, {
    customer_id: custId,
    order_date: "2026-01-01",
    created_by: owner,
    organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs }],
  });
  await confirmOrder(db, o.id);
  const runId = await createRun(db, {
    driver_user_id: driver,
    run_date: "2026-01-02",
    created_by: owner,
    organization_id: 1,
  });
  const stopId = await addStop(db, runId, o.id);
  return { orderId: o.id, stopId, runId };
}

describe("deliveries repo", () => {
  it("planDelivery creates one delivery + delivery_lines and moves the order to PLANNED", async () => {
    const { orderId, stopId } = await readyOrderOnRun(3);
    const d = (await deliveryForStop(1, stopId))!;
    expect(d.status).toBe("PLANNED");
    expect(d.seq).toBe(1);
    const lines = await getDb()
      .prepare("SELECT qty_planned FROM delivery_lines WHERE delivery_id = ?")
      .all(d.id) as { qty_planned: number }[];
    expect(lines).toEqual([{ qty_planned: 30 }]); // 3 packs * 10
    expect((await getDb().prepare("SELECT status FROM orders WHERE id=?").get(orderId) as { status: string }).status).toBe(
      "PLANNED"
    );
  });

  it("planDelivery is idempotent per stop", async () => {
    await readyOrderOnRun(2);
    const n = await getDb().prepare("SELECT COUNT(*) AS n FROM deliveries").get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("completeDelivery('failed') needs a reason and lands the order in DELIVERY_FAILED", async () => {
    const { orderId, stopId } = await readyOrderOnRun(2);
    const d = (await deliveryForStop(1, stopId))!;
    await expect((async () => await completeDelivery(1, d.id, { id: driver }, { outcome: "failed" }))()).rejects.toThrow();
    await completeDelivery(1, d.id, { id: driver }, { outcome: "failed", fail_reason_id: reason });
    expect((await getDb().prepare("SELECT status FROM orders WHERE id=?").get(orderId) as { status: string }).status).toBe(
      "DELIVERY_FAILED"
    );
    expect((await deliveryForStop(1, stopId))!.status).toBe("FAILED");
    expect((await deliveryForStop(1, stopId))!.completed_at).not.toBeNull();
  });

  it("retryDelivery opens a fresh delivery at seq 2 and returns the order to PLANNED", async () => {
    const { orderId, stopId } = await readyOrderOnRun(2);
    const d = (await deliveryForStop(1, stopId))!;
    await completeDelivery(1, d.id, { id: driver }, { outcome: "failed", fail_reason_id: reason });
    const newId = await retryDelivery(1, d.id, { id: owner, role: "group_manager" });
    const fresh = (await readDelivery(1, newId))!;
    expect(fresh.seq).toBe(2);
    expect(fresh.status).toBe("PLANNED");
    expect((await getDb().prepare("SELECT status FROM orders WHERE id=?").get(orderId) as { status: string }).status).toBe(
      "PLANNED"
    );
    expect(await listDeliveries(1, { order_id: orderId })).toHaveLength(2);
  });

  it("a full delivery drives the order to CLOSED and marks the delivery DELIVERED", async () => {
    const { orderId, stopId } = await readyOrderOnRun(2);
    const d = (await deliveryForStop(1, stopId))!;
    await completeDelivery(1, d.id, { id: driver }, { outcome: "delivered", collected_toman: 2_000 });
    expect((await getDb().prepare("SELECT status FROM orders WHERE id=?").get(orderId) as { status: string }).status).toBe(
      "CLOSED"
    );
    expect((await deliveryForStop(1, stopId))!.status).toBe("DELIVERED");
  });

  it("a short delivery that settles spawns a backorder DRAFT for the shortfall", async () => {
    const { orderId, stopId } = await readyOrderOnRun(5); // 50 base ordered
    const d = (await deliveryForStop(1, stopId))!;
    const lineId = (await getDb().prepare("SELECT id FROM order_lines WHERE order_id=?").get(orderId) as { id: number }).id;
    await completeDelivery(
      1,
      d.id,
      { id: driver },
      { outcome: "partial", lines: [{ order_line_id: lineId, qty_delivered: 30 }], collected_toman: 3_000 }
    );
    const st = (await getDb().prepare("SELECT status FROM orders WHERE id=?").get(orderId) as { status: string }).status;
    expect(st).toBe("CLOSED"); // partial + fully paid for what was delivered
    const backorder = await getDb()
      .prepare("SELECT id, status FROM orders WHERE notes LIKE ? ")
      .get(`%${orderId}%`) as { id: number; status: string } | undefined;
    expect(backorder?.status).toBe("DRAFT");
    const bl = await getDb()
      .prepare("SELECT packs_ordered FROM order_lines WHERE order_id = ?")
      .get(backorder!.id) as { packs_ordered: number };
    expect(bl.packs_ordered).toBeCloseTo(2); // 20 base short / qty_per_pack 10
  });
});
