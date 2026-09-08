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
      dbPath = path.join(os.tmpdir(), `rf-offline-realcheck-${Date.now()}.db`);
      fs.copyFileSync(path.join(dir, newest), dbPath);
      temp = true;
    }
  } catch {
    /* no backups dir */
  }
}

const before: Record<string, number> = {};
if (dbPath) {
  const raw = new DatabaseSync(dbPath);
  for (const t of ["orders", "payments", "customers"]) {
    // A pre-Phase-1 backup has no `payments` table yet -- only snapshot what exists.
    const exists = raw
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
      .get(t);
    if (exists) {
      before[t] = (raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    }
  }
  raw.close();
}

process.env.ROUTEFLOW_DB_PATH = dbPath || path.join(os.tmpdir(), `rf-offline-empty-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

describe.skipIf(!dbPath)("Phase 4 offline-first migration on real data", () => {
  it("adds client_uuid + sync tables without touching a single row", () => {
    const db = getDb();

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    for (const t of ["orders", "payments", "deliveries", "customers"]) {
      const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
      expect(cols, t).toContain("client_uuid");
      const nulls = (
        db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE client_uuid IS NOT NULL`).get() as { n: number }
      ).n;
      expect(nulls, `${t} has non-null client_uuid on a legacy row`).toBe(0);
      const idx = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name = ?")
        .get(`ix_${t}_client_uuid`) as { sql: string } | undefined;
      expect(idx?.sql ?? "", t).toContain("WHERE client_uuid IS NOT NULL");
    }

    for (const t of ["sync_mutations", "deleted_rows"]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    }

    for (const [t, n] of Object.entries(before)) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(n);
    }

    if (temp) for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
  });
});
