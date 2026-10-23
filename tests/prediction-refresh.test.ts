import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-predrefresh-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { refreshPredictions } = await import("@/lib/repo/predictionRefresh");
const { shiftPeriod, currentPeriod, periodRange } = await import("@/lib/analysis/period");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("refreshPredictions", () => {
  it("runs the whole sweep on a seeded org and returns counts", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const owner = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','م','owner',?,1)").run(now)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C','م','active',?,1)").run(now)).lastInsertRowid);
    const product = Number((await db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('کره','K',0.25,?,?,1)").run(now, now)).lastInsertRowid);
    const pkg = Number((await db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'ج',1,?)").run(product, now)).lastInsertRowid);

    const CUR = currentPeriod(now);
    for (let m = 5; m >= 2; m--) {
      const day = periodRange(shiftPeriod(CUR, m)).from;
      const oid = Number(
        (await db.prepare(
          "INSERT INTO orders (order_no,customer_id,status,order_date,created_by,created_at,updated_at,organization_id) VALUES ('o'||abs(random()),?,'DELIVERED',?,?,?,?,1)"
        ).run(cust, day, owner, now, now)).lastInsertRowid
      );
      await db.prepare(
        "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,created_at) VALUES (?,?,?,20,20,1000,700,1,0.25,?)"
      ).run(oid, product, pkg, now);
    }

    const res = await refreshPredictions(1, now);
    expect(res.forecasts).toBeGreaterThan(0);
    expect(res.churn).toBeGreaterThan(0);
    expect(res.capacity).toBe(0); // no completed runs seeded
    expect((await db.prepare("SELECT COUNT(*) n FROM forecasts").get() as { n: number }).n).toBeGreaterThan(0);
    expect((await db.prepare("SELECT COUNT(*) n FROM churn_scores").get() as { n: number }).n).toBe(1);
  });
});
