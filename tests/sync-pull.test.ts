import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-sync-pull-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop } = await import("@/lib/delivery");
const { tombstone } = await import("@/lib/repo/tombstones");
const { pullSince } = await import("@/lib/repo/syncPull");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let ownerA = 0;
let driverA = 0;
let driverB = 0;
let custA = 0;
let product = 0;
let packaging = 0;
let groupA = 0;

const sess = (id: number, role: string, orgId: number, groupId: number | null): Session =>
  ({
    user: { id } as never,
    role: role as never,
    groupId,
    organizationId: orgId,
  }) as Session;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM deleted_rows; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM deliveries; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM product_prices; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM groups; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  db.prepare("INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?)").run(
    new Date().toISOString()
  );
  const now = new Date().toISOString();
  groupA = Number(
    db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('A','a',?,1)").run(now).lastInsertRowid
  );
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,?)"
  );
  ownerA = Number(u.run(`oa${Date.now()}`, "x", "م", "owner", null, now, 1).lastInsertRowid);
  driverA = Number(u.run(`da${Date.now()}`, "x", "ر", "driver", groupA, now, 1).lastInsertRowid);
  driverB = Number(u.run(`db${Date.now()}`, "x", "ر", "driver", groupA, now, 1).lastInsertRowid);
  custA = Number(
    db
      .prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('CA','x','active',?,?,1)")
      .run(now, groupA).lastInsertRowid
  );
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
});

function runFor(driver: number, cust: number): number {
  const db = getDb();
  const o = createOrder(db, {
    customer_id: cust,
    order_date: "2026-01-01",
    created_by: ownerA,
    organization_id: 1,
    salesperson_user_id: ownerA,
    lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
  });
  confirmOrder(db, o.id);
  const run = createRun(db, { driver_user_id: driver, run_date: "2026-01-02", created_by: ownerA, organization_id: 1, group_id: groupA });
  addStop(db, run, o.id);
  return o.id;
}

describe("pullSince", () => {
  it("gives a driver their own run's orders, stops, customers and the catalogue -- nothing else", () => {
    const mine = runFor(driverA, custA);
    // another customer + another driver's run
    const custOther = Number(
      getDb()
        .prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('CO','y','active',?,?,1)")
        .run(new Date().toISOString(), groupA).lastInsertRowid
    );
    const notMine = runFor(driverB, custOther);

    const res = pullSince(sess(driverA, "driver", 1, groupA), null);
    const orderIds = res.rows.filter((r) => r.table === "orders").map((r) => r.row.id);
    expect(orderIds).toContain(mine);
    expect(orderIds).not.toContain(notMine);
    expect(res.rows.some((r) => r.table === "products")).toBe(true);
    expect(res.rows.some((r) => r.table === "product_prices")).toBe(true);
    const custIds = res.rows.filter((r) => r.table === "customers").map((r) => r.row.id);
    expect(custIds).toContain(custA);
    expect(custIds).not.toContain(custOther);
  });

  it("an immediate re-pull at the watermark returns no rows", () => {
    runFor(driverA, custA);
    const first = pullSince(sess(driverA, "driver", 1, groupA), null);
    const second = pullSince(sess(driverA, "driver", 1, groupA), first.watermark);
    expect(second.rows.filter((r) => r.table === "orders")).toEqual([]);
  });

  it("surfaces a tombstone recorded after the watermark", () => {
    const first = pullSince(sess(driverA, "driver", 1, groupA), null);
    tombstone(1, "order_line", 999);
    const second = pullSince(sess(driverA, "driver", 1, groupA), first.watermark);
    expect(second.tombstones.map((t) => t.entity_id)).toContain(999);
  });

  it("does not leak another organisation's rows to a salesperson", () => {
    // org 2 order
    const db = getDb();
    const c2 = Number(
      db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C2','z','active',?,2)").run(new Date().toISOString()).lastInsertRowid
    );
    db.prepare(
      "INSERT INTO orders (order_no,customer_id,status,order_date,created_by,created_at,updated_at,organization_id) VALUES ('x2',?,'CONFIRMED','2026-01-01',?,?,?,2)"
    ).run(c2, ownerA, new Date().toISOString(), new Date().toISOString());
    runFor(driverA, custA);

    const res = pullSince(sess(ownerA, "owner", 1, null), null);
    const orgs = new Set(res.rows.filter((r) => r.table === "orders").map((r) => r.row.organization_id));
    expect([...orgs]).toEqual([1]);
  });
});
