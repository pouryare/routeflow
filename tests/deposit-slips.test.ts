import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-slip-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { depositCheques, slipView } = await import("@/lib/repo/depositSlips");
afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("D2 deposit slips", () => {
  it("numbers slips per company, moves the cheques together, and refuses one already deposited", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('ds','x','d','owner',?,1)").run(now)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('D1','ف','active',?,1)").run(now)).lastInsertRowid);
    const mk = async (no: string, amount: number) =>
      Number((await db.prepare("INSERT INTO cheques (organization_id,customer_id,amount_toman,cheque_no,due_date,status,received_at,received_by,created_at,updated_at) VALUES (1,?,?,?,'2026-09-01','in_hand',?,?,?,?)").run(cust, amount, no, now, user, now, now)).lastInsertRowid);
    const a = await mk("101", 1000);
    const b = await mk("102", 2500);
    const c = await mk("103", 700);
    const first = await depositCheques(1, [a, b], user);
    const view = await slipView(1, first);
    expect(view?.slipNo).toBe(1);
    expect(view?.total).toBe(3500);
    expect(view?.cheques.map((x) => x.chequeNo)).toEqual(["101", "102"]);
    expect(((await db.prepare("SELECT status FROM cheques WHERE id = ?").get(a)) as { status: string }).status).toBe("deposited");
    await expect(depositCheques(1, [a, c], user)).rejects.toThrow();
    expect(((await db.prepare("SELECT status FROM cheques WHERE id = ?").get(c)) as { status: string }).status).toBe("in_hand");
    const second = await depositCheques(1, [c], user);
    expect((await slipView(1, second))?.slipNo).toBe(2);
    expect(await slipView(2, first)).toBeNull();
  });
});
