import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-repo-tasks-move-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createTask, moveTask, tasksRepo } = await import("@/lib/repo/tasks");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let actor = 0;
beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM rule_runs; DELETE FROM tasks; DELETE FROM users WHERE id > 0;");
  actor = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,1)"
      )
      .run(`mv${Date.now()}`, "x", "م", "group_manager", new Date().toISOString()).lastInsertRowid
  );
});

const NOW = "2026-09-02T09:00:00.000Z";

describe("createTask stage default", () => {
  it("stamps a stage for a pipeline kind, leaves it null otherwise", () => {
    const a = createTask(1, { title: "پیگیری", kind: "outreach", priority: "NORMAL" });
    const b = createTask(1, { title: "یادداشت", kind: "note", priority: "NORMAL" });
    expect(tasksRepo.get(1, a)!.stage).toBe("call");
    expect(tasksRepo.get(1, b)!.stage).toBe(null);
  });
  it("honours an explicit stage", () => {
    const id = createTask(1, { title: "x", kind: "order", stage: "transit", priority: "NORMAL" });
    expect(tasksRepo.get(1, id)!.stage).toBe("transit");
  });
});

describe("moveTask", () => {
  it("status view → done closes the task and stamps done_at + stage", () => {
    const id = createTask(1, { title: "تماس تست", kind: "outreach", role_hint: "salesperson", priority: "NORMAL" });
    const res = moveTask(1, id, { view: "status", toLane: "done", actor, nowIso: NOW });
    expect(res).toMatchObject({ status: "done", stage: "done" });
    const row = tasksRepo.get(1, id)!;
    expect(row.status).toBe("done");
    expect(row.done_at).toBeTruthy();
  });

  it("time view → 'week' sets due_at, keeps status", () => {
    const id = createTask(1, { title: "سفارش تست", kind: "order", priority: "NORMAL" });
    const res = moveTask(1, id, { view: "time", toLane: "week", actor, nowIso: NOW });
    expect(res!.status).toBe("open");
    expect(res!.due_at).toBe("2026-09-04");
  });

  it("status view → in_progress sets started_at, status stays open", () => {
    const id = createTask(1, { title: "کار اداری", kind: "admin", priority: "NORMAL" });
    const res = moveTask(1, id, { view: "status", toLane: "in_progress", actor, nowIso: NOW });
    expect(res!.status).toBe("open");
    expect(res!.started_at).toBeTruthy();
  });

  it("workflow view sets stage and marks started, status stays open", () => {
    const id = createTask(1, { title: "بازدید تست", kind: "visit", priority: "NORMAL" });
    const res = moveTask(1, id, { view: "workflow", toLane: "enroute", actor, nowIso: NOW });
    expect(res).toMatchObject({ stage: "enroute", status: "open" });
    expect(res!.started_at).toBeTruthy();
  });

  it("carries an outcome_code through the close path", () => {
    const id = createTask(1, { title: "تماس با نتیجه", kind: "outreach", priority: "NORMAL" });
    moveTask(1, id, { view: "status", toLane: "done", actor, nowIso: NOW, outcome_code: "ORDERED" });
    expect(tasksRepo.get(1, id)!.outcome_code).toBe("ORDERED");
  });

  it("returns null for a task outside the org", () => {
    const id = createTask(1, { title: "x", kind: "admin", priority: "NORMAL" });
    expect(moveTask(2, id, { view: "status", toLane: "open", actor, nowIso: NOW })).toBe(null);
  });
});
