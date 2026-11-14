import { describe, it, expect, beforeAll } from "vitest";
import { advanceProblem, deductionProblem, loanBalance, loanReminderDue } from "@/lib/staffLoans";

process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const l = await import("@/lib/repo/staffLoans");
const c = await import("@/lib/repo/expenseClaims");
const { expenseCategories } = await import("@/lib/repo/ledgerPostings");

describe("staff loan rules (pure)", () => {
  it("one balance: advances add, deductions, repayments and write-offs subtract", () => {
    expect(loanBalance([{ kind: "advance", amountToman: 3000 }, { kind: "deduction", amountToman: 400 }, { kind: "repayment", amountToman: 100 }, { kind: "writeoff", amountToman: 500 }])).toBe(2000);
  });
  it("refuses a bad amount, a switched-off limit and a balance over the limit", () => {
    expect(advanceProblem({ amountToman: 0, balanceToman: 0, limitToman: 100 })).toMatch(/مبلغ/);
    expect(advanceProblem({ amountToman: 50, balanceToman: 0, limitToman: 0 })).toMatch(/خاموش/);
    expect(advanceProblem({ amountToman: 60, balanceToman: 50, limitToman: 100 })).toMatch(/سقف/);
    expect(advanceProblem({ amountToman: 50, balanceToman: 50, limitToman: 100 })).toBeNull();
  });
  it("a deduction cannot pass what is owed to the person or what they owe", () => {
    expect(deductionProblem({ deductToman: 10, owedToman: 5, balanceToman: 100 })).toMatch(/پرداخت/);
    expect(deductionProblem({ deductToman: 10, owedToman: 50, balanceToman: 5 })).toMatch(/وام/);
    expect(deductionProblem({ deductToman: 5, owedToman: 50, balanceToman: 5 })).toBeNull();
  });
  it("reminds only a person who owes and has not paid back for the set days", () => {
    const now = Date.parse("2026-11-13T00:00:00Z");
    expect(loanReminderDue(100, "2026-09-01T00:00:00Z", now, 60)).toBe(true);
    expect(loanReminderDue(100, "2026-11-01T00:00:00Z", now, 60)).toBe(false);
    expect(loanReminderDue(0, "2026-01-01T00:00:00Z", now, 60)).toBe(false);
  });
});

