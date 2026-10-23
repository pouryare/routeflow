import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-ledger-exp-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { postExpense, expenseCategories, LedgerError } = await import(
  "@/lib/repo/ledgerPostings"
);
const { trialBalance } = await import("@/lib/repo/ledger");

const ORG = 1;

beforeAll(async () => {
  await getDb()
    .prepare(
      `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
       VALUES (?, 'exp-tester', 'x', 'Exp Tester', 'owner', ?, '2026-01-01')`
    )
    .run(1, ORG);
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const legsOf = async (journalId: number) =>
  await getDb()
    .prepare(
      `SELECT a.code, e.side, e.amount_toman AS amount FROM ledger_entries e
         JOIN accounts a ON a.id = e.account_id WHERE e.journal_id = ?`
    )
    .all(journalId) as { code: string; side: string; amount: number }[];

describe("expenses", () => {
  it("lists the manual expense categories and EXCLUDES COGS", async () => {
    const codes = (await expenseCategories()).map((c) => c.code);
    expect(codes).toContain("5102"); // اجاره
    expect(codes).toContain("5103"); // حقوق
    expect(codes).not.toContain("5101"); // COGS is posted by delivery, never by hand
    expect(codes).not.toContain("5000"); // a group header is not a category
  });

  it("never lists a deactivated category", async () => {
    const off = await getDb().prepare("SELECT id FROM accounts WHERE code = '5106'").get() as {
      id: number;
    };
    await getDb().prepare("UPDATE accounts SET active = 0 WHERE id = ?").run(off.id);
    try {
      expect((await expenseCategories()).map((c) => c.code)).not.toContain("5106");
    } finally {
      await getDb().prepare("UPDATE accounts SET active = 1 WHERE id = ?").run(off.id);
    }
  });

  it("posts Dr expense / Cr cash", async () => {
    const rent = (await expenseCategories()).find((c) => c.code === "5102")!;
    const journalId = await postExpense(getDb(), {
      organizationId: ORG,
      accountId: rent.id,
      amountToman: 25_000_000,
      method: "CASH",
      incurredAt: "2026-07-05T10:00:00.000Z",
      incurredBy: 1,
      memo: "اجاره ماه",
    });
    const legs = await legsOf(journalId);
    expect(legs.find((l) => l.code === "5102")).toMatchObject({ side: "D", amount: 25_000_000 });
    expect(legs.find((l) => l.code === "1101")).toMatchObject({ side: "C", amount: 25_000_000 });
  });

  it("records WHO entered it, not a constant", async () => {
    /* Two users, so hardcoding `created_by` to either one fails. My first version of this
       test posted everything as user 1, which meant a `createdBy: 1` mutation passed
       untouched -- the accountability trail was unproven while looking proven. A
       group_manager is exactly who this matters for. */
    await getDb()
      .prepare(
        `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
         VALUES (2, 'exp-tester-2', 'x', 'Second Tester', 'group_manager', ?, '2026-01-01')`
      )
      .run(ORG);
    const rent = (await expenseCategories()).find((c) => c.code === "5102")!;
    const journalId = await postExpense(getDb(), {
      organizationId: ORG,
      accountId: rent.id,
      amountToman: 1_000_000,
      method: "CASH",
      incurredAt: "2026-07-06T10:00:00.000Z",
      incurredBy: 2,
      memo: "اجاره با کارمند",
    });
    const row = await getDb()
      .prepare("SELECT created_by, memo FROM journals WHERE id = ?")
      .get(journalId) as { created_by: number; memo: string | null };
    expect(row.created_by).toBe(2);
    expect(row.memo).toBe("اجاره با کارمند");
  });

  it("refuses to post an expense to the COGS account by hand", async () => {
    const cogs = await getDb().prepare("SELECT id FROM accounts WHERE code = '5101'").get() as {
      id: number;
    };
    await expect((async () =>
      await postExpense(getDb(), {
        organizationId: ORG,
        accountId: cogs.id,
        amountToman: 1_000,
        method: "CASH",
        incurredAt: "2026-07-05T10:00:00.000Z",
        incurredBy: 1,
      }))()).rejects.toThrow(LedgerError);
  });

  it("refuses to post to a non-expense account", async () => {
    const cash = await getDb().prepare("SELECT id FROM accounts WHERE code = '1101'").get() as {
      id: number;
    };
    await expect((async () =>
      await postExpense(getDb(), {
        organizationId: ORG,
        accountId: cash.id,
        amountToman: 1_000,
        method: "CASH",
        incurredAt: "2026-07-05T10:00:00.000Z",
        incurredBy: 1,
      }))()).rejects.toThrow(LedgerError);
  });

  it("refuses to post to a group header", async () => {
    const header = await getDb().prepare("SELECT id FROM accounts WHERE code = '5000'").get() as {
      id: number;
    };
    await expect((async () =>
      await postExpense(getDb(), {
        organizationId: ORG,
        accountId: header.id,
        amountToman: 1_000,
        method: "CASH",
        incurredAt: "2026-07-05T10:00:00.000Z",
        incurredBy: 1,
      }))()).rejects.toThrow(LedgerError);
  });

  it("refuses CREDIT_NOTE rather than guessing where the money came from", async () => {
    const rent = (await expenseCategories()).find((c) => c.code === "5102")!;
    await expect((async () =>
      await postExpense(getDb(), {
        organizationId: ORG,
        accountId: rent.id,
        amountToman: 1_000,
        method: "CREDIT_NOTE",
        incurredAt: "2026-07-05T10:00:00.000Z",
        incurredBy: 1,
      }))()).rejects.toThrow(LedgerError);
  });

  it("keeps the ledger balanced", async () => {
    const tb = await trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
});
