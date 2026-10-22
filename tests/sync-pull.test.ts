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
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());
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
    roles: [role] as Session["roles"],
    hasRole: (x) => x === role,
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
  driverA = Number(u.run(`da${Date.now()}`, "x", "ر", "delivery_driver", groupA, now, 1).lastInsertRowid);
  driverB = Number(u.run(`db${Date.now()}`, "x", "ر", "delivery_driver", groupA, now, 1).lastInsertRowid);
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
  // createRun returns the run id itself, not an object. A version of this helper returned
  // `o.id` (the ORDER id), and a later test then inserted its visit onto that id — which is not
  // an error, because lead_run_stops only checks that SOME run exists, so the visit silently
  // landed on the wrong driver's run and the test failed for the wrong reason.
  return run;
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

    const res = pullSince(sess(driverA, "delivery_driver", 1, groupA), null);
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
    const first = pullSince(sess(driverA, "delivery_driver", 1, groupA), null);
    const second = pullSince(sess(driverA, "delivery_driver", 1, groupA), first.watermark);
    expect(second.rows.filter((r) => r.table === "orders")).toEqual([]);
  });

  it("surfaces a tombstone recorded after the watermark", async () => {
    const first = pullSince(sess(driverA, "delivery_driver", 1, groupA), null);
    // The watermark is the newest change seen and the filter is strict (`>`), so a tombstone
    // stamped in the same millisecond would be missed; make sure the clock has moved on.
    await new Promise((r) => setTimeout(r, 5));
    tombstone(1, "order_line", 999);
    const second = pullSince(sess(driverA, "delivery_driver", 1, groupA), first.watermark);
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

  it("carries the driver's VISITS, not just their deliveries — the gap that motivated the merge", () => {
    // THE REGRESSION. pullSince read delivery_runs and delivery_stops and NOTHING else, so a
    // driver offline in the field saw their deliveries and zero visits. For a field rep or a van
    // driver who does both jobs, half of the day's manifest was simply absent — with no error,
    // because a missing row looks exactly like a day with no visits.
    //
    // Phase 2 folded lead_runs into delivery_runs, which is what made this fixable at all: a
    // visit now hangs off the same run_id the driver already has.
    const db = getDb();
    const runId = runFor(driverA, custA);
    const locId = Number(
      db
        .prepare(
          "INSERT INTO saved_locations (name, maps_url, organization_id, created_at) VALUES (?, ?, 1, ?)"
        )
        .run(`SYNC-LOC-${Date.now()}`, `u${Date.now()}`, new Date().toISOString()).lastInsertRowid,
    );
    db.prepare(
      "INSERT INTO lead_run_stops (run_id, location_id, sort_order, created_at) VALUES (?, ?, 0, ?)"
    ).run(runId, locId, new Date().toISOString());

    const res = pullSince(sess(driverA, "delivery_driver", 1, null), null);

    const visitTables = res.rows.filter((r) => r.table === "lead_run_stops").map((r) => r.row.location_id);
    expect(visitTables, "a driver's visits never reached the device").toContain(locId);

    // And the pin itself has to come with it — a visit row pointing at a location the device has
    // never heard of is a stop that renders as a blank card.
    const locs = res.rows.filter((r) => r.table === "saved_locations").map((r) => r.row.id);
    expect(locs).toContain(locId);
  });

  it("does not leak another driver's visits", () => {
    const db = getDb();
    const runA = runFor(driverA, custA);
    const runB = runFor(driverB, custA);
    const locId = Number(
      db
        .prepare(
          "INSERT INTO saved_locations (name, maps_url, organization_id, created_at) VALUES (?, ?, 1, ?)"
        )
        .run(`SYNC-LOC-B-${Date.now()}`, `ub${Date.now()}`, new Date().toISOString()).lastInsertRowid,
    );
    db.prepare(
      "INSERT INTO lead_run_stops (run_id, location_id, sort_order, created_at) VALUES (?, ?, 0, ?)"
    ).run(runB, locId, new Date().toISOString());
    expect(runA).not.toBe(runB);

    const mine = pullSince(sess(driverA, "delivery_driver", 1, null), null);
    const others = mine.rows
      .filter((r) => r.table === "lead_run_stops")
      .map((r) => r.row.location_id);
    expect(others).not.toContain(locId);
  });
});
