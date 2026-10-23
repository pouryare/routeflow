import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-pay-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const {
  recordPayment,
  autoAllocateFIFO,
  voidPayment,
  allocationsOfPayment,
  PaymentError,
} = await import("@/lib/repo/payments");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let userId = 0;
let custId = 0;

/** A delivered order worth `total` Toman: one line, price = total, one pack. */
async function deliveredOrder(total: number, dateISO = "2026-01-01"): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  const tag = Math.random().toString(36).slice(2);
  const orderId = Number(
    (await db
      .prepare(
        `INSERT INTO orders (order_no,customer_id,order_date,status,delivered_at,created_by,created_at,updated_at,organization_id)
         VALUES (?,?,?,'DELIVERED',?,?,?,?,1)`
      )
      .run(`o-${tag}`, custId, dateISO, dateISO, userId, now, now)).lastInsertRowid
  );
  const productId = Number(
    (await db
      .prepare(
        "INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES (?,?,?,?,1)"
      )
      .run(`p${tag}`, `s${tag}`, now, now)).lastInsertRowid
  );
  const packId = Number(
    (await db
      .prepare(
        "INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,?,1,?)"
      )
      .run(productId, "box", now)).lastInsertRowid
  );
  await db.prepare(
    `INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at)
     VALUES (?,?,?,1,1,?,0,1,1,0,?)`
  ).run(orderId, productId, packId, total, now);
  return orderId;
}

beforeEach(async () => {
  const db = getDb();

  /* FIRST, because everything below depends on it. The ledger is append-only by trigger,
     so its rows cannot be deleted, and its AR leg holds a real FK to customers(id). Once
     a previous test has posted a receipt, the `DELETE FROM customers` below raises
     FOREIGN KEY constraint failed. Children before parents.

     A fixture may reset state the application never can; what would not be acceptable is
     dropping the FK or the triggers to make a fixture convenient. */
  await clearLedger(db);

  await db.exec(
    "DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id > 0;"
  );

  const now = new Date().toISOString();
  userId = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'group_manager',NULL,1,?,1)"
      )
      .run(`u${Date.now()}`, "x:y", "م", now)).lastInsertRowid
  );
  custId = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES (?,?,'RESTAURANT','active','2026-01-01',1)"
      )
      .run(`C${Date.now()}`, "x")).lastInsertRowid
  );
});

describe("recordPayment", () => {
  it("auto-allocates FIFO across delivered orders, remainder on account", async () => {
    const o1 = await deliveredOrder(30_000, "2026-01-01");
    const o2 = await deliveredOrder(50_000, "2026-01-05");
    const pid = await recordPayment(1, {
      customer_id: custId,
      amount_toman: 100_000,
      method: "CASH",
      received_at: "2026-02-01",
      received_by: userId,
    });
    expect(await allocationsOfPayment(1, pid)).toEqual([
      { order_id: o1, amount_toman: 30_000 },
      { order_id: o2, amount_toman: 50_000 },
      { order_id: null, amount_toman: 20_000 },
    ]);
    const db = getDb();
    expect(
      (await db.prepare("SELECT payment_status FROM orders WHERE id=?").get(o1) as { payment_status: string })
        .payment_status
    ).toBe("paid");
    expect(
      (await db.prepare("SELECT payment_status FROM orders WHERE id=?").get(o2) as { payment_status: string })
        .payment_status
    ).toBe("paid");
  });

  it("honours an explicit split and rejects one that overshoots the order", async () => {
    const o1 = await deliveredOrder(30_000);
    await recordPayment(1, {
      customer_id: custId,
      amount_toman: 20_000,
      method: "POS",
      received_at: "2026-02-01",
      received_by: userId,
      allocations: [{ order_id: o1, amount_toman: 20_000 }],
    });
    expect(
      (await getDb().prepare("SELECT payment_status FROM orders WHERE id=?").get(o1) as {
        payment_status: string;
      }).payment_status
    ).toBe("partial");
    await expect((async () =>
      await recordPayment(1, {
        customer_id: custId,
        amount_toman: 25_000,
        method: "POS",
        received_at: "2026-02-01",
        received_by: userId,
        allocations: [{ order_id: o1, amount_toman: 25_000 }],
      }))()).rejects.toThrow(PaymentError);
  });

  it("rejects a split whose sum is not the payment amount", async () => {
    const o1 = await deliveredOrder(30_000);
    await expect((async () =>
      await recordPayment(1, {
        customer_id: custId,
        amount_toman: 20_000,
        method: "CASH",
        received_at: "x",
        received_by: userId,
        allocations: [{ order_id: o1, amount_toman: 15_000 }],
      }))()).rejects.toThrow(PaymentError);
  });

  it("rejects a non-integer amount", async () => {
    await deliveredOrder(30_000);
    await expect((async () =>
      await recordPayment(1, {
        customer_id: custId,
        amount_toman: 10.5,
        method: "CASH",
        received_at: "x",
        received_by: userId,
      }))()).rejects.toThrow(PaymentError);
  });

  it("404s an allocation to another org's order", async () => {
    const db = getDb();
    await db.prepare(
      "INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'Two','two','2026-01-01')"
    ).run();
    const otherCust = Number(
      (await db
        .prepare(
          "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('X','x','active','2026-01-01',2)"
        )
        .run()).lastInsertRowid
    );
    const otherOrder = Number(
      (await db
        .prepare(
          "INSERT INTO orders (order_no,customer_id,order_date,status,created_by,created_at,updated_at,organization_id) VALUES ('x1',?,?,'DELIVERED',?,?,?,2)"
        )
        .run(otherCust, "2026-01-01", userId, "x", "x")).lastInsertRowid
    );
    await expect((async () =>
      await recordPayment(1, {
        customer_id: custId,
        amount_toman: 1000,
        method: "CASH",
        received_at: "x",
        received_by: userId,
        allocations: [{ order_id: otherOrder, amount_toman: 1000 }],
      }))()).rejects.toThrow(PaymentError);
  });
});

describe("autoAllocateFIFO", () => {
  it("skips already-paid orders", async () => {
    const o1 = await deliveredOrder(30_000, "2026-01-01");
    const o2 = await deliveredOrder(40_000, "2026-01-02");
    await recordPayment(1, {
      customer_id: custId,
      amount_toman: 30_000,
      method: "CASH",
      received_at: "2026-01-03",
      received_by: userId,
    });
    expect(await autoAllocateFIFO(1, custId, 40_000)).toEqual([{ order_id: o2, amount_toman: 40_000 }]);
    expect(o1).toBeGreaterThan(0);
  });
});

describe("voidPayment", () => {
  it("removes allocations and reverts the order caches", async () => {
    const o1 = await deliveredOrder(30_000);
    const pid = await recordPayment(1, {
      customer_id: custId,
      amount_toman: 30_000,
      method: "CASH",
      received_at: "2026-02-01",
      received_by: userId,
    });
    await voidPayment(1, pid, userId, "خطای ثبت");
    const db = getDb();
    expect(await db.prepare("SELECT COUNT(*) n FROM payment_allocations WHERE payment_id=?").get(pid)).toEqual(
      { n: 0 }
    );
    expect(
      await db.prepare("SELECT paid_toman,payment_status FROM orders WHERE id=?").get(o1)
    ).toMatchObject({ paid_toman: 0, payment_status: "unpaid" });
    await expect((async () => await voidPayment(1, pid, userId, "دوباره"))()).rejects.toThrow(PaymentError);
  });
});
