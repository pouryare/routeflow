import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-notif-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { recipientsFor, fanOutNotifications, listNotificationGroups, unreadGroupCount, markGroupsRead } = await import(
  "@/lib/repo/notifications"
);
const { runEventRules } = await import("@/lib/repo/rules");
const { emitEvent } = await import("@/lib/repo/events");

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

function evRow(kind: string, entityId: number | null, meta: Record<string, unknown>, actor: number | null) {
  return {
    id: 1,
    kind,
    entity_type: entityId == null ? null : "order",
    entity_id: entityId,
    actor_user_id: actor,
    metadata_json: JSON.stringify(meta),
    occurred_at: now,
  };
}

it("fans one order.confirmed event out to a single feed row for the salesperson", () => {
  const n = fanOutNotifications(
    1,
    { code: "notify_order_confirmed", action_json: JSON.stringify({ notification_type: "order.confirmed" }) },
    evRow("order.passReview", ord, { order_no: "9001", customer_name: "x" }, owner),
    null
  );
  expect(n).toBe(1);
  const groups = listNotificationGroups(1, seller);
  expect(groups).toHaveLength(1);
  expect(groups[0].group_key).toBe(`order:${ord}`);
  expect(groups[0].unread_count).toBe(1);
  expect(unreadGroupCount(1, seller)).toBe(1);
});

it("two order.created events the same day collapse into one group with count 2", () => {
  const rule = { code: "notify_order_created", action_json: JSON.stringify({ notification_type: "order.created" }) };
  fanOutNotifications(1, rule, evRow("order.submit", ord, { order_no: "9001" }, owner), null);
  // a second order in the same group/day
  const db = getDb();
  const ord2 = Number(
    db
      .prepare(
        `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, status, order_date, created_by, created_at, updated_at)
     VALUES ('9002', ?, (SELECT group_id FROM orders WHERE id = ?), ?, 'CONFIRMED', '2026-06-01', ?, ?, ?)`
      )
      .run(custId, ord, seller, owner, now, now).lastInsertRowid
  );
  fanOutNotifications(1, rule, { ...evRow("order.submit", ord2, { order_no: "9002" }, owner), id: 2 }, null);

  const groups = listNotificationGroups(1, mgr);
  expect(groups).toHaveLength(1);
  expect(groups[0].count).toBe(2);
});

it("markGroupsRead('all') clears the unread count", () => {
  fanOutNotifications(
    1,
    { code: "c", action_json: JSON.stringify({ notification_type: "order.confirmed" }) },
    evRow("order.passReview", ord, {}, owner),
    null
  );
  expect(unreadGroupCount(1, seller)).toBe(1);
  markGroupsRead(1, seller, "all");
  expect(unreadGroupCount(1, seller)).toBe(0);
});

function seedNotifyRule(code: string, trigger: string, typeCode: string) {
  const ts = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO rules (organization_id, code, name, trigger_kind, condition_json, action_kind, action_json,
         cooldown_min, escalate_after_min, escalate_to_role, active, created_at, updated_at)
       VALUES (NULL, ?, ?, ?, NULL, 'notify', ?, 0, NULL, NULL, 1, ?, ?)`
    )
    .run(code, code, trigger, JSON.stringify({ notification_type: typeCode }), ts, ts);
}

describe("notify action", () => {
  it("runEventRules fires a notify rule and writes a feed row", () => {
    seedNotifyRule("n_conf", "order.passReview", "order.confirmed");
    const id = emitEvent(1, {
      kind: "order.passReview",
      entity_type: "order",
      entity_id: ord,
      actor_user_id: owner,
      metadata: {},
    });
    const e = getDb().prepare("SELECT * FROM events WHERE id = ?").get(id) as never;
    const fired = runEventRules(1, e);
    expect(fired.map((f: { rule_code: string }) => f.rule_code)).toContain("n_conf");
    expect(listNotificationGroups(1, seller)).toHaveLength(1);
  });

  it("emitEvent alone (no explicit runEventRules) also produces the feed row", () => {
    seedNotifyRule("n_conf2", "order.passReview", "order.confirmed");
    emitEvent(1, {
      kind: "order.passReview",
      entity_type: "order",
      entity_id: ord,
      actor_user_id: owner,
      metadata: {},
    });
    expect(unreadGroupCount(1, seller)).toBeGreaterThanOrEqual(1);
  });
});
