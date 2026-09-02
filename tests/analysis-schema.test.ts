import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-analysis-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("analysis schema", () => {
  it("creates kpi_definitions and kpi_snapshots, both tenant-scoped", () => {
    const db = getDb();
    for (const t of ["kpi_definitions", "kpi_snapshots"]) {
      expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get(), t).toBeTruthy();
      expect((TENANT_TABLES as readonly string[]).includes(t), t).toBe(true);
    }
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='ix_kpi_snapshots_read'")
      .get();
    expect(idx).toBeTruthy();
  });

  it("seeds exactly fourteen NULL-org definitions, once, none tenant-owned", () => {
    const nullN = () =>
      (getDb().prepare("SELECT COUNT(*) n FROM kpi_definitions WHERE organization_id IS NULL").get() as { n: number }).n;
    const tenantN = () =>
      (getDb().prepare("SELECT COUNT(*) n FROM kpi_definitions WHERE organization_id IS NOT NULL").get() as { n: number }).n;
    expect(nullN()).toBe(14);
    expect(tenantN()).toBe(0);
    getDb();
    getDb();
    expect(nullN()).toBe(14);
    expect(
      (getDb()
        .prepare("SELECT direction FROM kpi_definitions WHERE organization_id IS NULL AND metric='overdue_receivables'")
        .get() as { direction: string }).direction
    ).toBe("down");
  });

  it("kpi_snapshots is unique per (org, metric, scope_type, scope_id, period)", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const ins = db.prepare(
      `INSERT INTO kpi_snapshots (organization_id, metric, scope_type, scope_id, period, value, computed_at)
       VALUES (1, 'net_sales', 'org', 0, '1405-06', ?, ?)`
    );
    expect(() => ins.run(1000, now)).not.toThrow();
    expect(() => ins.run(2000, now)).toThrow();
  });

  it("scope_id defaults to 0 when omitted", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO kpi_snapshots (organization_id, metric, scope_type, period, value, computed_at)
       VALUES (1, 'orders', 'org', '1405-07', 12, ?)`
    ).run(now);
    const row = db
      .prepare("SELECT scope_id FROM kpi_snapshots WHERE organization_id=1 AND metric='orders' AND period='1405-07'")
      .get() as { scope_id: number };
    expect(row.scope_id).toBe(0);
  });

  it("rejects an unknown scope_type and an unknown direction", () => {
    const db = getDb();
    const now = new Date().toISOString();
    expect(() =>
      db
        .prepare(
          `INSERT INTO kpi_snapshots (organization_id, metric, scope_type, period, value, computed_at)
           VALUES (1, 'orders', 'planet', '1405-08', 1, ?)`
        )
        .run(now)
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO kpi_definitions
             (organization_id, metric, title_fa, definition_fa, formula_fa, owner_role, frequency, action_fa, direction, updated_at)
           VALUES (1, 'x', 'x', 'x', 'x', 'owner', 'daily', 'x', 'sideways', ?)`
        )
        .run(now)
    ).toThrow();
  });
});
