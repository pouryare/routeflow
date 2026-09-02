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
      dbPath = path.join(os.tmpdir(), `rf-spine-realcheck-${Date.now()}.db`);
      fs.copyFileSync(path.join(dir, newest), dbPath);
      temp = true;
    }
  } catch {
    /* none */
  }
}

process.env.COVERAGE_DB_PATH = dbPath || path.join(os.tmpdir(), `rf-spine-empty-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

describe.skipIf(!dbPath)("Phase 7 spine migration on real data", () => {
  it("adds the six tables + seeds five default rules, touching nothing else", () => {
    const db = getDb();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    for (const t of ["events", "tasks", "alerts", "rules", "rule_runs", "targets"]) {
      expect(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(t), t).toBeTruthy();
    }
    for (const t of ["events", "tasks", "alerts", "rule_runs", "targets"]) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(0);
    }
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM rules WHERE organization_id IS NULL").get() as { n: number }).n
    ).toBe(5);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM rules WHERE organization_id IS NOT NULL").get() as { n: number }).n
    ).toBe(0);

    if (temp) for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
  });
});
