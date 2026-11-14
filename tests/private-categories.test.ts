import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-privcat-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { postExpense, expenseCategories } = await import("@/lib/repo/ledgerPostings");
const { setCategoryPrivate, hiddenAccountIdsFor } = await import("@/lib/repo/privateCategories");
const { journalReport, expensesByEnterer } = await import("@/lib/repo/reports");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("Z11 private expense categories", () => {
  it("hides the private category's journals and totals from a group manager but not an owner", async () => {
    const db = getDb();
    await db.prepare(`INSERT INTO users (id, username, password_hash, display_name, role, organization_id, created_at) VALUES (1,'pc','x','P','owner',1,'2026-01-01') ON CONFLICT DO NOTHING`).run();
    const cats = await expenseCategories();
    const salary = cats.find((c) => c.code === "5103")!;
    const rent = cats.find((c) => c.code === "5102")!;
    const at = new Date().toISOString();
    const base = { organizationId: 1, method: "CASH", incurredAt: at, incurredBy: 1 };
    await postExpense(db, { ...base, accountId: salary.id, amountToman: 9_000_000 });
    await postExpense(db, { ...base, accountId: rent.id, amountToman: 1_000_000 });
    expect(await setCategoryPrivate(1, salary.id, true)).toBe(true);
    expect(await setCategoryPrivate(1, 999999, true)).toBe(false);
    expect(await hiddenAccountIdsFor("owner", 1)).toEqual([]);
    const hide = await hiddenAccountIdsFor("group_manager", 1);
    expect(hide).toEqual([salary.id]);
    expect((await journalReport(1, {})).rows.length).toBe(2);
    expect((await journalReport(1, { hideAccountIds: hide })).rows.length).toBe(1);
    const sum = (rows: unknown) => (rows as { amountToman: number }[]).reduce((s, r) => s + Number(r.amountToman), 0);
    expect(sum(await expensesByEnterer(1))).toBe(10_000_000);
    expect(sum(await expensesByEnterer(1, hide))).toBe(1_000_000);
  });
});
