import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-tasks-alerts-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createTask, listTasks, completeTask, TaskError } = await import("@/lib/repo/tasks");
const { raiseAlert, listAlerts, resolveAlert } = await import("@/lib/repo/alerts");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let seller = 0;

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM rule_runs; DELETE FROM tasks; DELETE FROM alerts; DELETE FROM users WHERE id>0;");
  db.prepare("INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?)").run(
    new Date().toISOString()
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x", "م", "owner", now).lastInsertRowid);
  seller = Number(u.run(`s${Date.now()}`, "x", "ف", "salesperson", now).lastInsertRowid);
});

describe("tasks repo", () => {
  it("creates, lists by assignee / role / status, and orders by priority", () => {
    createTask(1, { title: "A", kind: "call", assignee_user_id: seller, priority: "NORMAL" });
    createTask(1, { title: "B", kind: "call", assignee_user_id: seller, priority: "CRITICAL" });
    createTask(1, { title: "C", kind: "call", role_hint: "group_manager" });

    const mine = listTasks(1, { assignee: seller });
    expect(mine.map((t) => t.title)).toEqual(["B", "A"]); // CRITICAL first
    expect(listTasks(1, { role: "group_manager" }).map((t) => t.title)).toEqual(["C"]);
  });

  it("completeTask stamps the outcome and resolves a linked rule_run", () => {
    const db = getDb();
    db.prepare("INSERT INTO rules (organization_id,code,name,trigger_kind,action_kind,created_at,updated_at) VALUES (1,'r1','r','x','task',?,?)").run(new Date().toISOString(), new Date().toISOString());
    const ruleId = (db.prepare("SELECT id FROM rules WHERE code='r1'").get() as { id: number }).id;
    const taskId = createTask(1, { title: "T", kind: "call", entity_type: "order", entity_id: 5 });
    db.prepare(
      "INSERT INTO rule_runs (organization_id, rule_id, entity_type, entity_id, fired_at, cooldown_until, task_id) VALUES (1,?,'order',5,?,?,?)"
    ).run(ruleId, new Date().toISOString(), new Date().toISOString(), taskId);

    completeTask(1, taskId, { outcome_code: "PRICE_OBJECTION", outcome_note: "گران بود" });
    const t = getDb().prepare("SELECT status, outcome_code, done_at FROM tasks WHERE id = ?").get(taskId) as {
      status: string;
      outcome_code: string;
      done_at: string | null;
    };
    expect(t).toMatchObject({ status: "done", outcome_code: "PRICE_OBJECTION" });
    expect(t.done_at).not.toBeNull();
    expect(
      (getDb().prepare("SELECT resolved_at FROM rule_runs").get() as { resolved_at: string | null }).resolved_at
    ).not.toBeNull();
  });

  it("refuses a cross-tenant completeTask", () => {
    const id = createTask(2, { title: "other", kind: "call" });
    expect(() => completeTask(1, id)).toThrow(TaskError);
  });
});

describe("alerts repo", () => {
  it("raises, lists open by severity, and resolves", () => {
    raiseAlert(1, { severity: "critical", category: "credit", title: "!" });
    raiseAlert(1, { severity: "warning", category: "stock", title: "~" });
    expect(listAlerts(1, { open: true }).map((a) => a.severity)).toEqual(["critical", "warning"]);

    const critId = listAlerts(1, { severity: "critical" })[0].id;
    resolveAlert(1, critId, owner);
    expect(listAlerts(1, { open: true }).map((a) => a.severity)).toEqual(["warning"]);
  });
});
