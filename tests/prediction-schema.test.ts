import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-prediction-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("prediction schema", () => {
  it("creates the five tables, all tenant-scoped", () => {
    const db = getDb();
    for (const t of ["seasonal_factors", "forecast_models", "forecasts", "churn_models", "churn_scores"]) {
      expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get(), t).toBeTruthy();
      expect((TENANT_TABLES as readonly string[]).includes(t), t).toBe(true);
    }
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='ix_forecasts_read'").get()
    ).toBeTruthy();
  });

  it("adds the five learned_* columns to capacity_factors", () => {
    const cols = (getDb().prepare("PRAGMA table_info(capacity_factors)").all() as { name: string }[]).map(
      (c) => c.name
    );
    for (const c of [
      "learned_stop_factor",
      "learned_speed_factor",
      "learned_service_time_factor",
      "learned_max_duration_factor",
      "learned_n",
    ]) {
      expect(cols, c).toContain(c);
    }
    const learnedN = (
      getDb().prepare("SELECT learned_n FROM capacity_factors WHERE organization_id IS NULL LIMIT 1").get() as
        | { learned_n: number }
        | undefined
    )?.learned_n;
    expect(learnedN).toBe(0);
  });

  it("seeds 19 NULL-org seasonal_factors and one NULL-org churn_models, once", () => {
    const sf = () =>
      (getDb().prepare("SELECT COUNT(*) n FROM seasonal_factors WHERE organization_id IS NULL").get() as { n: number }).n;
    const cm = () =>
      (getDb().prepare("SELECT COUNT(*) n FROM churn_models WHERE organization_id IS NULL").get() as { n: number }).n;
    expect(sf()).toBe(19);
    expect(cm()).toBe(1);
    getDb();
    getDb();
    expect(sf()).toBe(19);
    expect(cm()).toBe(1);
    expect(
      (getDb().prepare("SELECT COUNT(*) n FROM seasonal_factors WHERE organization_id IS NOT NULL").get() as { n: number }).n
    ).toBe(0);
  });

  it("forecasts is unique per (org, entity_type, entity_id, metric, target_period)", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const ins = db.prepare(
      `INSERT INTO forecasts (organization_id, entity_type, entity_id, metric, target_period, horizon, yhat, yhat_lo, yhat_hi, method, computed_at)
       VALUES (1, 'org', 0, 'demand_toman', '1405-07', 1, ?, 0, ?, 'holt', ?)`
    );
    expect(() => ins.run(100, 200, now)).not.toThrow();
    expect(() => ins.run(101, 201, now)).toThrow();
  });

  it("rejects a bad kind / band / entity_type / metric", () => {
    const db = getDb();
    const now = new Date().toISOString();
    expect(() =>
      db.prepare("INSERT INTO seasonal_factors (organization_id, kind, idx, factor, updated_at) VALUES (1,'week',1,1,?)").run(now)
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO churn_scores (organization_id, customer_id, probability, band, computed_at) VALUES (1,1,0.5,'meh',?)"
        )
        .run(now)
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO forecast_models (organization_id, entity_type, metric, updated_at) VALUES (1,'planet','demand_toman',?)"
        )
        .run(now)
    ).toThrow();
  });
});
