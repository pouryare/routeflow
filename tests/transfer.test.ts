import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-transfer-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { postTransfer } = await import("@/lib/repo/ledgerPostings");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const legsOf = async (id: number) =>
  (await getDb().prepare("SELECT a.code, e.side, e.amount_toman AS amount FROM ledger_entries e JOIN accounts a ON a.id = e.account_id WHERE e.journal_id = ? ORDER BY a.code").all(id)) as unknown as { code: string; side: string; amount: number }[];

describe("A4 transfer between own accounts", () => {
  const base = { organizationId: 1, postedAt: "2026-06-01T12:00:00.000Z", by: 1 };
  it("moves the amount, and takes the fee from the source", async () => {
    await getDb().prepare(`INSERT INTO users (id, username, password_hash, display_name, role, organization_id, created_at) VALUES (1,'tr','x','T','owner',1,'2026-01-01') ON CONFLICT DO NOTHING`).run();
    const id = await postTransfer(getDb(), { ...base, from: "1101", to: "1102", amountToman: 5_000_000, feeToman: 2000, tracking: "8891" });
    expect((await legsOf(id)).map((l) => `${l.code}${l.side}${l.amount}`)).toEqual(["1101C5002000", "1102D5000000", "5106D2000"]);
    const memo = (await getDb().prepare("SELECT memo FROM journals WHERE id = ?").get(id)) as { memo: string };
    expect(memo.memo).toContain("8891");
  });
  it("refuses the same account, an unknown account and a bad amount", async () => {
    await expect(postTransfer(getDb(), { ...base, from: "1101", to: "1101", amountToman: 1 })).rejects.toThrow();
    await expect(postTransfer(getDb(), { ...base, from: "1101", to: "5106", amountToman: 1 })).rejects.toThrow();
    await expect(postTransfer(getDb(), { ...base, from: "1101", to: "1102", amountToman: 0 })).rejects.toThrow();
  });
});
