import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-forecast-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const {
  monthlyHistory,
  updateForecastModel,
  forecastDemand,
  materialiseForecasts,
  demandBoard,
  avgDailySalesFor,
} = await import("@/lib/repo/forecast");
const { currentPeriod, shiftPeriod, periodRange } = await import("@/lib/analysis/period");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const NOW = new Date().toISOString();
const CUR = currentPeriod(NOW);

let owner = 0;
let cust = 0;
let butter = 0;
let cheese = 0;
let pkgB = 0;
let pkgC = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM forecasts; DELETE FROM forecast_models; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  owner = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','م','owner',?,1)").run(now).lastInsertRowid);
  cust = Number(db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C','م','active',?,1)").run(now).lastInsertRowid);
  butter = Number(db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('کره','KR',0.25,?,?,1)").run(now, now).lastInsertRowid);
  cheese = Number(db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('پنیر','PN',0.5,?,?,1)").run(now, now).lastInsertRowid);
  pkgB = Number(db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'ج',1,?)").run(butter, now).lastInsertRowid);
  pkgC = Number(db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'ج',1,?)").run(cheese, now).lastInsertRowid);
});

/** one delivered order for `productId` in the Jalali month `monthsAgo` back. */
function orderInMonth(productId: number, pkg: number, monthsAgo: number, packs: number) {
  const db = getDb();
  const now = new Date().toISOString();
  const day = periodRange(shiftPeriod(CUR, monthsAgo)).from; // first day of that Jalali month
  const oid = Number(
    db.prepare(
      "INSERT INTO orders (order_no,customer_id,status,order_date,created_by,created_at,updated_at,organization_id) VALUES ('o'||abs(random()),?,'DELIVERED',?,?,?,?,1)"
    ).run(cust, day, owner, now, now).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,created_at) VALUES (?,?,?,?,?,1000,700,1,0.25,?)"
  ).run(oid, productId, pkg, packs, packs, now);
}

describe("forecast repo", () => {
  it("monthlyHistory returns closed months oldest-first, excluding the open month", () => {
    for (let m = 11; m >= 2; m--) orderInMonth(butter, pkgB, m, 10);
    orderInMonth(butter, pkgB, 0, 999); // the current, open month — must be excluded
    const h = monthlyHistory(1, { type: "product", id: butter }, "demand_base_units", NOW);
    expect(h.length).toBe(10);
    expect(h[0].period < h[h.length - 1].period).toBe(true);
    expect(h.some((p) => p.value === 999)).toBe(false);
  });

  it("a rising series → Holt, mae set, forecast above the last actual", () => {
    for (let m = 11; m >= 2; m--) orderInMonth(butter, pkgB, m, 10 + (11 - m) * 3);
    const model = updateForecastModel(1, { type: "product", id: butter }, "demand_base_units", NOW);
    expect(model.n_obs).toBe(10);
    expect(model.method).toBe("holt");
    expect(model.mae).toBeGreaterThan(0);

    const fc = forecastDemand(1, { type: "product", id: butter }, "demand_base_units", 3, NOW);
    expect(fc).toHaveLength(3);
    const lastActual = 10 + (11 - 2) * 3; // 37
    expect(fc[0].yhat).toBeGreaterThan(lastActual * 0.8);
    for (const p of fc) {
      expect(p.yhat_lo).toBeLessThanOrEqual(p.yhat);
      expect(p.yhat).toBeLessThanOrEqual(p.yhat_hi);
      expect(p.yhat_lo).toBeGreaterThanOrEqual(0);
    }
  });

  it("a two-month history stays on seasonal_naive but still produces rows", () => {
    orderInMonth(cheese, pkgC, 3, 20);
    orderInMonth(cheese, pkgC, 2, 24);
    const model = updateForecastModel(1, { type: "product", id: cheese }, "demand_base_units", NOW);
    expect(model.method).toBe("seasonal_naive");
    const fc = forecastDemand(1, { type: "product", id: cheese }, "demand_base_units", 3, NOW);
    expect(fc).toHaveLength(3);
    expect(fc[0].yhat).toBeGreaterThan(0);
  });

  it("materialiseForecasts writes an org row and does not duplicate", () => {
    for (let m = 6; m >= 2; m--) orderInMonth(butter, pkgB, m, 15);
    materialiseForecasts(1, NOW);
    materialiseForecasts(1, NOW);
    const n = (getDb().prepare("SELECT COUNT(*) n FROM forecasts WHERE entity_type='org' AND metric='demand_toman'").get() as { n: number }).n;
    expect(n).toBe(3); // 3 horizons, upserted
    const board = demandBoard(1);
    expect(board.some((e) => e.entity_type === "org")).toBe(true);
  });

  it("avgDailySalesFor is positive for a forecasted product", () => {
    for (let m = 6; m >= 2; m--) orderInMonth(butter, pkgB, m, 30);
    materialiseForecasts(1, NOW);
    expect(avgDailySalesFor(1, butter)).toBeGreaterThan(0);
  });
});
