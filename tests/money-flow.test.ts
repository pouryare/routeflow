import { describe, it, expect } from "vitest";
import { monthSoFar, splitMoney } from "@/lib/moneyFlow";

process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { postJournal, accountIdByCode } = await import("@/lib/repo/ledger");
const { moneyFlow } = await import("@/lib/repo/moneyFlow");

describe("Z20 month so far", () => {
  it("guesses the month end from the pace so far", () => {
    expect(monthSoFar(10, 30, 6000)).toEqual({ share: 1 / 3, guess: 18000 });
    expect(monthSoFar(40, 30, 100).share).toBe(1);
  });
});

describe("A5 money in and out", () => {
  it("splits signed rows, drops a move between own accounts, closes at opening plus in minus out", () => {
    const f = splitMoney(1000, [{ label: "دریافت", net: 900 }, { label: "خرید", net: -300 }, { label: "انتقال", net: 0 }, { label: "اجاره", net: -200 }]);
    expect(f.inRows.map((r) => r.label)).toEqual(["دریافت"]);
    expect(f.outRows.map((r) => r.label)).toEqual(["خرید", "اجاره"]);
    expect(f.closing).toBe(1400);
  });

  it("reads a month of the ledger: a transfer nets out, a receipt and an expense show", async () => {
    const db = getDb();
    await db.prepare(`INSERT INTO users (id, username, password_hash, display_name, role, organization_id, created_at) VALUES (1,'mf','x','M','owner',1,'2026-01-01') ON CONFLICT DO NOTHING`).run();
    const cash = (await accountIdByCode("1101"))!;
    const bank = (await accountIdByCode("1102"))!;
    const revenue = (await accountIdByCode("4101"))!;
    // 2024-06-05 is in 1403-03
    await postJournal(db, { organizationId: 1, postedAt: "2024-06-05T10:00:00.000Z", sourceType: "MANUAL", createdBy: 1, legs: [{ accountId: cash, side: "D", amountToman: 500 }, { accountId: revenue, side: "C", amountToman: 500 }] });
    await postJournal(db, { organizationId: 1, postedAt: "2024-06-06T10:00:00.000Z", sourceType: "MANUAL", createdBy: 1, legs: [{ accountId: bank, side: "D", amountToman: 200 }, { accountId: cash, side: "C", amountToman: 200 }] });
    const f = await moneyFlow(1, "1403-03");
    expect(f.opening).toBe(0);
    expect(f.totalIn).toBe(500);
    expect(f.closing).toBe(500);
    expect((await moneyFlow(1, "1403-04")).opening).toBe(500);
  });
});
