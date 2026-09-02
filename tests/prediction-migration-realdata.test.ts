import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const provided = process.env.ROUTEFLOW_MIGRATION_CHECK_DB;
let dbPath = provided ?? "";
let temp = false;
if (!provided) {
  const dir = path.join(process.cwd(), "data", "backups");
  try {
    const newest = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".db"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0]?.f;
    if (newest) {
      dbPath = path.join(os.tmpdir(), `rf-prediction-realcheck-${Date.now()}.db`);
      fs.copyFileSync(path.join(dir, newest), dbPath);
      temp = true;
    }
  } catch {
    /* none */
  }
}

process.env.COVERAGE_DB_PATH = dbPath || path.join(os.tmpdir(), `rf-prediction-empty-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { refreshPredictions } = await import("@/lib/repo/predictionRefresh");

describe.skipIf(!dbPath)("Phase 10 prediction migration on real data", () => {
  it("adds the five tables + the learned_* columns + seeds, then a sweep runs clean", () => {
    const db = getDb();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    for (const t of ["seasonal_factors", "forecast_models", "forecasts", "churn_models", "churn_scores"]) {
      expect(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(t), t).toBeTruthy();
    }
    const cfCols = (db.prepare("PRAGMA table_info(capacity_factors)").all() as { name: string }[]).map((c) => c.name);
    for (const c of ["learned_stop_factor", "learned_speed_factor", "learned_n"]) expect(cfCols, c).toContain(c);

    for (const t of ["forecasts", "forecast_models", "churn_scores"]) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(0);
    }
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM seasonal_factors WHERE organization_id IS NULL").get() as { n: number }).n
    ).toBe(19);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM seasonal_factors WHERE organization_id IS NOT NULL").get() as { n: number }).n
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM churn_models WHERE organization_id IS NULL").get() as { n: number }).n
    ).toBe(1);

    const res = refreshPredictions(1);
    expect(res.forecasts).toBeGreaterThanOrEqual(0);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    if (temp) for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
  });
});
