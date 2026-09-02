import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-board-pocket-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES, backfillReminderTasks } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("board & pocket schema", () => {
  it("tasks has a nullable stage column", () => {
    const cols = getDb().prepare("PRAGMA table_info(tasks)").all() as { name: string; notnull: number }[];
    const stage = cols.find((c) => c.name === "stage");
    expect(stage).toBeTruthy();
    expect(stage!.notnull).toBe(0);
  });

  it("users has a nullable prefs_json column", () => {
    const cols = getDb().prepare("PRAGMA table_info(users)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "prefs_json")).toBe(true);
  });

  it("task_recurrences exists with the expected columns and a priority CHECK", () => {
    const cols = (getDb().prepare("PRAGMA table_info(task_recurrences)").all() as { name: string }[]).map(
      (c) => c.name
    );
    for (const n of [
      "organization_id",
      "title",
      "kind",
      "assignee_user_id",
      "role_hint",
      "group_id",
      "entity_type",
      "entity_id",
      "priority",
      "rrule",
      "active",
      "last_spawned_on",
      "created_by",
      "created_at",
      "updated_at",
    ]) {
      expect(cols, n).toContain(n);
    }
    const sql = (
      getDb().prepare("SELECT sql FROM sqlite_master WHERE name = 'task_recurrences'").get() as { sql: string }
    ).sql;
    expect(sql).toMatch(/priority[^)]*CHECK/i);
  });

  it("task_recurrences is registered as a tenant table", () => {
    expect((TENANT_TABLES as readonly string[]).includes("task_recurrences")).toBe(true);
  });

  it("rejects a bad priority on task_recurrences", () => {
    const db = getDb();
    const now = new Date().toISOString();
    expect(() =>
      db
        .prepare(
          "INSERT INTO task_recurrences (organization_id,title,kind,priority,rrule,created_at,updated_at) VALUES (1,'x','admin','WHENEVER','daily',?,?)"
        )
        .run(now, now)
    ).toThrow();
  });

  it("folds customer reminders into tasks, once, idempotently", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO customers (customer_code,business_name,synced_at,organization_id,group_id) VALUES ('BP1','مشتری یادآوری',?,1,NULL)"
    ).run(now);
    const cid = (db.prepare("SELECT id FROM customers WHERE customer_code='BP1'").get() as { id: number }).id;
    db.prepare("INSERT INTO reminders (entity_type,entity_id,due_date,message,resolved,created_at) VALUES ('customer',?,?,?,0,?)")
      .run(cid, "2026-09-10", "تماس تسویه", now);
    db.prepare("INSERT INTO reminders (entity_type,entity_id,due_date,message,resolved,created_at) VALUES ('customer',?,?,?,1,?)")
      .run(cid, "2026-08-01", "پیگیری قدیمی", now);
    db.prepare("INSERT INTO reminders (entity_type,entity_id,due_date,message,resolved,created_at) VALUES ('district',999,?,?,0,?)")
      .run("2026-09-10", "یادآوری منطقه", now);

    // The migration marker was set on the empty first boot; clear it to exercise the copy.
    db.prepare("DELETE FROM app_meta WHERE key = 'board_pocket_reminders_folded'").run();

    backfillReminderTasks(db);
    const folded = db
      .prepare("SELECT kind,title,entity_type,entity_id,due_at,status FROM tasks WHERE entity_id = ? AND kind='reminder'")
      .all(cid) as { title: string; entity_type: string; due_at: string; status: string }[];
    expect(folded).toHaveLength(2);
    expect(folded.find((t) => t.title === "تماس تسویه")).toMatchObject({ entity_type: "customer", due_at: "2026-09-10", status: "open" });
    expect(folded.find((t) => t.title === "پیگیری قدیمی")?.status).toBe("done");
    expect(
      (db.prepare("SELECT value FROM app_meta WHERE key='board_pocket_reminders_folded'").get() as { value: string }).value
    ).toBe("1");

    // district reminder is left on the map
    expect((db.prepare("SELECT COUNT(*) n FROM tasks WHERE title='یادآوری منطقه'").get() as { n: number }).n).toBe(0);

    // re-run is a no-op
    backfillReminderTasks(db);
    expect((db.prepare("SELECT COUNT(*) n FROM tasks WHERE entity_id=? AND kind='reminder'").get(cid) as { n: number }).n).toBe(2);
  });
});
