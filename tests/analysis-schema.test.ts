import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { indexExists } from "./helpers/schema";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-analysis-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES, dbReady } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("analysis schema", () => {
  it("creates kpi_definitions and kpi_snapshots, both tenant-scoped", async () => {
    const db = getDb();
    for (const t of ["kpi_definitions", "kpi_snapshots"]) {
      expect(await db.prepare(`SELECT COUNT(*) n FROM ${t}`).get(), t).toBeTruthy();
      expect((TENANT_TABLES as readonly string[]).includes(t), t).toBe(true);
    }
    expect(await indexExists("ix_kpi_snapshots_read")).toBe(true);
  });

  it("seeds exactly fourteen NULL-org definitions, once, none tenant-owned", async () => {
    const nullN = async () =>
      (await getDb().prepare("SELECT COUNT(*) n FROM kpi_definitions WHERE organization_id IS NULL").get() as { n: number }).n;
    const tenantN = async () =>
      (await getDb().prepare("SELECT COUNT(*) n FROM kpi_definitions WHERE organization_id IS NOT NULL").get() as { n: number }).n;
    expect(await nullN()).toBe(14);
    expect(await tenantN()).toBe(0);
    await dbReady();
    await dbReady();
    expect(await nullN()).toBe(14);
    expect(
      (await getDb()
        .prepare("SELECT direction FROM kpi_definitions WHERE organization_id IS NULL AND metric='overdue_receivables'")
        .get() as { direction: string }).direction
    ).toBe("down");
  });

  it("kpi_snapshots is unique per (org, metric, scope_type, scope_id, period)", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const ins = db.prepare(
      `INSERT INTO kpi_snapshots (organization_id, metric, scope_type, scope_id, period, value, computed_at)
       VALUES (1, 'net_sales', 'org', 0, '1405-06', ?, ?)`
    );
    await (async () => await ins.run(1000, now))();
    await expect((async () => await ins.run(2000, now))()).rejects.toThrow();
  });

  it("scope_id defaults to 0 when omitted", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO kpi_snapshots (organization_id, metric, scope_type, period, value, computed_at)
       VALUES (1, 'orders', 'org', '1405-07', 12, ?)`
    ).run(now);
    const row = await db
      .prepare("SELECT scope_id FROM kpi_snapshots WHERE organization_id=1 AND metric='orders' AND period='1405-07'")
      .get() as { scope_id: number };
    expect(row.scope_id).toBe(0);
  });

  it("rejects an unknown scope_type and an unknown direction", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await expect((async () =>
      await db
        .prepare(
          `INSERT INTO kpi_snapshots (organization_id, metric, scope_type, period, value, computed_at)
           VALUES (1, 'orders', 'planet', '1405-08', 1, ?)`
        )
        .run(now))()).rejects.toThrow();
    await expect((async () =>
      await db
        .prepare(
          `INSERT INTO kpi_definitions
             (organization_id, metric, title_fa, definition_fa, formula_fa, owner_role, frequency, action_fa, direction, updated_at)
           VALUES (1, 'x', 'x', 'x', 'x', 'owner', 'daily', 'x', 'sideways', ?)`
        )
        .run(now))()).rejects.toThrow();
  });
});
