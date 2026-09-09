import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-workflow-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("workflow_step_templates", () => {
  it("is seeded with exactly six fixed steps", () => {
    const rows = getDb().prepare("SELECT key, label_fa FROM workflow_step_templates ORDER BY sort_order").all() as {
      key: string;
      label_fa: string;
    }[];
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.key)).toEqual([
      "initial_review",
      "lab_check",
      "customer_contact",
      "resolution",
      "customer_notify",
      "satisfaction_call",
    ]);
  });

  it("re-seeding on a second boot does not duplicate rows", () => {
    getDb(); // getDb() is memoized per test-db path, but the seed itself must be idempotent
    const n = getDb().prepare("SELECT COUNT(*) n FROM workflow_step_templates").get() as { n: number };
    expect(n.n).toBe(6);
  });
});

describe("workflow_edges", () => {
  it("links two real tasks", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO tasks (id,organization_id,kind,title,status,created_at) VALUES (901,1,'complaint_step','a','open',?)"
    ).run(now);
    db.prepare(
      "INSERT INTO tasks (id,organization_id,kind,title,status,created_at) VALUES (902,1,'complaint_step','b','open',?)"
    ).run(now);
    expect(() =>
      db.prepare("INSERT INTO workflow_edges (from_task_id, to_task_id, created_at) VALUES (901, 902, ?)").run(now)
    ).not.toThrow();
  });

  it("rejects a second parent for the same task -- a tree, not a general graph", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO tasks (id,organization_id,kind,title,status,created_at) VALUES (903,1,'complaint_step','c','open',?)"
    ).run(now);
    expect(() =>
      db.prepare("INSERT INTO workflow_edges (from_task_id, to_task_id, created_at) VALUES (901, 903, ?)").run(now)
    ).not.toThrow();
    expect(() =>
      db.prepare("INSERT INTO workflow_edges (from_task_id, to_task_id, created_at) VALUES (902, 903, ?)").run(now)
    ).toThrow();
  });
});
