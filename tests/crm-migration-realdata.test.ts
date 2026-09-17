import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const provided = process.env.ROUTEFLOW_MIGRATION_CHECK_DB;
let dbPath = provided ?? "";
if (!provided) {
  const dir = path.join(process.cwd(), "data", "backups");
  try {
    const newest = fs.readdirSync(dir).filter((f) => f.endsWith(".db"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
    if (newest) {
      dbPath = path.join(os.tmpdir(), `rf-crm-realcheck-${Date.now()}.db`);
      fs.copyFileSync(path.join(dir, newest), dbPath);
    }
  } catch { /* none */ }
}

// Snapshot before the migration runs.
let before: { customers: number; lifecycles: string } | null = null;
if (dbPath) {
  const raw = new DatabaseSync(dbPath);
  before = {
    customers: (raw.prepare("SELECT COUNT(*) n FROM customers").get() as { n: number }).n,
    lifecycles: JSON.stringify(raw.prepare("SELECT lifecycle, COUNT(*) n FROM customers GROUP BY 1 ORDER BY 1").all()),
  };
  raw.close();
}

process.env.ROUTEFLOW_DB_PATH = dbPath || path.join(os.tmpdir(), `rf-crm-empty-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { replayCrmState } = await import("@/lib/crm/replay");
const { ACTIVITY_FACT_COLUMNS } = await import("@/lib/repo/crm/migrate");

describe.skipIf(!dbPath)("CRM migration on real data", () => {
  it("is lossless and leaves every business's state equal to its replay", () => {
    const db = getDb();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect((db.prepare("SELECT COUNT(*) n FROM customers").get() as { n: number }).n).toBe(before!.customers);
    expect(JSON.stringify(db.prepare("SELECT lifecycle, COUNT(*) n FROM customers GROUP BY 1 ORDER BY 1").all())).toBe(before!.lifecycles);

    const rows = db.prepare("SELECT id, contact_status, sales_stage, verification, temperature, attempt_count FROM customers").all() as Record<string, unknown>[];
    for (const r of rows) {
      const acts = db.prepare(`SELECT ${ACTIVITY_FACT_COLUMNS} FROM activities WHERE customer_id = ? ORDER BY occurred_at, id`).all(r.id as number) as never[];
      expect(acts.length, `customer ${r.id}`).toBeGreaterThan(0);
      const s = replayCrmState(acts);
      expect({ contact_status: r.contact_status, sales_stage: r.sales_stage, verification: r.verification, temperature: r.temperature, attempt_count: r.attempt_count })
        .toEqual({ contact_status: s.contact_status, sales_stage: s.sales_stage, verification: s.verification, temperature: s.temperature, attempt_count: s.attempt_count });
    }
  });
});
