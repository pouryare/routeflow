import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-money-tiles-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { moneyTilesFor } = await import("@/lib/repo/moneyTiles");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("owner money tiles (A7)", () => {
  it("counts what customers owe with the overdue part, and only cheques due within 7 days", async () => {
    const db = getDb();
    const at = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at, organization_id) VALUES ('o','x','م','owner',?,1)").run(at)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id, opening_balance_toman) VALUES ('c','x',?,1,500000)").run(at)).lastInsertRowid);
    const cheque = (no: string, due: string, status: string) =>
      db.prepare("INSERT INTO cheques (organization_id, customer_id, cheque_no, amount_toman, due_date, status, received_at, received_by, created_at, updated_at) VALUES (1,?,?,100000,?,?,?,?,?,?)").run(cust, no, due, status, at, user, at, at);
    await cheque("1", "2026-11-07", "in_hand");
    await cheque("2", "2026-11-20", "in_hand");
    await cheque("3", "2026-11-06", "cleared");

    const t = await moneyTilesFor(1, "2026-11-05");
    expect(t.owedToUs).toEqual({ total: 500000, overdue: 500000 });
    expect(t.chequesThisWeek).toEqual({ n: 1, total: 100000 });
    expect(t.cash.balance).toBe(0);
  });
});
