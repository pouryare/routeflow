import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-churn-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { scoreChurn, trainChurnFromLapses, materialiseChurnScores, churnBoard } = await import(
  "@/lib/repo/churn"
);

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

let owner = 0;
let product = 0;
let pkg = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM churn_scores; DELETE FROM churn_models WHERE organization_id IS NOT NULL; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  owner = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','م','owner',?,1)").run(now).lastInsertRowid);
  product = Number(db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('کره','K',0.25,?,?,1)").run(now, now).lastInsertRowid);
  pkg = Number(db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'ج',1,?)").run(product, now).lastInsertRowid);
});

function customer(code: string) {
  return Number(
    getDb()
      .prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES (?,?,'active',?,1)")
      .run(code, `مغازهٔ ${code}`, new Date().toISOString()).lastInsertRowid
  );
}
function order(customerId: number, daysAgo: number, packs = 5, status = "DELIVERED") {
  const db = getDb();
  const now = new Date().toISOString();
  const oid = Number(
    db.prepare(
      "INSERT INTO orders (order_no,customer_id,status,order_date,delivered_at,created_by,created_at,updated_at,organization_id) VALUES ('o'||abs(random()),?,?,?,?,?,?,?,1)"
    ).run(customerId, status, day(daysAgo), day(daysAgo), owner, now, now).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,created_at) VALUES (?,?,?,?,?,1000,700,1,0.25,?)"
  ).run(oid, product, pkg, packs, packs, now);
}

describe("churn repo", () => {
  it("a long-silent, indebted customer scores high; a steady buyer scores low", () => {
    const gone = customer("GONE");
    order(gone, 130);
    order(gone, 110);
    order(gone, 90); // last order 90 days ago, ~20d cadence, then nothing, unpaid
    const g = scoreChurn(1, gone);
    expect(g.band).toBe("high");
    expect(g.reason_fa).toContain("ریتم خرید");

    const steady = customer("STEADY");
    for (let d = 70; d >= 3; d -= 7) order(steady, d);
    // pay the steady buyer off so payment is not itself a churn signal
    const db = getDb();
    const pid = Number(
      db.prepare("INSERT INTO payments (organization_id,customer_id,amount_toman,method,received_at,received_by,created_at) VALUES (1,?,100000,'CASH',?,?,?)").run(steady, iso(2), owner, iso(2)).lastInsertRowid
    );
    for (const o of db.prepare("SELECT id FROM orders WHERE customer_id=?").all(steady) as { id: number }[]) {
      db.prepare("INSERT INTO payment_allocations (payment_id,order_id,amount_toman,created_at) VALUES (?,?,5000,?)").run(pid, o.id, iso(2));
    }
    const s = scoreChurn(1, steady);
    expect(s.band).not.toBe("high");
    expect(s.probability).toBeLessThan(scoreChurn(1, gone).probability);
  });

  it("trainChurnFromLapses is a no-op below the row threshold", () => {
    for (let i = 0; i < 5; i++) {
      const c = customer(`SMALL${i}`);
      order(c, 100);
      order(c, 80);
    }
    expect(trainChurnFromLapses(1)).toEqual({ trained: false, n_obs: 0 });
    expect(getDb().prepare("SELECT COUNT(*) n FROM churn_models WHERE organization_id=1").get()).toEqual({ n: 0 });
  });

  it("trainChurnFromLapses learns from a separable set of ≥ 12", () => {
    // lapsed: active before the 60-day cutoff, silent after
    for (let i = 0; i < 8; i++) {
      const c = customer(`LAPSE${i}`);
      order(c, 150);
      order(c, 120);
      order(c, 95); // last order ~95d ago → before the 60d cutoff, nothing since
    }
    // retained: ordering right up to now
    for (let i = 0; i < 6; i++) {
      const c = customer(`KEEP${i}`);
      for (let d = 120; d >= 5; d -= 12) order(c, d);
    }
    const res = trainChurnFromLapses(1);
    expect(res.trained).toBe(true);
    expect(res.n_obs).toBeGreaterThanOrEqual(12);
    const model = getDb().prepare("SELECT weights_json FROM churn_models WHERE organization_id=1").get() as { weights_json: string };
    expect(JSON.parse(model.weights_json).recency_ratio).toBeTypeOf("number");
  });

  it("materialiseChurnScores writes one row per ordering customer; churnBoard filters by band", () => {
    const a = customer("A");
    order(a, 90);
    order(a, 70);
    const b = customer("B");
    for (let d = 60; d >= 4; d -= 7) order(b, d);
    const n = materialiseChurnScores(1);
    expect(n).toBe(2);
    expect(getDb().prepare("SELECT COUNT(*) n FROM churn_scores WHERE organization_id=1").get()).toEqual({ n: 2 });
    const high = churnBoard(1, "high");
    expect(high.every((r) => r.band === "high")).toBe(true);
  });
});
