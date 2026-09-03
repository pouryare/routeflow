import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-notif-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { recipientsFor } = await import("@/lib/repo/notifications");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0,
  mgr = 0,
  seller = 0,
  custId = 0,
  g = 0,
  ord = 0,
  now = "";

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM notifications; DELETE FROM events; DELETE FROM rule_runs; DELETE FROM tasks; DELETE FROM alerts; DELETE FROM orders; DELETE FROM customers; DELETE FROM groups; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x:y", "م", "owner", now).lastInsertRowid);
  mgr = Number(u.run(`m${Date.now()}`, "x:y", "مد", "group_manager", now).lastInsertRowid);
  seller = Number(u.run(`s${Date.now()}`, "x:y", "ف", "salesperson", now).lastInsertRowid);
  custId = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C1','x','active','2026-01-01',1)"
      )
      .run().lastInsertRowid
  );
  g = Number(
    db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('گ', 'g', ?, 1)").run(now)
      .lastInsertRowid
  );
  db.prepare("UPDATE users SET group_id = ? WHERE id = ?").run(g, mgr);
  ord = Number(
    db
      .prepare(
        `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, status, order_date, created_by, created_at, updated_at, organization_id)
         VALUES ('9001', ?, ?, ?, 'CONFIRMED', '2026-06-01', ?, ?, ?, 1)`
      )
      .run(custId, g, seller, owner, now, now).lastInsertRowid
  );
});

describe("notification schema", () => {
  it("seeds the NULL-org catalogue and every seed row has a valid shape", () => {
    const db = getDb();
    const rows = db
      .prepare("SELECT code, directedness, priority, group_scope FROM notification_types WHERE organization_id IS NULL")
      .all() as { code: string; directedness: string; priority: string; group_scope: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.map((r) => r.code)).toContain("task.assigned");
    for (const r of rows) {
      expect(["directed", "ambient"]).toContain(r.directedness);
      expect(["CRITICAL", "HIGH", "NORMAL", "LOW"]).toContain(r.priority);
      expect(["entity", "type_day"]).toContain(r.group_scope);
    }
  });

  it("re-running seedNotificationTypes does not duplicate rows", async () => {
    const { seedNotificationTypes } = await import("@/lib/db");
    const db = getDb();
    seedNotificationTypes(db);
    seedNotificationTypes(db);
    const n = (db.prepare("SELECT COUNT(*) c FROM notification_types WHERE organization_id IS NULL").get() as { c: number }).c;
    const distinct = (db.prepare("SELECT COUNT(DISTINCT code) c FROM notification_types WHERE organization_id IS NULL").get() as { c: number }).c;
    expect(n).toBe(distinct);
  });
});

describe("recipientsFor", () => {
  it("routes order events to the order's salesperson", () => {
    const r = recipientsFor(
      1,
      "order.confirmed",
      { kind: "order.passReview", entity_type: "order", entity_id: ord, occurred_at: now, meta: {} },
      owner
    );
    expect(r).toEqual([seller]);
  });

  it("routes delivery.failed to the salesperson AND the group's manager, actor excluded", () => {
    const r = recipientsFor(
      1,
      "delivery.failed",
      { kind: "delivery.failed", entity_type: "order", entity_id: ord, occurred_at: now, meta: {} },
      seller
    );
    expect(r.sort()).toEqual([mgr].sort()); // seller is the actor -> excluded
  });

  it("routes task.assigned to meta.assignee_user_id", () => {
    const r = recipientsFor(
      1,
      "task.assigned",
      { kind: "task.assigned", entity_type: "task", entity_id: 5, occurred_at: now, meta: { assignee_user_id: seller } },
      owner
    );
    expect(r).toEqual([seller]);
  });

  it("returns [] when nothing resolves", () => {
    const r = recipientsFor(
      1,
      "order.confirmed",
      { kind: "x", entity_type: "order", entity_id: 999999, occurred_at: now, meta: {} },
      owner
    );
    expect(r).toEqual([]);
  });

  it("routes payment.recorded to every allocation order's salesperson via meta.order_ids", () => {
    const r = recipientsFor(
      1,
      "payment.recorded",
      { kind: "payment.recorded", entity_type: "payment", entity_id: 77, occurred_at: now, meta: { order_ids: [ord] } },
      owner
    );
    expect(r).toEqual([seller]);
  });

  it("routes payment.recorded to nobody when meta.order_ids is empty", () => {
    const r = recipientsFor(
      1,
      "payment.recorded",
      { kind: "payment.recorded", entity_type: "payment", entity_id: 77, occurred_at: now, meta: { order_ids: [] } },
      owner
    );
    expect(r).toEqual([]);
  });
});
