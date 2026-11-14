import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-arrivals-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { arrivalsDue } = await import("@/lib/purchaseOrders");
const { createPurchaseOrder, scheduleArrival, expectedArrivals } = await import("@/lib/repo/purchaseOrders");
const { createProduct } = await import("@/lib/catalogue");
const { tehranTodayIso } = await import("@/lib/jalali");
const { addDaysIso } = await import("@/lib/flows/dates");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("arrivalsDue", () => {
  it("keeps what is due by the cut-off, in day then slot order, no slot last", () => {
    const o = (d: string | null, s: "morning" | "afternoon" | null, id: number) => ({ id, expected_date: d, expected_slot: s });
    const out = arrivalsDue([o("2026-11-20", null, 1), o("2026-11-14", "afternoon", 2), o("2026-11-14", "morning", 3), o("2026-11-30", null, 4), o(null, null, 5), o("2026-11-14", null, 6)], "2026-11-21");
    expect(out.map((x) => x.id)).toEqual([3, 2, 6, 1]);
  });
});

describe("scheduling a delivery", () => {
  it("sets day and slot on an open order and shows it in the week's list", async () => {
    const db = getDb();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('ar-o','x:y','م','owner',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
    const supplier = Number((await db.prepare("INSERT INTO suppliers (name, organization_id, created_at) VALUES ('تأمین', 1, ?)").run(new Date().toISOString())).lastInsertRowid);
    const product = await createProduct(db, { name: "کره", kg_per_base_unit: 1, organization_id: 1 });
    const id = await createPurchaseOrder(1, { supplier_id: supplier, expected_date: null, created_by: user, send: true, lines: [{ product_id: product, base_qty: 10, unit_cost_toman: 1000 }] });
    const today = tehranTodayIso();
    expect(await scheduleArrival(1, id, addDaysIso(today, -1), null)).toMatch(/امروز/);
    expect(await scheduleArrival(1, id, addDaysIso(today, 2), "morning")).toBeNull();
    const list = await expectedArrivals(1, today);
    expect(list.map((r) => [r.id, r.expected_slot])).toEqual([[id, "morning"]]);
    expect(await scheduleArrival(1, 999999, today, null)).toMatch(/پیدا/);
  });
});
