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
      dbPath = path.join(os.tmpdir(), `rf-analysis-realcheck-${Date.now()}.db`);
      fs.copyFileSync(path.join(dir, newest), dbPath);
      temp = true;
    }
  } catch {
    /* none */
  }
}

process.env.COVERAGE_DB_PATH = dbPath || path.join(os.tmpdir(), `rf-analysis-empty-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { refreshAll } = await import("@/lib/repo/analysisRefresh");
const { snapshot } = await import("@/lib/repo/kpiSnapshots");

describe.skipIf(!dbPath)("Phase 9 analysis migration on real data", () => {
  it("adds the two tables + seeds 14 definitions, then a sweep runs clean", () => {
    const db = getDb();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    for (const t of ["kpi_definitions", "kpi_snapshots"]) {
      expect(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(t), t).toBeTruthy();
    }
    expect((db.prepare("SELECT COUNT(*) AS n FROM kpi_snapshots").get() as { n: number }).n).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM kpi_definitions WHERE organization_id IS NULL").get() as { n: number }).n
    ).toBe(14);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM kpi_definitions WHERE organization_id IS NOT NULL").get() as { n: number }).n
    ).toBe(0);

    // the sweep must run against real rows without throwing and write an org net_sales
    const res = refreshAll(1);
    expect(res.written).toBeGreaterThan(0);
    const ns = snapshot(1, "net_sales", { scope_type: "org", period: res.period });
    expect(ns).not.toBeNull();
    expect(ns as number).toBeGreaterThanOrEqual(0);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    if (temp) for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
  });
});
