import { describe, it, expect } from "vitest";
import { closingLegs, yearCloseProblem } from "@/lib/yearClose";

process.env.ROUTEFLOW_DB_PATH = `/tmp/rf-year-close-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { postJournal, accountIdByCode } = await import("@/lib/repo/ledger");
const { closeYear, reopenYear } = await import("@/lib/repo/yearClose");
const { incomeStatement, balanceSheet } = await import("@/lib/repo/reports");
const { postExpense, expenseCategories } = await import("@/lib/repo/ledgerPostings");

describe("H2 close the year (pure)", () => {
  it("clears revenue and expenses into retained earnings, a loss on the debit side", () => {
    const legs = closingLegs([{ accountId: 1, type: "REVENUE", net: 100 }, { accountId: 2, type: "EXPENSE", net: -60 }], 9);
    expect(legs).toEqual([{ accountId: 1, side: "D", amountToman: 100 }, { accountId: 2, side: "C", amountToman: 60 }, { accountId: 9, side: "C", amountToman: 40 }]);
    expect(closingLegs([{ accountId: 2, type: "EXPENSE", net: -10 }], 9).at(-1)).toEqual({ accountId: 9, side: "D", amountToman: 10 });
    expect(closingLegs([], 9)).toEqual([]);
  });
  it("refuses the current and future years", () => {
    expect(yearCloseProblem(1405, 1405)).not.toBeNull();
    expect(yearCloseProblem(1404, 1405)).toBeNull();
  });
});

describe("H2 close the year (ledger)", () => {
  it("moves the profit, keeps reports honest, and can be undone with a reason", async () => {
    const db = getDb();
    await db.prepare(`INSERT INTO users (id, username, password_hash, display_name, role, organization_id, created_at) VALUES (1,'yc','x','Y','owner',1,'2026-01-01') ON CONFLICT DO NOTHING`).run();
    const cash = (await accountIdByCode("1101"))!;
    const revenue = (await accountIdByCode("4101"))!;
    const rent = (await expenseCategories()).find((c) => c.code === "5102")!;
    await postJournal(db, { organizationId: 1, postedAt: "2024-06-01T10:00:00.000Z", sourceType: "MANUAL", createdBy: 1, legs: [{ accountId: cash, side: "D", amountToman: 1000 }, { accountId: revenue, side: "C", amountToman: 1000 }] });
    await postExpense(db, { organizationId: 1, accountId: rent.id, amountToman: 400, method: "CASH", incurredAt: "2024-06-02T10:00:00.000Z", incurredBy: 1 });
    // 2024-06 is 1403
    const before = await incomeStatement(1, { periodKey: "1403" });
    expect(before.revenueToman).toBe(1000);
    await closeYear(1, 1403, 1);
    const after = await incomeStatement(1, { periodKey: "1403" });
    expect(after.revenueToman).toBe(1000);
    expect(after.totalExpensesToman).toBe(400);
    const bs = await balanceSheet(1, {});
    expect(bs.difference).toBe(0);
    expect(bs.equity.find((r) => r.code === "3103")?.amountToman).toBe(600);
    await expect(closeYear(1, 1403, 1)).rejects.toThrow(/قبلاً/);
    await expect(reopenYear(1, 1403, 1, " ")).rejects.toThrow(/دلیل/);
    await reopenYear(1, 1403, 1, "اشتباه");
    const back = await balanceSheet(1, {});
    expect(back.difference).toBe(0);
    expect(back.equity.find((r) => r.code === "3103")?.amountToman ?? 0).toBe(0);
    await closeYear(1, 1403, 1);
  });
});
