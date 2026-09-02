import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-routing-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { planDelivery } = await import("@/lib/repo/deliveries");
const { createVehicle, buildPlan, commitPlan, routableDeliveriesFor } = await import(
  "@/lib/repo/routing"
);

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let product = 0;
let packaging = 0;

const DEPOT = { lat: 35.7, lng: 51.4 };

function customerAt(lat: number, lng: number): number {
  return Number(
    getDb()
      .prepare(
        "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,lat,lng,organization_id) VALUES ('c'||abs(random()),'x','active',?,?,?,1)"
      )
      .run(new Date().toISOString(), lat, lng).lastInsertRowid
  );
}

function confirmedOrderFor(custId: number): number {
  const db = getDb();
  const o = createOrder(db, {
    customer_id: custId,
    order_date: "2026-03-01",
    created_by: owner,
    organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs: 2 }],
  });
  confirmOrder(db, o.id);
  planDelivery(1, o.id, {});
  return o.id;
}

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM delivery_lines; DELETE FROM deliveries; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM route_schedules; DELETE FROM route_templates; DELETE FROM vehicles; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM facilities; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x:y", "م", "owner", now).lastInsertRowid);
  driver = Number(u.run(`d${Date.now()}`, "x:y", "ر", "driver", now).lastInsertRowid);
  db.prepare(
    "INSERT INTO facilities (slug,kind,name,lat,lng,updated_at,organization_id,created_at) VALUES ('wh','warehouse','انبار',?,?,?,1,?)"
  ).run(DEPOT.lat, DEPOT.lng, now, now);
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
});

describe("routing repo (no OSRM/VROOM -> greedy path)", () => {
  it("builds a greedy plan ordered nearest-first from the depot", async () => {
    confirmedOrderFor(customerAt(35.705, 51.405)); // closest
    confirmedOrderFor(customerAt(35.73, 51.43));
    confirmedOrderFor(customerAt(35.78, 51.48)); // farthest
    createVehicle(1, { name: "وانت", driver_default_id: driver, max_stops: 20 });

    const plan = await buildPlan(1, { date: "2026-03-01" });
    expect(plan.source).toBe("greedy");
    expect(plan.assignments).toHaveLength(1);
    const ds = routableDeliveriesFor(1, { date: "2026-03-01" });
    const closest = ds.find((d) => d.lat === 35.705)!.delivery_id;
    expect(plan.assignments[0].stops[0].delivery_id).toBe(closest);
    expect(plan.assignments[0].distance_km).toBeGreaterThan(0);
  });

  it("commits the plan into one run with all the stops, and a re-commit adds nothing", async () => {
    confirmedOrderFor(customerAt(35.705, 51.405));
    confirmedOrderFor(customerAt(35.73, 51.43));
    createVehicle(1, { name: "وانت", driver_default_id: driver });

    const plan = await buildPlan(1, { date: "2026-03-01" });
    const { run_ids } = commitPlan(1, plan, { planned_by: owner });
    expect(run_ids).toHaveLength(1);
    const stops = getDb()
      .prepare("SELECT COUNT(*) n FROM delivery_stops WHERE run_id = ?")
      .get(run_ids[0]) as { n: number };
    expect(stops.n).toBe(2);
    const km = getDb()
      .prepare("SELECT planned_distance_km FROM delivery_runs WHERE id = ?")
      .get(run_ids[0]) as { planned_distance_km: number };
    expect(km.planned_distance_km).toBeGreaterThan(0);

    commitPlan(1, plan, { planned_by: owner });
    expect(
      (getDb().prepare("SELECT COUNT(*) n FROM delivery_stops WHERE run_id = ?").get(run_ids[0]) as { n: number }).n
    ).toBe(2);
  });

  it("drops the overflow into unassigned when a vehicle is capped", async () => {
    for (let i = 0; i < 4; i++) confirmedOrderFor(customerAt(35.7 + i * 0.01, 51.4 + i * 0.01));
    createVehicle(1, { name: "وانت", driver_default_id: driver, max_stops: 3 });

    const plan = await buildPlan(1, { date: "2026-03-01" });
    expect(plan.assignments[0].stops).toHaveLength(3);
    expect(plan.unassigned).toHaveLength(1);
  });
});
