import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-hand-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { holdings, confirmHandover } = await import("@/lib/repo/cashInHand");
afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("D1 cash in hand", () => {
  it("counts a person's cash since the last count, asks a reason for a gap, and starts over after", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const mkUser = async (u: string, role: string) => Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,'x',?,?,?,1)").run(u, u, role, now)).lastInsertRowid);
    const rep = await mkUser("hr", "field_rep");
    const owner = await mkUser("ho", "owner");
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('H1','ف','active',?,1)").run(now)).lastInsertRowid);
    const pay = async (amount: number, at: string, method = "CASH", by = rep) =>
      db.prepare("INSERT INTO payments (organization_id,customer_id,amount_toman,method,received_at,received_by,created_at,in_hand) VALUES (1,?,?,?,?,?,?,?)").run(cust, amount, method, at, by, now, method === "CASH" && by === rep ? 1 : 0);
    await pay(1000, "2026-09-01T08:00:00.000Z");
    await pay(500, "2026-09-01T09:00:00.000Z");
    await pay(900, "2026-09-01T09:30:00.000Z", "CARD_TO_CARD");
    await pay(700, "2026-09-01T10:00:00.000Z", "CASH", owner);
    const [h] = await holdings(1);
    expect([h.name, h.amount, h.count]).toEqual(["hr", 1500, 2]);
    await expect(confirmHandover(1, rep, h.through, 1400, "", owner)).rejects.toThrow();
    await confirmHandover(1, rep, h.through, 1400, "پول خرد نبود", owner);
    expect(await holdings(1)).toEqual([]);
    await pay(300, "2026-09-02T08:00:00.000Z");
    const [h2] = await holdings(1);
    expect(h2.amount).toBe(300);
    await confirmHandover(1, rep, h2.through, 300, "", owner);
  });
});
