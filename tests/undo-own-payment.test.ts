import { describe, it, expect } from "vitest";
import { withinUndoWindow } from "@/lib/undoWindow";

process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { recordPayment, selfVoidProblem } = await import("@/lib/repo/payments");

describe("E5 undo window (pure)", () => {
  const t = Date.parse("2026-11-13T10:00:00.000Z");
  it("allows the taker inside the window only, and never when the window is 0", () => {
    expect(withinUndoWindow("2026-11-13T10:00:00.000Z", t + 14 * 60_000, 15)).toBe(true);
    expect(withinUndoWindow("2026-11-13T10:00:00.000Z", t + 16 * 60_000, 15)).toBe(false);
    expect(withinUndoWindow("2026-11-13T10:00:00.000Z", t + 60_000, 0)).toBe(false);
    expect(withinUndoWindow("garbage", t, 15)).toBe(false);
  });
});

describe("E5 undo your own payment", () => {
  it("lets the taker void a fresh cash payment, refuses others, old ones, and cheques", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'phone_sales',NULL,1,?,1)");
    const me = Number((await u.run("e5-me", "x", "من", now)).lastInsertRowid);
    const other = Number((await u.run("e5-other", "x", "دیگری", now)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('E5C','x','RESTAURANT','active','2026-01-01',1)").run()).lastInsertRowid);
    const today = now.slice(0, 10);
    const pay = (method: string) => recordPayment(1, { customer_id: cust, amount_toman: 1000, method: method as "CASH", received_at: today, received_by: me });
    const id = await pay("CASH");
    expect(await selfVoidProblem(1, id, me)).toBeNull();
    expect(await selfVoidProblem(1, id, other)).toMatch(/مدیر/);
    await db.prepare("UPDATE payments SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 30 * 60_000).toISOString(), id);
    expect(await selfVoidProblem(1, id, me)).toMatch(/مدیر/);
    await db.prepare("UPDATE organizations SET undo_own_minutes = 60 WHERE id = 1").run();
    expect(await selfVoidProblem(1, id, me)).toBeNull();
    await db.prepare("UPDATE payments SET method = 'CHEQUE' WHERE id = ?").run(id);
    expect(await selfVoidProblem(1, id, me)).toMatch(/مدیر/);
  });
});
