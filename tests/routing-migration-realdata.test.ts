import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

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
      dbPath = path.join(os.tmpdir(), `rf-routing-realcheck-${Date.now()}.db`);
      fs.copyFileSync(path.join(dir, newest), dbPath);
      temp = true;
    }
  } catch {
    /* none */
  }
}

let runsBefore = 0;
if (dbPath) {
  const raw = new DatabaseSync(dbPath);
  const exists = raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='delivery_runs'").get();
  if (exists) runsBefore = (raw.prepare("SELECT COUNT(*) AS n FROM delivery_runs").get() as { n: number }).n;
  raw.close();
}

process.env.COVERAGE_DB_PATH = dbPath || path.join(os.tmpdir(), `rf-routing-empty-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

describe.skipIf(!dbPath)("Phase 5 routing migration on real data", () => {
  it("adds the planning columns + 'ready' status without losing a delivery_runs row", () => {
    const db = getDb();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const cols = (db.prepare("PRAGMA table_info(delivery_runs)").all() as { name: string }[]).map((c) => c.name);
    for (const c of ["vehicle_id", "route_template_id", "optimisation_json", "frozen_at", "capacity_stops"]) {
      expect(cols, c).toContain(c);
    }
    const dr = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='delivery_runs'").get() as { sql: string };
    expect(dr.sql).toContain("'ready'");

    expect((db.prepare("SELECT COUNT(*) AS n FROM delivery_runs").get() as { n: number }).n).toBe(runsBefore);
    for (const t of ["vehicles", "route_templates", "route_schedules"]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    }

    if (temp) for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
  });
});
