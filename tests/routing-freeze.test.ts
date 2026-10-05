import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-routing-freeze-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, DeliveryError } = await import("@/lib/delivery");
const { freezeRun, runsNeedingFreeze, createRouteTemplate } = await import("@/lib/repo/routing");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let product = 0;
let packaging = 0;

function confirmedOrder(): number {
  const db = getDb();
  const cust = Number(
    db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('c'||abs(random()),'x','active',?,1)").run(new Date().toISOString()).lastInsertRowid
  );
  const o = createOrder(db, {
    customer_id: cust,
    order_date: "2026-03-01",
    created_by: owner,
    organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
  });
  confirmOrder(db, o.id);
  return o.id;
}

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM deliveries; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM route_schedules; DELETE FROM route_templates; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x:y", "م", "owner", now).lastInsertRowid);
  driver = Number(u.run(`d${Date.now()}`, "x:y", "ر", "delivery_driver", now).lastInsertRowid);
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
});

describe("route freeze", () => {
  it("freezeRun sets frozen_at, status ready, and moves every order to READY", () => {
    const db = getDb();
    const run = createRun(db, { driver_user_id: driver, run_date: "2026-03-01", created_by: owner, organization_id: 1 });
    const o1 = confirmedOrder();
    const o2 = confirmedOrder();
    addStop(db, run, o1);
    addStop(db, run, o2);

    freezeRun(1, run, { id: owner, role: "owner" });
    const r = db.prepare("SELECT frozen_at, status FROM delivery_runs WHERE id = ?").get(run) as {
      frozen_at: string | null;
      status: string;
    };
    expect(r.frozen_at).not.toBeNull();
    expect(r.status).toBe("ready");
    for (const id of [o1, o2]) {
      expect((db.prepare("SELECT status FROM orders WHERE id = ?").get(id) as { status: string }).status).toBe("READY");
    }
  });

  it("addStop on a frozen run throws, but force succeeds and writes an event", () => {
    const db = getDb();
    const run = createRun(db, { driver_user_id: driver, run_date: "2026-03-01", created_by: owner, organization_id: 1 });
    addStop(db, run, confirmedOrder());
    freezeRun(1, run, { id: owner, role: "owner" });

    const late = confirmedOrder();
    expect(() => addStop(db, run, late)).toThrow(DeliveryError);
    expect(() => addStop(db, run, late, 9, { force: true })).not.toThrow();
    const ev = db
      .prepare("SELECT note FROM order_events WHERE order_id = ? AND action = 'note'")
      .get(late) as { note: string } | undefined;
    expect(ev?.note).toContain("قطعی");
  });

  it("runsNeedingFreeze returns a past-cutoff unfrozen run and skips others", () => {
    const db = getDb();
    const tmpl = createRouteTemplate(1, { code: "T1", name: "شرق" });
    db.prepare(
      "INSERT INTO route_schedules (organization_id, route_template_id, day_of_week, cutoff_time, created_at) VALUES (1, ?, ?, '09:00', ?)"
    ).run(tmpl, (new Date("2026-03-01T12:00:00Z").getDay() + 1) % 7, new Date().toISOString());

    const runPast = createRun(db, { driver_user_id: driver, run_date: "2026-03-01", created_by: owner, organization_id: 1 });
    db.prepare("UPDATE delivery_runs SET route_template_id = ? WHERE id = ?").run(tmpl, runPast);

    const driver2 = Number(
      db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('d2','x','ر۲','delivery_driver',1,?,1)").run(new Date().toISOString()).lastInsertRowid
    );
    const runFrozen = createRun(db, {
      driver_user_id: driver2,
      run_date: "2026-03-01",
      created_by: owner,
      organization_id: 1,
    });
    db.prepare("UPDATE delivery_runs SET route_template_id = ?, frozen_at = ? WHERE id = ?").run(
      tmpl,
      new Date().toISOString(),
      runFrozen
    );

    const need = runsNeedingFreeze(1, "2026-03-01T12:00:00Z");
    expect(need.map((r) => r.id)).toContain(runPast);
    expect(need.map((r) => r.id)).not.toContain(runFrozen);
  });
});
