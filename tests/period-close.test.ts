import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mayClose } from "@/lib/periodClose";

const testDbPath = path.join(os.tmpdir(), `rf-pclose-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { closePeriod, reopenPeriod } = await import("@/lib/repo/periodClose");
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
});
