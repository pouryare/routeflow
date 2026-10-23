import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-targets-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { setTarget, listTargets, targetProgress } = await import("@/lib/repo/targets");
const { toJalali } = await import("@/lib/jalali");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let seller = 0;
let custId = 0;
let product = 0;
let pkg = 0;

// a Gregorian date and its Jalali YYYY-MM
const DATE = "2026-03-10";
const j = toJalali(DATE + "T00:00:00.000Z")!;
const PERIOD = `${j.jy}-${String(j.jm).padStart(2, "0")}`;

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM targets; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  seller = Number(
    (await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('s','x','ف','phone_sales',?,1)").run(now)).lastInsertRowid
  );
  custId = Number(
    (await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C','x','active',?,1)").run(now)).lastInsertRowid
  );
  product = Number(
    (await db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('کره','S',0.25,?,?,1)").run(now, now)).lastInsertRowid
  );
  pkg = Number(
    (await db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'جعبه',1,?)").run(product, now)).lastInsertRowid
  );
});

async function deliveredOrder(revenue: number) {
  const db = getDb();
  const now = new Date().toISOString();
  const oid = Number(
    (await db.prepare("INSERT INTO orders (order_no,customer_id,salesperson_user_id,status,order_date,created_by,created_at,updated_at,organization_id) VALUES ('o'||abs(random()),?,?,'DELIVERED',?,?,?,?,1)").run(custId, seller, DATE, seller, now, now)).lastInsertRowid
  );
  await db.prepare(
    "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,created_at) VALUES (?,?,?,1,1,?,0,1,0.25,?)"
  ).run(oid, product, pkg, revenue, now);
}

describe("targets repo", () => {
  it("setTarget upserts -- one row per scope", async () => {
    await setTarget(1, { user_id: seller, period: PERIOD, metric: "revenue_toman", target_value: 100_000 });
    await setTarget(1, { user_id: seller, period: PERIOD, metric: "revenue_toman", target_value: 150_000 });
    const rows = await listTargets(1, PERIOD);
    expect(rows).toHaveLength(1);
    expect(rows[0].target_value).toBe(150_000);
  });

  it("targetProgress compares delivered revenue against the target", async () => {
    await setTarget(1, { user_id: seller, period: PERIOD, metric: "revenue_toman", target_value: 100_000 });
    await deliveredOrder(20_000);
    await deliveredOrder(10_000);
    const p = await targetProgress(1, { user_id: seller, period: PERIOD, metric: "revenue_toman" });
    expect(p).toEqual({ target: 100_000, actual: 30_000, fraction: 0.3 });
  });

  it("actual is 0 for a period with nothing delivered", async () => {
    await setTarget(1, { user_id: seller, period: "1300-01", metric: "kg", target_value: 50 });
    expect(await targetProgress(1, { user_id: seller, period: "1300-01", metric: "kg" })).toEqual({
      target: 50,
      actual: 0,
      fraction: 0,
    });
  });
});
