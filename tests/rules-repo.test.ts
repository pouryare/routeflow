import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-rules-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { runEventRules, runSweepRules, escalateStaleRuns, resolveRuleRunsFor } = await import(
  "@/lib/repo/rules"
);

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let mgr = 0;
let custId = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM events; DELETE FROM rule_runs; DELETE FROM tasks; DELETE FROM alerts; DELETE FROM credit_approvals; DELETE FROM orders; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x", "م", "owner", now).lastInsertRowid);
  mgr = Number(u.run(`m${Date.now()}`, "x", "مد", "group_manager", now).lastInsertRowid);
  custId = Number(
    db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C1','x','active','2026-01-01',1)").run().lastInsertRowid
  );
});

// Insert the events row directly rather than via emitEvent: emitEvent now drives
// runEventRules internally, which would consume the rule's fire (cooldown/liveRun) before
// each test's own explicit runEventRules call. Raw INSERT keeps runEventRules unit-tested
// in isolation. Columns mirror what emitEvent writes.
function ev(kind: string, entityId: number, meta: Record<string, unknown> = {}, at?: string) {
  const now = new Date().toISOString();
  const id = Number(
    getDb()
      .prepare(
        `INSERT INTO events
           (organization_id, kind, entity_type, entity_id, actor_user_id, metadata_json, occurred_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(1, kind, "order", entityId, null, JSON.stringify(meta), at ?? now, now).lastInsertRowid
  );
  return getDb().prepare("SELECT * FROM events WHERE id = ?").get(id) as never;
}

describe("rules repo", () => {
  it("delivery.failed creates a manager task, then holds its fire within the cooldown", () => {
    const e = ev("delivery.failed", 42, { customer_id: custId });
    const fired = runEventRules(1, e);
    expect(fired.map((f) => f.rule_code)).toContain("delivery_failed_retry");
    const tasks = getDb().prepare("SELECT * FROM tasks").all() as { role_hint: string; title: string }[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].role_hint).toBe("group_manager");

    const e2 = ev("delivery.failed", 42, { customer_id: custId });
    expect(runEventRules(1, e2)).toEqual([]); // still cooling down
    expect((getDb().prepare("SELECT COUNT(*) n FROM tasks").get() as { n: number }).n).toBe(1);
  });

  it("re-fires once the cooldown_until has passed", () => {
    const e = ev("delivery.failed", 7, {}, "2026-03-01T09:00:00.000Z");
    runEventRules(1, e);
    // push the run's cooldown into the past
    getDb().prepare("UPDATE rule_runs SET cooldown_until = '2026-03-01T09:05:00.000Z'").run();
    const e2 = ev("delivery.failed", 7, {}, "2026-03-01T10:00:00.000Z");
    expect(runEventRules(1, e2).map((f) => f.rule_code)).toContain("delivery_failed_retry");
    expect((getDb().prepare("SELECT COUNT(*) n FROM tasks").get() as { n: number }).n).toBe(2);
  });

  it("the sweep raises a critical alert + a run for a pending 90-minute-old approval", () => {
    const db = getDb();
    const oid = Number(
      db.prepare("INSERT INTO orders (order_no,customer_id,status,order_date,created_by,created_at,updated_at,organization_id) VALUES ('o1',?,'PENDING_CREDIT','2026-03-01',?,?,?,1)").run(custId, owner, "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z").lastInsertRowid
    );
    db.prepare(
      "INSERT INTO credit_approvals (organization_id, order_id, requested_by, requested_at, customer_balance_toman, credit_limit_toman, overage_toman, status) VALUES (1,?,?,?,1000,0,1000,'pending')"
    ).run(oid, owner, "2026-03-01T08:00:00.000Z");

    const fired = runSweepRules(1, "2026-03-01T09:30:00.000Z");
    expect(fired.map((f) => f.rule_code)).toContain("credit_approval_waiting");
    const alerts = getDb().prepare("SELECT severity FROM alerts").all() as { severity: string }[];
    expect(alerts).toEqual([{ severity: "critical" }]);
  });

  it("escalateStaleRuns re-assigns and marks a run past its window", () => {
    const e = ev("delivery.failed", 3, {}, "2026-03-01T09:00:00.000Z");
    runEventRules(1, e);
    // delivery_failed_retry has no escalation -- give it one for the test
    getDb().prepare("UPDATE rules SET escalate_after_min = 60, escalate_to_role = 'owner' WHERE code = 'delivery_failed_retry'").run();
    getDb().prepare("UPDATE rule_runs SET fired_at = '2026-03-01T09:00:00.000Z'").run();

    const n = escalateStaleRuns(1, "2026-03-01T10:30:00.000Z");
    expect(n).toBe(1);
    const rr = getDb().prepare("SELECT escalated_at, task_id FROM rule_runs").get() as { escalated_at: string | null; task_id: number };
    expect(rr.escalated_at).not.toBeNull();
    const t = getDb().prepare("SELECT assignee_user_id, priority FROM tasks WHERE id = ?").get(rr.task_id) as { assignee_user_id: number; priority: string };
    expect(t).toEqual({ assignee_user_id: owner, priority: "CRITICAL" });
  });

  it("resolveRuleRunsFor lets a later run fire again", () => {
    const e = ev("delivery.failed", 99, {}, "2026-03-01T09:00:00.000Z");
    runEventRules(1, e);
    resolveRuleRunsFor(1, "order", 99);
    const e2 = ev("delivery.failed", 99, {}, "2026-03-01T09:10:00.000Z");
    expect(runEventRules(1, e2).map((f) => f.rule_code)).toContain("delivery_failed_retry");
  });
});
