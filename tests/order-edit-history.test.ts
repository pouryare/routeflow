import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { editRule } from "@/lib/orderEditRules";
import { editNote } from "@/lib/orderEditNote";

const testDbPath = path.join(os.tmpdir(), `rf-edit-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { setOrderPriority } = await import("@/lib/repo/orderPriority");
const { orderEvents } = await import("@/lib/repo/orders");
afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("FB3 edit rules by stage", () => {
  it("lines change only on a draft; the priority flag until the order is finished", () => {
    expect(editRule("line", "DRAFT")).toEqual({ ok: true });
    const locked = editRule("line", "CONFIRMED");
    expect(locked.ok).toBe(false);
    expect(editRule("priority", "CONFIRMED")).toEqual({ ok: true });
    expect(editRule("priority", "DELIVERED").ok).toBe(false);
  });
});

describe("F73 edit history", () => {
  it("writes an edit event with the old and the new value, and none when nothing changed", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('eh','x','e','owner',?,1)").run(now)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('E1','ف','active',?,1)").run(now)).lastInsertRowid);
    const order = Number((await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,priority,created_by,created_at,updated_at,organization_id) VALUES ('EH-1',?,'2026-09-10','CONFIRMED','NORMAL',?,?,?,1)").run(cust, user, now, now)).lastInsertRowid);
    expect(await setOrderPriority(1, order, "URGENT", user)).toBe(true);
    expect(await setOrderPriority(1, order, "URGENT", user)).toBe(true);
    const edits = (await orderEvents(1, order)).filter((e) => e.action === "edit");
    expect(edits).toHaveLength(1);
    expect(edits[0].note).toBe(editNote("اولویت", "عادی", "فوری"));
    expect(edits[0].actor_user_id).toBe(user);
  });
});
