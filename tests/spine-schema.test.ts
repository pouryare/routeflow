import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-spine-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES, dbReady } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("spine schema", () => {
  it("creates the six tables and lists them tenant-scoped", async () => {
    const db = getDb();
    for (const t of ["events", "tasks", "alerts", "rules", "rule_runs", "targets"]) {
      expect(await db.prepare(`SELECT COUNT(*) n FROM ${t}`).get(), t).toBeTruthy();
      expect((TENANT_TABLES as readonly string[]).includes(t), t).toBe(true);
    }
  });

  it("seeds the default rules with a NULL organisation, idempotently", async () => {
    // 5 original spine rules + 8 Phase 1 `notify` rules + 5 Phase 2 `notify` rules
    // (RULE_SEED in lib/db.ts).
    const EXPECTED_DEFAULT_RULES = 18;
    const rows = await getDb()
      .prepare("SELECT code FROM rules WHERE organization_id IS NULL")
      .all() as { code: string }[];
    expect(rows).toHaveLength(EXPECTED_DEFAULT_RULES);
    expect(rows.map((r) => r.code)).toContain("delivery_failed_retry");
    expect(rows.map((r) => r.code)).toContain("notify_task_assigned");
    await dbReady();
    await dbReady();
    expect(
      (await getDb().prepare("SELECT COUNT(*) n FROM rules WHERE organization_id IS NULL").get() as { n: number }).n
    ).toBe(EXPECTED_DEFAULT_RULES);
  });

  it("rejects junk in the CHECKed columns", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await expect((async () =>
      await db.prepare("INSERT INTO tasks (organization_id,kind,title,priority,created_at) VALUES (1,'x','y','WHENEVER',?)").run(now))()).rejects.toThrow();
    await expect((async () =>
      await db.prepare("INSERT INTO tasks (organization_id,kind,title,status,created_at) VALUES (1,'x','y','maybe',?)").run(now))()).rejects.toThrow();
    await expect((async () =>
      await db.prepare("INSERT INTO alerts (organization_id,severity,category,title,created_at) VALUES (1,'meh','x','y',?)").run(now))()).rejects.toThrow();
    await expect((async () =>
      await db.prepare("INSERT INTO targets (organization_id,period,metric,target_value,created_at) VALUES (1,'1405-01','vibes',10,?)").run(now))()).rejects.toThrow();
  });

  it("targets are unique per (org, user, group, period, metric) when both keys are set", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const uid = Number(
      (await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('tgt','x','م','phone_sales',?,1)").run(now)).lastInsertRowid
    );
    const gid = Number(
      (await db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('گ','g',?,1)").run(now)).lastInsertRowid
    );
    const ins = db.prepare(
      "INSERT INTO targets (organization_id,user_id,group_id,period,metric,target_value,created_at) VALUES (1,?,?,'1405-02','kg',?,?)"
    );
    await (async () => await ins.run(uid, gid, 100, now))();
    await expect((async () => await ins.run(uid, gid, 200, now))()).rejects.toThrow();
    // NB: with a NULL user_id or group_id the UNIQUE does not bite (SQLite NULL != NULL);
    // setTarget enforces the single-row-per-scope invariant in code.
  });
});
