import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { mapSeq } from "@/lib/seq";
const testDbPath = path.join(
  os.tmpdir(),
  `rf-rep-health-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { repHealth, repsOverview } = await import("@/lib/repo/repHealth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let custId = 0;
let repId = 0;
let owner = 0;
let products: number[] = [];

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM representative_onboarding_steps; DELETE FROM representative_profiles; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  owner = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','م','owner',?,1)").run(now)).lastInsertRowid);
  custId = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('R1','نمایندهٔ الف','WHOLESALE','active',?,1)").run(now)).lastInsertRowid);
  repId = Number((await db.prepare("INSERT INTO representative_profiles (organization_id,customer_id,rep_code,stage,credit_terms_days,created_at,updated_at) VALUES (1,?,'REP-1','active',0,?,?)").run(custId, now, now)).lastInsertRowid);
  products = await mapSeq([1, 2, 3, 4], async (i) =>
    Number((await db.prepare("INSERT INTO products (name,sku,active,created_at,updated_at,organization_id) VALUES (?,?,1,?,?,1)").run(`P${i}`, `S${i}${Date.now()}`, now, now)).lastInsertRowid));
});

async function order(daysAgo: number, prodIdxs: number[]) {
  const db = getDb();
  const now = new Date().toISOString();
  const d = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const oid = Number((await db.prepare("INSERT INTO orders (order_no,customer_id,status,order_date,created_by,created_at,updated_at,organization_id) VALUES ('o'||abs(random()),?,'DELIVERED',?,?,?,?,1)").run(custId, d, owner, now, now)).lastInsertRowid);
  const pkg = Number((await db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'ج',1,?)").run(products[prodIdxs[0]], now)).lastInsertRowid);
  for (const pi of prodIdxs) {
    await db.prepare("INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,created_at) VALUES (?,?,?,1,1,1000,0,1,0.25,?)").run(oid, products[pi], pkg, now);
  }
}

describe("repHealth", () => {
  it("scores onboarding, recency and coverage and bands the total", async () => {
    const db = getDb();
    for (const c of ["contract", "id_docs"]) {
      await db.prepare("INSERT INTO representative_onboarding_steps (representative_id,step_code,label_fa,completed_at) VALUES (?,?,?,?)").run(repId, c, c, new Date().toISOString());
    }
    await order(5, [0, 1]); // 2 of 4 products, 5 days ago

    const h = await repHealth(1, repId);
    expect(h.factors).toEqual({ onboarding: 100, recency: 100, coverage: 50 });
    expect(h.score).toBe(Math.round(100 * 0.3 + 100 * 0.4 + 50 * 0.3)); // 85
    expect(h.band).toBe("good");
  });

  it("recency is 0 with no orders", async () => {
    const h = await repHealth(1, repId);
    expect(h.factors.recency).toBe(0);
    expect(h.last_order_date).toBeNull();
  });

  it("repsOverview returns one row per rep with code and name", async () => {
    const rows = await repsOverview(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rep_code: "REP-1", business_name: "نمایندهٔ الف", stage: "active" });
  });
});
