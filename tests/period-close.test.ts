import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mayClose, openRangeProblem } from "@/lib/periodClose";

const testDbPath = path.join(os.tmpdir(), `rf-pclose-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { closePeriod, reopenPeriod, closeChecklist, openRange } = await import("@/lib/repo/periodClose");
const { postExpense, expenseCategories } = await import("@/lib/repo/ledgerPostings");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("A2 close a month", () => {
  it("refuses the current month and bad keys", () => {
    expect(mayClose("1405-07", "1405-07")).not.toBeNull();
    expect(mayClose("1405-08", "1405-07")).not.toBeNull();
    expect(mayClose("1405-06", "1405-07")).toBeNull();
    expect(mayClose("x", "1405-07")).not.toBeNull();
  });

  it("a closed month refuses an entry; reopening needs a reason and lets it through", async () => {
    const db = getDb();
    await db.prepare(`INSERT INTO users (id, username, password_hash, display_name, role, organization_id, created_at) VALUES (1,'pcl','x','P','owner',1,'2026-01-01') ON CONFLICT DO NOTHING`).run();
    const rent = (await expenseCategories()).find((c) => c.code === "5102")!;
    const post = () => postExpense(db, { organizationId: 1, accountId: rent.id, amountToman: 1000, method: "CASH", incurredAt: "2026-01-10T10:00:00.000Z", incurredBy: 1 });
    await post();
    await closePeriod(1, "1404-10", 1);
    await expect(post()).rejects.toThrow(/بسته/);
    await expect(reopenPeriod(1, "1404-10", 1, "  ")).rejects.toThrow(/دلیل/);
    await reopenPeriod(1, "1404-10", 1, "اشتباه در ثبت");
    await post();
    await expect(reopenPeriod(1, "1404-10", 1, "دوباره")).rejects.toThrow(/بسته نیست/);
  });

  it("Z7: the checklist counts the month's expenses with no receipt or note", async () => {
    const db = getDb();
    const rent = (await expenseCategories()).find((c) => c.code === "5102")!;
    await postExpense(db, { organizationId: 1, accountId: rent.id, amountToman: 500, method: "CASH", incurredAt: "2026-02-10T10:00:00.000Z", incurredBy: 1 });
    // 2026-02-10 falls in Bahman 1404
    expect((await closeChecklist(1, "1404-11")).needsAttention).toBeGreaterThanOrEqual(1);
    expect((await closeChecklist(1, "1404-05")).needsAttention).toBe(0);
  });

  it("B2: opened days take entries, other days of the month stay closed", async () => {
    const db = getDb();
    const rent = (await expenseCategories()).find((c) => c.code === "5102")!;
    const post = (at: string) => postExpense(db, { organizationId: 1, accountId: rent.id, amountToman: 700, method: "CASH", incurredAt: at, incurredBy: 1 });
    await closePeriod(1, "1404-11", 1);
    await expect(openRange(1, "1404-11", 1, 3, 1, " ")).rejects.toThrow(/دلیل/);
    await openRange(1, "1404-11", 20, 22, 1, "رسید دیررس");
    // 1404-11-21 = 2026-02-10; 1404-11-25 = 2026-02-14
    await post("2026-02-10T10:00:00.000Z");
    await expect(post("2026-02-14T10:00:00.000Z")).rejects.toThrow(/بسته/);
  });

  it("B2: day numbers must sit inside the month, in order", () => {
    expect(openRangeProblem(1, 30, 30)).toBeNull();
    expect(openRangeProblem(0, 3, 30)).not.toBeNull();
    expect(openRangeProblem(5, 31, 30)).not.toBeNull();
    expect(openRangeProblem(9, 3, 30)).not.toBeNull();
  });
});
