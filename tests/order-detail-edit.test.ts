import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-odetail-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { checkDetail } = await import("@/lib/orderEdits");
const { editRule } = await import("@/lib/orderEditRules");
const { changeOrderDetail } = await import("@/lib/repo/orderEdits");
const { decideChange, pendingChanges, pendingChangeCount } = await import("@/lib/repo/changeRequests");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("F48 + F73 order detail rules", () => {
  it("allows confirmed, unfinished orders only", () => {
    expect(editRule("detail", "CONFIRMED").ok).toBe(true);
    expect(editRule("detail", "DRAFT").ok).toBe(false);
    expect(editRule("detail", "DELIVERED").ok).toBe(false);
  });
  it("checks dates and text", () => {
    expect(checkDetail("due_date", "2026-12-01")).toEqual({ ok: true, value: "2026-12-01" });
    expect(checkDetail("due_date", "12/01")).toMatchObject({ ok: false });
    expect(checkDetail("notes", "  ")).toMatchObject({ ok: false });
    expect(checkDetail("ship_address", "x".repeat(301))).toMatchObject({ ok: false });
  });
});

describe("F48 + F73 changing a confirmed order", () => {
  it("applies the owner's change at once, holds a manager's for the owner, writes the timeline and lets requests lapse", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const mk = async (u: string, role: string) => Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,'x',?,?,1,?,1)").run(u, u, role, now)).lastInsertRowid);
    const mgr = await mk("odm", "group_manager");
    const own = await mk("odo", "owner");
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('OD','ف','active',?,1)").run(now)).lastInsertRowid);
    const order = Number((await db.prepare("INSERT INTO orders (order_no,customer_id,order_date,status,created_by,created_at,updated_at,organization_id,notes) VALUES ('OD-1',?,'2026-11-01','CONFIRMED',?,?,?,1,'قدیمی')").run(cust, own, now, now)).lastInsertRowid);
    const notes = async () => ((await db.prepare("SELECT notes FROM orders WHERE id = ?").get(order)) as { notes: string }).notes;

    expect(await changeOrderDetail(1, order, "notes", "تازه", { id: own, role: "owner" }, "مشتری خواست")).toBe("applied");
    expect(await notes()).toBe("تازه");
    const ev = (await db.prepare("SELECT action, note FROM order_events WHERE order_id = ?").all(order)) as { action: string; note: string }[];
    expect(ev).toEqual([{ action: "edit", note: "یادداشت: قدیمی ← تازه · دلیل: مشتری خواست" }]);

    await expect(changeOrderDetail(1, order, "notes", "تازه", { id: own, role: "owner" }, "x")).rejects.toThrow(/یکی/);
    await expect(changeOrderDetail(1, order, "notes", "دیگر", { id: own, role: "owner" }, " ")).rejects.toThrow(/دلیل/);

    expect(await changeOrderDetail(1, order, "notes", "با تأیید", { id: mgr, role: "group_manager" }, "درخواست مشتری")).toBe("pending");
    expect(await notes()).toBe("تازه");
    await expect(changeOrderDetail(1, order, "notes", "دوباره", { id: mgr, role: "group_manager" }, "x")).rejects.toThrow(/در انتظار/);
    expect(await pendingChangeCount(1)).toBe(1);
    const [p] = await pendingChanges(1);
    expect(p).toMatchObject({ kind: "order_edit", field_label: "یادداشت", old_text: "تازه", new_text: "با تأیید", order_no: "OD-1" });
    await expect(decideChange(1, p.id, "approved", mgr, "")).rejects.toThrow(); // not their own
    await decideChange(1, p.id, "approved", own, "");
    expect(await notes()).toBe("با تأیید");
    const last = (await db.prepare("SELECT note FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT 1").get(order)) as { note: string };
    expect(last.note).toMatch(/درخواست odm/);

    // An unanswered request lapses after 3 days and can be asked again.
    expect(await changeOrderDetail(1, order, "notes", "یکی دیگر", { id: mgr, role: "group_manager" }, "باز هم")).toBe("pending");
    await db.prepare("UPDATE change_requests SET requested_at = ? WHERE status = 'pending'").run(new Date(Date.now() - 4 * 86_400_000).toISOString());
    expect(await pendingChanges(1)).toHaveLength(0);
    expect(await changeOrderDetail(1, order, "notes", "یکی دیگر", { id: mgr, role: "group_manager" }, "باز هم")).toBe("pending");

    // A finished order cannot be edited.
    await db.prepare("UPDATE orders SET status = 'DELIVERED' WHERE id = ?").run(order);
    await expect(changeOrderDetail(1, order, "notes", "دیر", { id: own, role: "owner" }, "x")).rejects.toThrow(/بسته/);
  });
});
