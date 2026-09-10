import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";

const testDbPath = path.join(os.tmpdir(), `rf-driver-activity-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { readDriverActivity } = await import("@/lib/repo/driverActivity");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const sess = (id: number, role: string, gid: number | null): Session =>
  ({ user: { id } as never, role: role as never, groupId: gid, organizationId: 1 }) as Session;

const TODAY = "2026-09-10";
let owner = 0, mgrA = 0, driverA = 0, driverB = 0, idle = 0, groupA = 0, groupB = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM groups; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES (?,?,?,1)");
  groupA = Number(g.run("A", "a", now).lastInsertRowid);
  groupB = Number(g.run("B", "b", now).lastInsertRowid);
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,?,?,1)"
  );
  const tag = Date.now();
  owner = Number(u.run(`o${tag}`, "x", "مالک", "owner", null, 1, now).lastInsertRowid);
  mgrA = Number(u.run(`m${tag}`, "x", "مدیر", "group_manager", groupA, 1, now).lastInsertRowid);
  driverA = Number(u.run(`da${tag}`, "x", "رانندهٔ الف", "driver", groupA, 1, now).lastInsertRowid);
  driverB = Number(u.run(`db${tag}`, "x", "رانندهٔ ب", "driver", groupB, 1, now).lastInsertRowid);
  idle = Number(u.run(`di${tag}`, "x", "رانندهٔ بیکار", "driver", groupA, 1, now).lastInsertRowid);
  u.run(`dx${tag}`, "x", "رانندهٔ غیرفعال", "driver", groupA, 0, now);

  const cust = Number(
    db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('C1','x','active',?,?,1)")
      .run(now, groupA).lastInsertRowid
  );
  const product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  const packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
  const order = () =>
    createOrder(db, {
      customer_id: cust, order_date: "2026-09-01", created_by: owner, organization_id: 1,
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    }).id;

  const run = db.prepare(
    "INSERT INTO delivery_runs (driver_user_id,group_id,run_date,status,created_by,created_at,updated_at,organization_id) VALUES (?,?,?,'done',?,?,?,1)"
  );
  const stop = db.prepare(
    "INSERT INTO delivery_stops (run_id,order_id,sort_order,status,delivered_at,created_at) VALUES (?,?,?,?,?,?)"
  );
  const runA = Number(run.run(driverA, groupA, "2026-09-08", owner, now, now).lastInsertRowid);
  stop.run(runA, order(), 1, "delivered", "2026-09-08T09:00:00.000Z", now);
  stop.run(runA, order(), 2, "delivered", "2026-09-08T10:00:00.000Z", now);
  stop.run(runA, order(), 3, "refused", null, now);
  const runB = Number(run.run(driverB, groupB, "2026-09-09", owner, now, now).lastInsertRowid);
  stop.run(runB, order(), 1, "delivered", "2026-09-09T11:00:00.000Z", now);
  const old = Number(run.run(driverA, groupA, "2026-01-02", owner, now, now).lastInsertRowid);
  stop.run(old, order(), 1, "delivered", "2026-01-02T09:00:00.000Z", now);
});

describe("readDriverActivity", () => {
  it("a group manager sees only their group's drivers, idle ones included, inactive ones not", () => {
    const names = readDriverActivity(getDb(), sess(mgrA, "group_manager", groupA), TODAY).map((p) => p.id).sort();
    expect(names).toEqual([driverA, idle].sort());
  });

  it("an owner sees every group's drivers", () => {
    const ids = readDriverActivity(getDb(), sess(owner, "owner", null), TODAY).map((p) => p.id).sort();
    expect(ids).toEqual([driverA, driverB, idle].sort());
  });

  it("counts only delivered stops, inside the window, one date per stop", () => {
    const a = readDriverActivity(getDb(), sess(owner, "owner", null), TODAY).find((p) => p.id === driverA)!;
    expect(a.dates.sort()).toEqual(["2026-09-08", "2026-09-08"]);
  });

  it("an idle driver comes back with no dates rather than not at all", () => {
    const i = readDriverActivity(getDb(), sess(mgrA, "group_manager", groupA), TODAY).find((p) => p.id === idle)!;
    expect(i.dates).toEqual([]);
  });
});
