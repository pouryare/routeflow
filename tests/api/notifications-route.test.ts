import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-notifications-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, PATCH } = await import("@/app/api/notifications/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { fanOutNotifications } = await import("@/lib/repo/notifications");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let seller = 0;
let manager = 0;
let custId = 0;
let g = 0;
let ord = 0;
let sellerToken = "";

function req(method: string, token: string, body?: unknown) {
  return new NextRequest("http://localhost/api/notifications", {
    method,
    headers: { cookie: `${COOKIE_NAME}=${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  const db = getDb();
  // Reset the transactional tables only -- notification_types is the seeded catalogue.
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM notifications; DELETE FROM events; DELETE FROM rule_runs; DELETE FROM tasks; DELETE FROM alerts; DELETE FROM orders; DELETE FROM customers; DELETE FROM groups; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  seller = Number(u.run(`s${Date.now()}`, "x:y", "ف", "salesperson", now).lastInsertRowid);
  manager = Number(u.run(`m${Date.now()}`, "x:y", "مد", "group_manager", now).lastInsertRowid);
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
  db.prepare("UPDATE users SET group_id = ? WHERE id = ?").run(g, manager);
  ord = Number(
    db
      .prepare(
        `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, status, order_date, created_by, created_at, updated_at, organization_id)
         VALUES ('9001', ?, ?, ?, 'CONFIRMED', '2026-06-01', ?, ?, ?, 1)`
      )
      .run(custId, g, seller, manager, now, now).lastInsertRowid
  );

  // One unread feed row for `seller`. The actor is the manager, so `seller` -- the
  // order's salesperson -- is a recipient of order.confirmed.
  fanOutNotifications(
    1,
    { code: "t7", action_json: JSON.stringify({ notification_type: "order.confirmed" }) },
    {
      id: 1,
      kind: "order.passReview",
      entity_type: "order",
      entity_id: ord,
      actor_user_id: manager,
      metadata_json: "{}",
      occurred_at: new Date().toISOString(),
    },
    null
  );

  sellerToken = createSessionToken({ uid: seller, role: "salesperson", gid: null, oid: 1, tv: 0, name: "ف" });
});

describe("GET/PATCH /api/notifications", () => {
  it("401 without a valid session", async () => {
    const res = await GET(req("GET", "nonsense"));
    expect(res.status).toBe(401);
  });

  it("GET returns the caller's own grouped feed with an unread count", async () => {
    const res = await GET(req("GET", sellerToken));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.unread).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(json.groups)).toBe(true);
    expect(json.groups.length).toBeGreaterThanOrEqual(1);
  });

  it("PATCH { read: 'all' } zeroes the unread count", async () => {
    const res = await PATCH(req("PATCH", sellerToken, { read: "all" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.unread).toBe(0);
  });

  it("PATCH with a non-string, non-'all' read is 400", async () => {
    const res = await PATCH(req("PATCH", sellerToken, { read: 123 }));
    expect(res.status).toBe(400);
  });
});
