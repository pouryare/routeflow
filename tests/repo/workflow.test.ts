import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-workflow-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { listStepTemplates, getComplaintSteps, linkStep } = await import("@/lib/repo/workflow");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let complaintId = 0;
let reporterId = 0;

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM workflow_edges; DELETE FROM tasks WHERE id > 0; DELETE FROM quality_complaints; DELETE FROM users WHERE id > 0;");
  const now = new Date().toISOString();
  reporterId = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('rep','x','گزارش‌دهنده','salesperson',1,?,1)"
      )
      .run(now).lastInsertRowid,
  );
  complaintId = Number(
    db
      .prepare(
        "INSERT INTO quality_complaints (organization_id,reported_at,reported_by,category,severity,status,created_at) VALUES (1,?,?,?,?,?,?)"
      )
      .run(now, reporterId, "spoilage", "high", "open", now).lastInsertRowid,
  );
});

describe("listStepTemplates", () => {
  it("returns the six seeded templates in order", () => {
    const t = listStepTemplates();
    expect(t).toHaveLength(6);
    expect(t[0].key).toBe("initial_review");
  });
});

describe("linkStep / getComplaintSteps", () => {
  it("spawns a root step with no edge when fromTaskId is null", () => {
    const { taskId, edge } = linkStep(1, complaintId, "initial_review", null, reporterId);
    expect(edge).toBeNull();
    const { tasks, edges } = getComplaintSteps(1, complaintId);
    expect(tasks.map((t) => t.id)).toContain(taskId);
    expect(edges).toHaveLength(0);
    expect(tasks[0].entity_type).toBe("complaint");
    expect(tasks[0].entity_id).toBe(complaintId);
    expect(tasks[0].kind).toBe("complaint_step");
    expect(tasks[0].title).toBe("بررسی اولیه");
  });

  it("spawns a child step linked to an existing one", () => {
    const root = linkStep(1, complaintId, "initial_review", null, reporterId);
    const child = linkStep(1, complaintId, "lab_check", root.taskId, reporterId);
    expect(child.edge).toEqual({ from_task_id: root.taskId, to_task_id: child.taskId });
    const { tasks, edges } = getComplaintSteps(1, complaintId);
    expect(tasks).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });

  it("supports branching -- two children from the same parent", () => {
    const root = linkStep(1, complaintId, "initial_review", null, reporterId);
    linkStep(1, complaintId, "lab_check", root.taskId, reporterId);
    linkStep(1, complaintId, "customer_contact", root.taskId, reporterId);
    const { edges } = getComplaintSteps(1, complaintId);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.from_task_id === root.taskId)).toBe(true);
  });

  it("rejects an unknown template key", () => {
    expect(() => linkStep(1, complaintId, "not_a_real_key", null, reporterId)).toThrow();
  });

  it("rejects linking from a task that belongs to a different complaint", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const otherComplaint = Number(
      db
        .prepare(
          "INSERT INTO quality_complaints (organization_id,reported_at,reported_by,category,severity,status,created_at) VALUES (1,?,?,?,?,?,?)"
        )
        .run(now, reporterId, "packaging", "low", "open", now).lastInsertRowid,
    );
    const otherRoot = linkStep(1, otherComplaint, "initial_review", null, reporterId);
    expect(() => linkStep(1, complaintId, "lab_check", otherRoot.taskId, reporterId)).toThrow();
  });
});
