import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-order-advance-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const {
  advanceOrder,
  orderEvents,
  legalActionsForOrder,
  OrderTransitionError,
  OrderRoleError,
  OrderError,
} = await import("@/lib/repo/orders");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let user = 0;
let prod = 0;
let pkg = 0;

async function makeOrder(status: string, orgId = 1): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  const cust = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('c'||abs(random()),'ر',?,?)"
      )
      .run(now, orgId)).lastInsertRowid
  );
  const oid = Number(
    (await db
      .prepare(
        `INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at, organization_id)
         VALUES ('o'||abs(random()), ?, ?, '2026-01-01', ?, ?, ?, ?)`
      )
      .run(cust, status, user, now, now, orgId)).lastInsertRowid
  );
  await db.prepare(
    `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit, created_at)
     VALUES (?, ?, ?, 2, 100, 60, 50, 0.25, ?)`
  ).run(oid, prod, pkg, now);
  return oid;
}

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "DELETE FROM stock_reservations; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM order_events; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users; DELETE FROM facilities;"
  );
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'B', 'b', ?) ON CONFLICT DO NOTHING"
  ).run(now);
  user = Number(
    (await db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, created_at, organization_id) VALUES ('o','x','مالک','owner',?,1)"
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
      .run(prod, "کارتن", 50, now)).lastInsertRowid
  );
});

describe("advanceOrder", () => {
  it("submits a draft and records the event", async () => {
    const oid = await makeOrder("DRAFT");
    const to = await advanceOrder(1, oid, "submit", { id: user, role: "phone_sales" });
    expect(to).toBe("PENDING_REVIEW");
    const ev = await orderEvents(1, oid);
    expect(ev.at(-1)).toMatchObject({
      from_status: "DRAFT",
      to_status: "PENDING_REVIEW",
      action: "submit",
      actor_user_id: user,
    });
  });

  it("refuses an illegal edge with the legal options", async () => {
    const oid = await makeOrder("DRAFT");
    try {
      await advanceOrder(1, oid, "deliver", { id: user, role: "owner" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OrderTransitionError);
      expect((e as InstanceType<typeof OrderTransitionError>).legal.sort()).toEqual(
        ["cancel", "submit"].sort()
      );
    }
  });

  it("refuses the right role on a legal edge", async () => {
    const oid = await makeOrder("PENDING_REVIEW");
    await expect((async () => await advanceOrder(1, oid, "passReview", { id: user, role: "phone_sales" }))()).rejects.toThrow(OrderRoleError);
  });

  it("404s a cross-tenant order id", async () => {
    const other = await makeOrder("DRAFT", 2);
    await expect((async () => await advanceOrder(1, other, "submit", { id: user, role: "owner" }))()).rejects.toThrow(OrderError);
  });

  it("reserves stock when the order passes review", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const fac = Number(
      (await db
        .prepare(
          "INSERT INTO facilities (slug, kind, name, lat, lng, updated_at, organization_id, created_at) VALUES ('w','warehouse','ا',0,0,?,1,?)"
        )
        .run(now, now)).lastInsertRowid
    );
    const b = Number(
      (await db
        .prepare(
          "INSERT INTO batches (organization_id, product_id, batch_code, expiry_date, qty_received_base, unit_cost_toman, status, created_at, updated_at) VALUES (1,?,?,?,200,0,'active',?,?)"
        )
        .run(prod, "B1", "2026-05-01", now, now)).lastInsertRowid
    );
    await db.prepare(
      "INSERT INTO stock_movements (organization_id, facility_id, product_id, batch_id, base_qty, kind, occurred_at, created_at) VALUES (1,?,?,?,200,'PURCHASE_IN',?,?)"
    ).run(fac, prod, b, now, now);

    const oid = await makeOrder("PENDING_REVIEW");
    await advanceOrder(1, oid, "passReview", { id: user, role: "group_manager" });
    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM stock_reservations WHERE order_id = ? AND released_at IS NULL")
      .get(oid) as { n: number };
    expect(n.n).toBe(1); // 100 base (2 packs * 50) from the one batch
    expect(await legalActionsForOrder(1, oid, "group_manager")).toContain("plan");
  });

  it("releases reservations on cancel", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const fac = Number(
      (await db
        .prepare(
          "INSERT INTO facilities (slug, kind, name, lat, lng, updated_at, organization_id, created_at) VALUES ('w2','warehouse','ا',0,0,?,1,?)"
        )
        .run(now, now)).lastInsertRowid
    );
    const b = Number(
      (await db
        .prepare(
          "INSERT INTO batches (organization_id, product_id, batch_code, expiry_date, qty_received_base, unit_cost_toman, status, created_at, updated_at) VALUES (1,?,?,?,200,0,'active',?,?)"
        )
        .run(prod, "B2", "2026-05-01", now, now)).lastInsertRowid
    );
    await db.prepare(
      "INSERT INTO stock_movements (organization_id, facility_id, product_id, batch_id, base_qty, kind, occurred_at, created_at) VALUES (1,?,?,?,200,'PURCHASE_IN',?,?)"
    ).run(fac, prod, b, now, now);

    const oid = await makeOrder("CONFIRMED");
    // seed a live reservation directly
    await db.prepare(
      "INSERT INTO stock_reservations (organization_id, order_id, order_line_id, product_id, batch_id, base_qty, created_at) SELECT 1, ?, ol.id, ?, ?, 100, ? FROM order_lines ol WHERE ol.order_id = ?"
    ).run(oid, prod, b, now, oid);
    await advanceOrder(1, oid, "cancel", { id: user, role: "owner" });
    const open = await db
      .prepare("SELECT COUNT(*) AS n FROM stock_reservations WHERE order_id = ? AND released_at IS NULL")
      .get(oid) as { n: number };
    expect(open.n).toBe(0);
  });
});
