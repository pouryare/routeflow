import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-window-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { windowLabel } = await import("@/lib/deliveryWindow");
const { setDeliveryInstructions } = await import("@/lib/repo/deliveryInstructions");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

// 0 = شنبه … 4 = چهارشنبه. 2026-11-15 is a Sunday (یکشنبه), 2026-11-20 a Friday.
const HOURS = JSON.stringify([{ days: [0, 1, 2, 3, 4], from: "08:00", to: "14:00" }]);

describe("F57 window label", () => {
  it("names the hours on a working day, says closed on a day off, and is null with no hours", () => {
    expect(windowLabel(HOURS, "2026-11-15")).toContain("14:00".replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]));
    expect(windowLabel(HOURS, "2026-11-20")).toBe("جمعه بسته است");
    expect(windowLabel(null, "2026-11-15")).toBeNull();
    expect(windowLabel("not json", "2026-11-15")).toBeNull();
  });
});

describe("F69 standing instructions", () => {
  it("saves, trims, clears and refuses a long note", async () => {
    const id = Number((await getDb().prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('D1','x','RESTAURANT','active','2026-01-01',1)").run()).lastInsertRowid);
    expect(await setDeliveryInstructions(1, id, "  زنگ دوم  ")).toBeNull();
    expect(((await getDb().prepare("SELECT delivery_instructions AS t FROM customers WHERE id = ?").get(id)) as { t: string }).t).toBe("زنگ دوم");
    expect(await setDeliveryInstructions(1, id, "")).toBeNull();
    expect(((await getDb().prepare("SELECT delivery_instructions AS t FROM customers WHERE id = ?").get(id)) as { t: string | null }).t).toBeNull();
    expect(await setDeliveryInstructions(1, id, "x".repeat(201))).toMatch(/۲۰۰/);
    expect(await setDeliveryInstructions(1, 999999, "x")).toMatch(/پیدا/);
  });
});
