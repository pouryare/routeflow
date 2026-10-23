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
  ({ user: { id } as never, role: role as never, groupId: gid, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;

const TODAY = "2026-09-10";
let owner = 0, mgrA = 0, driverA = 0, driverB = 0, idle = 0, groupA = 0, groupB = 0;

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM groups; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES (?,?,?,1)");
  groupA = Number((await g.run("A", "a", now)).lastInsertRowid);
  groupB = Number((await g.run("B", "b", now)).lastInsertRowid);
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,?,?,1)"
  );
  const tag = Date.now();
  owner = Number((await u.run(`o${tag}`, "x", "مالک", "owner", null, 1, now)).lastInsertRowid);
  mgrA = Number((await u.run(`m${tag}`, "x", "مدیر", "group_manager", groupA, 1, now)).lastInsertRowid);
  driverA = Number((await u.run(`da${tag}`, "x", "رانندهٔ الف", "delivery_driver", groupA, 1, now)).lastInsertRowid);
  driverB = Number((await u.run(`db${tag}`, "x", "رانندهٔ ب", "delivery_driver", groupB, 1, now)).lastInsertRowid);
  idle = Number((await u.run(`di${tag}`, "x", "رانندهٔ بیکار", "delivery_driver", groupA, 1, now)).lastInsertRowid);
  await u.run(`dx${tag}`, "x", "رانندهٔ غیرفعال", "delivery_driver", groupA, 0, now);

  const cust = Number(
    (await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('C1','x','active',?,?,1)")
      .run(now, groupA)).lastInsertRowid
  );
  const product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  const packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  await setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
  const order = async () =>
    (await createOrder(db, {
      customer_id: cust, order_date: "2026-09-01", created_by: owner, organization_id: 1,
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    })).id;

  const run = db.prepare(
    "INSERT INTO delivery_runs (driver_user_id,group_id,run_date,status,created_by,created_at,updated_at,organization_id) VALUES (?,?,?,'done',?,?,?,1)"
  );
  const stop = db.prepare(
    "INSERT INTO delivery_stops (run_id,order_id,sort_order,status,delivered_at,created_at) VALUES (?,?,?,?,?,?)"
  );
  const runA = Number((await run.run(driverA, groupA, "2026-09-08", owner, now, now)).lastInsertRowid);
  await stop.run(runA, await order(), 1, "delivered", "2026-09-08T09:00:00.000Z", now);
  await stop.run(runA, await order(), 2, "delivered", "2026-09-08T10:00:00.000Z", now);
  await stop.run(runA, await order(), 3, "refused", null, now);
  const runB = Number((await run.run(driverB, groupB, "2026-09-09", owner, now, now)).lastInsertRowid);
  await stop.run(runB, await order(), 1, "delivered", "2026-09-09T11:00:00.000Z", now);
  const old = Number((await run.run(driverA, groupA, "2026-01-02", owner, now, now)).lastInsertRowid);
  await stop.run(old, await order(), 1, "delivered", "2026-01-02T09:00:00.000Z", now);
});

describe("readDriverActivity", () => {
  it("a group manager sees only their group's drivers, idle ones included, inactive ones not", async () => {
    const names = (await readDriverActivity(getDb(), sess(mgrA, "group_manager", groupA), TODAY)).map((p) => p.id).sort();
    expect(names).toEqual([driverA, idle].sort());
  });

  it("an owner sees every group's drivers", async () => {
    const ids = (await readDriverActivity(getDb(), sess(owner, "owner", null), TODAY)).map((p) => p.id).sort();
    expect(ids).toEqual([driverA, driverB, idle].sort());
  });

  it("counts only delivered stops, inside the window, one date per stop", async () => {
    const a = (await readDriverActivity(getDb(), sess(owner, "owner", null), TODAY)).find((p) => p.id === driverA)!;
    expect(a.dates.sort()).toEqual(["2026-09-08", "2026-09-08"]);
  });

  it("an idle driver comes back with no dates rather than not at all", async () => {
    const i = (await readDriverActivity(getDb(), sess(mgrA, "group_manager", groupA), TODAY)).find((p) => p.id === idle)!;
    expect(i.dates).toEqual([]);
  });
});
