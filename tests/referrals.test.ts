import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-referrals-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { convertOnDelivery } = await import("@/lib/repo/crm/conversion");
const { topReferrers } = await import("@/lib/repo/leadSources");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("referrals (S17)", () => {
  it("gives the referrer's owner one thank-you call on the referred customer's first delivery, and ranks referrers", async () => {
    const db = getDb();
    const at = new Date().toISOString();
    const owner = Number((await db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at, organization_id) VALUES ('o1','x','مالک','owner',?,1)").run(at)).lastInsertRowid);
    const cust = async (code: string, name: string, ref: number | null) =>
      Number((await db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id, owner_user_id, referred_by_customer_id) VALUES (?,?,?,1,?,?)").run(code, name, at, owner, ref)).lastInsertRowid);
    const referrer = await cust("R", "بقالی علی", null);
    const fresh = await cust("N", "سوپر رضا", referrer);
    const order = async (no: string) => Number((await db.prepare("INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at, organization_id) VALUES (?, ?, 'DELIVERED', '2026-11-05', ?, ?, ?, 1)").run(no, fresh, owner, at, at)).lastInsertRowid);

    await convertOnDelivery(db, 1, await order("1405-00001"), owner);
    await convertOnDelivery(db, 1, await order("1405-00002"), owner);
    const tasks = (await db.prepare("SELECT title, assignee_user_id, entity_id, kind FROM tasks WHERE entity_type = 'customer' AND entity_id = ?").all(referrer)) as { title: string; assignee_user_id: number; kind: string }[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "تشکر از بقالی علی بابت معرفی سوپر رضا", assignee_user_id: owner, kind: "call" });

    const top = await topReferrers({ user: { id: owner }, role: "owner", organizationId: 1, groupId: null } as never);
    expect(top[0]).toEqual({ id: referrer, name: "بقالی علی", referred: 1, converted: 1 });
  });
});
