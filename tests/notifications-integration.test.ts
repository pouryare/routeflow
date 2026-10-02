import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-notif-integration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, recordDelivery } = await import("@/lib/delivery");
const { recordPayment } = await import("@/lib/repo/payments");
const { listNotificationGroups, unreadGroupCount } = await import("@/lib/repo/notifications");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let seller = 0;
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
    "PRAGMA foreign_keys=OFF; DELETE FROM notifications; DELETE FROM rule_runs; DELETE FROM events; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM deliveries; DELETE FROM delivery_lines; DELETE FROM delivery_line_batches; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM tasks; DELETE FROM alerts; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM facilities; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x:y", "مالک", "owner", now).lastInsertRowid);
  driver = Number(u.run(`d${Date.now()}`, "x:y", "راننده", "delivery_driver", now).lastInsertRowid);
  seller = Number(u.run(`s${Date.now()}`, "x:y", "فروشنده", "phone_sales", now).lastInsertRowid);
  custId = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C1','x','active','2026-01-01',1)"
      )
      .run().lastInsertRowid
  );
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
});

/** createOrder then pin the salesperson: recipientsFor(order/delivery/payment) resolves
 *  the recipient from orders.salesperson_user_id, so every order these tests deliver on
 *  has to name one. */
function orderForSeller(): number {
  const db = getDb();
  const o = createOrder(db, {
    customer_id: custId,
    order_date: "2026-01-01",
    created_by: owner,
    organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
  });
  db.prepare("UPDATE orders SET salesperson_user_id = ? WHERE id = ?").run(seller, o.id);
  return o.id;
}

describe("notification system — end to end", () => {
  it("a passed review notifies the order's salesperson via the seeded notify rule", () => {
    const db = getDb();
    const orderId = orderForSeller();
    confirmOrder(db, orderId); // drives submit -> passReview

    const groups = listNotificationGroups(1, seller);
    expect(groups.some((g) => g.items.some((i) => i.title_fa.includes("سفارش")))).toBe(true);
  });

  it("a successful delivery notifies the salesperson", () => {
    const db = getDb();
    const orderId = orderForSeller();
    confirmOrder(db, orderId);

    const run = createRun(db, {
      driver_user_id: driver,
      run_date: "2026-01-02",
      created_by: owner,
      organization_id: 1,
    });
    const stopId = addStop(db, run, orderId);
    const lineId = (
      db.prepare("SELECT id FROM order_lines WHERE order_id = ?").get(orderId) as { id: number }
    ).id;
    recordDelivery(db, stopId, {
      lines: [{ line_id: lineId, packs_delivered: 1 }],
      collected_toman: 0,
      by: driver,
    });

    const groups = listNotificationGroups(1, seller);
    expect(groups.some((g) => g.group_key.startsWith("delivery.succeeded:"))).toBe(true);
  });

  it("createTask with an assignee notifies that assignee", async () => {
    const { createTask } = await import("@/lib/repo/tasks");
    createTask(1, { title: "پیگیری", kind: "call", assignee_user_id: seller, created_by: owner });
    expect(unreadGroupCount(1, seller)).toBeGreaterThanOrEqual(1);
  });

  it("a recorded payment allocated to an order notifies its salesperson (meta.order_ids)", () => {
    const orderId = orderForSeller();
    recordPayment(1, {
      customer_id: custId,
      amount_toman: 500,
      method: "CASH",
      received_at: new Date().toISOString(),
      received_by: owner,
      allocations: [{ order_id: orderId, amount_toman: 500 }],
    });

    expect(unreadGroupCount(1, seller)).toBeGreaterThanOrEqual(1);
    const groups = listNotificationGroups(1, seller);
    expect(groups.some((g) => g.items.some((i) => i.title_fa.includes("پرداخت")))).toBe(true);
  });

  it("a new order in a group notifies that group's manager (ambient order.created path)", () => {
    const db = getDb();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // A group, a group_manager sitting in it, and a customer whose orders fall in that group.
    const grp = Number(
      db
        .prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES (?, ?, ?, 1)")
        .run(`گروه ${stamp}`, `grp-${stamp}`, new Date().toISOString()).lastInsertRowid
    );
    const mgr = Number(
      db
        .prepare(
          "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)"
        )
        .run(`gm${stamp}`, "x:y", "مدیر گروه", "group_manager", grp, new Date().toISOString()).lastInsertRowid
    );
    const custInGroup = Number(
      db
        .prepare(
          "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id,group_id) VALUES (?,'x','active','2026-01-01',1,?)"
        )
        .run(`CG-${stamp}`, grp).lastInsertRowid
    );

    // actor = the salesperson; createOrder derives orders.group_id from the customer.
    const o = createOrder(db, {
      customer_id: custInGroup,
      order_date: "2026-01-01",
      created_by: seller,
      salesperson_user_id: seller,
      organization_id: 1,
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    });
    confirmOrder(db, o.id); // real path: drives order.submit -> the seeded notify_order_created rule

    const groups = listNotificationGroups(1, mgr);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups.some((g) => g.group_key.startsWith("order.created:"))).toBe(true);
    expect(unreadGroupCount(1, mgr)).toBeGreaterThanOrEqual(1);
  });
});
