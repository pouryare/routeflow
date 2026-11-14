import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { needsSignOff } from "@/lib/changeRequests";

const testDbPath = path.join(os.tmpdir(), `rf-chg-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { changeCreditLimit, decideChange, pendingChanges } = await import("@/lib/repo/changeRequests");
afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("F48 credit limit sign-off", () => {
  it("asks for sign-off on a raise or a removal only", () => {
    expect(needsSignOff(100, 200)).toBe(true);
    expect(needsSignOff(100, null)).toBe(true);
    expect(needsSignOff(100, 50)).toBe(false);
    expect(needsSignOff(null, 50)).toBe(false);
  });

  it("holds a manager's raise until the owner approves, and the owner cannot approve their own", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const mk = async (u: string, role: string) => Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,'x',?,?,?,1)").run(u, u, role, now)).lastInsertRowid);
    const mgr = await mk("cm", "group_manager");
    const own = await mk("co", "owner");
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,credit_limit_toman,synced_at,organization_id) VALUES ('C1','ف','active',1000,?,1)").run(now)).lastInsertRowid);
    const limit = async () => Number(((await db.prepare("SELECT credit_limit_toman AS v FROM customers WHERE id = ?").get(cust)) as { v: number }).v);

    expect(await changeCreditLimit(1, cust, 500, { id: mgr, role: "group_manager" }, "")).toBe("applied");
    expect(await limit()).toBe(500);
    expect(await changeCreditLimit(1, cust, 2000, { id: mgr, role: "group_manager" }, "مشتری خوش‌حساب")).toBe("pending");
    expect(await limit()).toBe(500);
    await expect(changeCreditLimit(1, cust, 3000, { id: mgr, role: "group_manager" }, "x")).rejects.toThrow();
    const [p] = await pendingChanges(1);
    await expect(decideChange(1, p.id, "approved", mgr, "")).rejects.toThrow();
    await decideChange(1, p.id, "approved", own, "");
    expect(await limit()).toBe(2000);
    expect(await pendingChanges(1)).toHaveLength(0);
  });
});
