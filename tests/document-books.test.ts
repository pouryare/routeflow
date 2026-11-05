import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-doc-books-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { recordPayment, voidPayment } = await import("@/lib/repo/payments");
const { booksFor } = await import("@/lib/repo/documentBooks");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("books behind a document (B3)", () => {
  it("shows a payment's receipt journal and its reversal, and nothing to another company", async () => {
    const db = getDb();
    const at = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at, organization_id) VALUES ('o','x','م','owner',?,1)").run(at)).lastInsertRowid);
    const cust = Number((await db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('c','x',?,1)").run(at)).lastInsertRowid);
    const pay = await recordPayment(1, { customer_id: cust, amount_toman: 250000, method: "CASH", received_at: at, received_by: user } as never);

    const before = await booksFor(1, "payment", pay);
    expect(before).toHaveLength(1);
    expect(before[0].legs.map((l) => [l.code, l.side, l.amountToman])).toEqual([["1101", "D", 250000], ["1201", "C", 250000]]);

    await voidPayment(1, pay, user, "اشتباه");
    const after = await booksFor(1, "payment", pay);
    expect(after.map((j) => j.sourceType)).toEqual(["PAYMENT", "REVERSAL"]);
    expect(after[1].reverses).toBe(after[0].journalId);
    expect(await booksFor(2, "payment", pay)).toEqual([]);
  });
});