describe("staff advances and loans (ledger)", () => {
  let owner = 0, gm = 0, ali = 0, other = 0, gid = 0, fuel = 0;
  const who = (role: string, userId: number, groupId: number | null) => ({ role, organizationId: 1, userId, groupId });
  beforeAll(async () => {
    const db = getDb();
    const now = new Date().toISOString();
    gid = Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('ln-g','ln-g',?,1)").run(now)).lastInsertRowid);
    const g2 = Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('ln-g2','ln-g2',?,1)").run(now)).lastInsertRowid);
    const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)");
    owner = Number((await u.run("ln-o", "x", "مالک", "owner", null, now)).lastInsertRowid);
    gm = Number((await u.run("ln-gm", "x", "مدیر", "group_manager", gid, now)).lastInsertRowid);
    ali = Number((await u.run("ln-a", "x", "علی", "delivery_driver", gid, now)).lastInsertRowid);
    other = Number((await u.run("ln-b", "x", "بابک", "delivery_driver", g2, now)).lastInsertRowid);
    fuel = (await expenseCategories()).find((x) => x.code === "5104")!.id;
  });

  it("owner gives, the limit holds, a manager asks and the owner approves, history shows each step", async () => {
    await expect(l.giveAdvance(1, owner, { userId: ali, amountToman: 6_000_000, method: "CASH" })).rejects.toThrow(/سقف/);
    await l.giveAdvance(1, owner, { userId: ali, amountToman: 3_000_000, method: "CASH", note: "اجاره", monthlyHint: 500_000 });
    expect(await l.loanBalanceOf(1, ali)).toBe(3_000_000);
    await expect(l.requestAdvance({ organizationId: 1, userId: gm, groupId: gid }, { userId: other, amountToman: 100 })).rejects.toThrow(/گروه خودتان/);
    await expect(l.requestAdvance({ organizationId: 1, userId: gm, groupId: gid }, { userId: gm, amountToman: 100 })).rejects.toThrow(/خودتان/);
    const reqId = await l.requestAdvance({ organizationId: 1, userId: gm, groupId: gid }, { userId: ali, amountToman: 1_000_000 });
    expect((await l.pendingAdvanceRequests(1)).map((r) => r.id)).toContain(reqId);
    await l.decideAdvanceRequest(1, owner, reqId, { verdict: "approve", method: "TRANSFER" });
    expect(await l.loanBalanceOf(1, ali)).toBe(4_000_000);
    await expect(l.decideAdvanceRequest(1, owner, reqId, { verdict: "approve", method: "CASH" })).rejects.toThrow(/قبلاً/);
    const people = await l.loanPeople(1);
    expect(people.find((p) => p.userId === ali)).toMatchObject({ balanceToman: 4_000_000, monthlyHint: 500_000 });
    expect((await l.loanEntries(1, ali)).map((e) => e.kind)).toEqual(["advance", "advance"]);
  });

  it("paying approved claims can deduct part of the loan; cash paid is the rest", async () => {
    const id = await c.submitClaim({ organizationId: 1, userId: ali, groupId: gid }, { account_id: fuel, amount_toman: 1_000_000 });
    await c.decideClaim(who("owner", owner, null), id, "approve");
    await expect(c.repayStaff(1, ali, "CASH", owner, 2_000_000)).rejects.toThrow(/بیشتر/);
    await c.repayStaff(1, ali, "CASH", owner, 400_000);
    expect(await l.loanBalanceOf(1, ali)).toBe(3_600_000);
    const cash = (await getDb().prepare("SELECT e.side, e.amount_toman AS amount, a.code FROM ledger_entries e JOIN accounts a ON a.id = e.account_id JOIN staff_loan_entries s ON s.journal_id = e.journal_id WHERE s.kind = 'deduction' AND s.user_id = ?").all(ali)) as { side: string; amount: number; code: string }[];
    expect(cash.map((r) => `${r.code}${r.side}${Number(r.amount)}`).sort()).toEqual(["1101C600000", "1105C400000", "2107D1000000"]);
  });

  it("the person brings cash back, the owner forgives the rest with a reason", async () => {
    await expect(l.recordLoanRepayment(1, owner, { userId: ali, amountToman: 9_000_000, method: "CASH" })).rejects.toThrow(/بیشتر/);
    await l.recordLoanRepayment(1, owner, { userId: ali, amountToman: 600_000, method: "CASH" });
    expect(await l.loanBalanceOf(1, ali)).toBe(3_000_000);
    await expect(l.writeOffLoan(1, owner, { userId: ali, amountToman: 100, reason: " " })).rejects.toThrow(/دلیل/);
    await l.writeOffLoan(1, owner, { userId: ali, amountToman: 3_000_000, reason: "بخشش" });
    expect(await l.loanBalanceOf(1, ali)).toBe(0);
    const expense = (await getDb().prepare("SELECT a.code FROM ledger_entries e JOIN accounts a ON a.id = e.account_id JOIN staff_loan_entries s ON s.journal_id = e.journal_id WHERE s.kind = 'writeoff' AND s.user_id = ? AND e.side = 'D'").get(ali)) as { code: string };
    expect(expense.code).toBe("5110");
  });

  it("a loan with no repayment for the reminder days is flagged", async () => {
    await l.giveAdvance(1, owner, { userId: other, amountToman: 100_000, method: "CASH" });
    expect((await l.loanPeople(1)).find((p) => p.userId === other)!.reminderDue).toBe(false);
    await getDb().prepare("UPDATE staff_loan_entries SET created_at = ? WHERE user_id = ?").run(new Date(Date.now() - 90 * 86_400_000).toISOString(), other);
    expect((await l.loanPeople(1)).find((p) => p.userId === other)!.reminderDue).toBe(true);
    expect(await l.loanRemindersCount(1)).toBe(1);
    expect((await l.loanPickList({ organizationId: 1, role: "group_manager", userId: gm, groupId: gid })).map((p) => p.id)).toEqual([String(ali)]);
  });
});
