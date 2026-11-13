import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-expvoid-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { postExpense, voidExpense, expenseCategories } = await import("@/lib/repo/ledgerPostings");
const { expensesByCategory } = await import("@/lib/repo/reports");
const { recentExpenses } = await import("@/lib/repo/reports");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

async function expense(amount: number): Promise<number> {
  await getDb()
    .prepare(`INSERT INTO users (id, username, password_hash, display_name, role, organization_id, created_at) VALUES (1,'v','x','V','owner',1,'2026-01-01') ON CONFLICT DO NOTHING`)
    .run();
  const fuel = (await expenseCategories()).find((c) => c.code === "5102")!;
  return await postExpense(getDb(), { organizationId: 1, accountId: fuel.id, amountToman: amount, method: "CASH", incurredAt: new Date().toISOString(), incurredBy: 1, memo: "x" });
}

describe("void an expense (H6)", () => {
  it("nets the category to zero, hides the row, and refuses a second void", async () => {
    const id = await expense(500_000);
    const keep = await expense(200_000);
    await voidExpense(1, id, 1, "ثبت تکراری");
    const cats = await expensesByCategory(1);
    expect(cats.reduce((s, c) => s + Number(c.amountToman), 0)).toBe(200_000);
    const listed = (await recentExpenses(1, 20)).map((r) => r.journalId);
    expect(listed).toContain(keep);
    expect(listed).not.toContain(id);
    await expect(voidExpense(1, id, 1, "دوباره")).rejects.toThrow();
  });
  it("needs a reason and an expense of this company", async () => {
    const id = await expense(1000);
    await expect(voidExpense(1, id, 1, " ")).rejects.toThrow();
    await expect(voidExpense(2, id, 1, "x")).rejects.toThrow();
  });
});
