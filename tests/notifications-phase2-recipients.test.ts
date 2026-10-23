import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-notif-p2-recip-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { recipientsFor, renderNotification } = await import("@/lib/repo/notifications");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let mgr = 0,
  seller = 0,
  custId = 0,
  g = 0,
  ord = 0;

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM users WHERE id>0; DELETE FROM groups; DELETE FROM customers; DELETE FROM orders; DELETE FROM cheques; DELETE FROM reminders; DELETE FROM credit_approvals; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  g = Number(
    (await db.prepare("INSERT INTO groups (organization_id, name, slug, created_at) VALUES (1,'گ','g',?)").run(now)).lastInsertRowid
  );
  // users has no `name` column; the required NOT NULL cols are username/password_hash/display_name.
  const u = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, group_id, role, active, created_at, organization_id) VALUES (?,?,?,?,?,1,?,1)"
  );
  mgr = Number((await u.run(`m${Date.now()}`, "x:y", "مدیر", g, "group_manager", now)).lastInsertRowid);
  seller = Number((await u.run(`s${Date.now()}`, "x:y", "فروشنده", g, "phone_sales", now)).lastInsertRowid);
  // customers has no `created_at`; customer_code + synced_at are NOT NULL with no default.
  custId = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code, business_name, lifecycle, synced_at, group_id, organization_id) VALUES ('C1','مشتری','active',?,?,1)"
      )
      .run(now, g)).lastInsertRowid
  );
  // orders: order_no / created_by / updated_at are NOT NULL with no default; status is an uppercase CHECK.
  ord = Number(
    (await db
      .prepare(
        `INSERT INTO orders (order_no, organization_id, group_id, customer_id, salesperson_user_id, status, order_date, created_by, created_at, updated_at)
         VALUES ('9001', 1, ?, ?, ?, 'CONFIRMED', ?, ?, ?, ?)`
      )
      .run(g, custId, seller, now.slice(0, 10), seller, now, now)).lastInsertRowid
  );
});

const ctx = (over: Partial<Parameters<typeof recipientsFor>[2]>) =>
  ({
    kind: "x",
    entity_type: null,
    entity_id: null,
    occurred_at: new Date().toISOString(),
    meta: {},
    ...over,
  }) as Parameters<typeof recipientsFor>[2];

describe("Phase 2 recipientsFor", () => {
  it("task.escalated → the new assignee from meta, actor excluded", async () => {
    expect(await recipientsFor(1, "task.escalated", ctx({ meta: { assignee_user_id: mgr } }), seller)).toEqual([mgr]);
    expect(await recipientsFor(1, "task.escalated", ctx({ meta: { assignee_user_id: mgr } }), mgr)).toEqual([]);
  });

  it("customer.overdue → the customer's owning salesperson", async () => {
    // sweep passes entity_type 'customer', entity_id = customer id
    expect(await recipientsFor(1, "customer.overdue", ctx({ entity_type: "customer", entity_id: custId }), null)).toEqual([
      seller,
    ]);
  });

  it("cheque.due_soon → received_by, falling back to the customer's salesperson", async () => {
    const db = getDb();
    const ch = Number(
      (await db
        .prepare(
          "INSERT INTO cheques (organization_id, customer_id, amount_toman, cheque_no, due_date, status, received_at, received_by, created_at, updated_at) VALUES (1,?,1000,'c1',?, 'in_hand', ?, ?, ?, ?)"
        )
        .run(custId, "2026-09-10", new Date().toISOString(), mgr, new Date().toISOString(), new Date().toISOString()))
        .lastInsertRowid
    );
    expect(await recipientsFor(1, "cheque.due_soon", ctx({ entity_type: "cheque", entity_id: ch }), null)).toEqual([mgr]);
  });

  it("credit_approval.waiting → owner/group_manager approvers, not the requester", async () => {
    const db = getDb();
    // credit_approvals has no `customer_id`; order_id / customer_balance_toman / overage_toman are NOT NULL.
    const ca = Number(
      (await db
        .prepare(
          "INSERT INTO credit_approvals (organization_id, order_id, status, requested_at, requested_by, customer_balance_toman, overage_toman) VALUES (1,?,'pending',?,?,0,0)"
        )
        .run(ord, new Date().toISOString(), seller)).lastInsertRowid
    );
    const r = await recipientsFor(1, "credit_approval.waiting", ctx({ entity_type: "credit_approval", entity_id: ca }), seller);
    expect(r).toContain(mgr);
    expect(r).not.toContain(seller);
  });

  it("reminder.due → customer reminder routes to the customer's salesperson", async () => {
    const db = getDb();
    const rem = Number(
      (await db
        .prepare(
          "INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at) VALUES ('customer', ?, ?, 'یادآوری', 0, ?)"
        )
        .run(custId, "2026-09-01", new Date().toISOString())).lastInsertRowid
    );
    expect(await recipientsFor(1, "reminder.due", ctx({ entity_type: "customer", entity_id: custId }), null)).toEqual([seller]);
    expect(rem).toBeGreaterThan(0);
  });

  it("renders a Persian title for each new type", () => {
    for (const code of ["task.escalated", "credit_approval.waiting", "customer.overdue", "cheque.due_soon", "reminder.due"]) {
      const out = renderNotification(code, ctx({ meta: { customer_name: "مشتری X", title: "کار Y" } }));
      expect(out.title_fa.length, code).toBeGreaterThan(0);
      expect(out.title_fa, code).not.toBe(code); // not the bare fallback
    }
  });
});
