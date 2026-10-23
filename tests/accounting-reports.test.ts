import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-acct-reports-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { trialBalance, postJournalIn, accountIdByCode } = await import("@/lib/repo/ledger");
const R = await import("@/lib/repo/reports");
const { createSupplier } = await import("@/lib/repo/suppliers");
const { postSupplierPayment } = await import("@/lib/repo/ledgerPostings");

const ORG = 1;
let customerId = 0;
let supplierId = 0;

beforeAll(async () => {
  const db = getDb();
  for (const [id, name, role] of [
    [1, "Rep", "owner"],
    [2, "Manager", "group_manager"],
  ] as const) {
    await db.prepare(
      `INSERT INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
       VALUES (?, ?, 'x', ?, ?, ?, '2026-01-01') ON CONFLICT DO NOTHING`
    ).run(id, `u${id}`, name, role, ORG);
  }
  customerId = Number(
    (await db
      .prepare(
        "INSERT INTO customers (business_name, customer_code, organization_id, lifecycle, synced_at) VALUES ('گزارش','C-RPT',?,'active','2026-01-01')"
      )
      .run(ORG)).lastInsertRowid
  );
  supplierId = await createSupplier(ORG, { name: "تأمین‌کننده گزارش", createdBy: 1 });
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/** A sale recognised WITH cost, or with revenue alone when `cost` is null. */
const sale = async (revenue: number, cost: number | null, postedAt: string) =>
  await postJournalIn({
    organizationId: ORG,
    postedAt,
    sourceType: "SALE",
    createdBy: 1,
    legs: [
      { accountId: (await accountIdByCode("1201"))!, side: "D", amountToman: revenue, customerId },
      { accountId: (await accountIdByCode("4101"))!, side: "C", amountToman: revenue },
      // `as const`: without it the spread widens `side` to string, which is not LedgerSide.
      // tsc caught this while all 14 tests passed -- the third time in this project.
      ...(cost !== null
        ? ([
            { accountId: (await accountIdByCode("5101"))!, side: "D", amountToman: cost },
            { accountId: (await accountIdByCode("1203"))!, side: "C", amountToman: cost },
          ] as const)
        : []),
    ],
  });

describe("accounting reports", () => {
  it("honesty 2: costComplete is FALSE when a sale recognised revenue with no cost", async () => {
    await sale(1_000_000, 600_000, "2026-07-01T10:00:00.000Z"); // with cost
    await sale(2_000_000, null, "2026-07-02T10:00:00.000Z"); // revenue alone
    const is = await R.incomeStatement(ORG, { periodKey: "1405-04" });
    expect(is.revenueToman).toBe(3_000_000);
    expect(is.cogsToman).toBe(600_000);
    // The gross margin is flattering, and the report must SAY so rather than let the number
    // imply a precision it does not have.
    expect(is.costComplete).toBe(false);
  });

  it("honesty 2: costComplete is TRUE when every sale carried a cost", async () => {
    await sale(4_000_000, 3_000_000, "2026-09-01T10:00:00.000Z");
    const is = await R.incomeStatement(ORG, { periodKey: "1405-06" });
    expect(is.revenueToman).toBe(4_000_000);
    expect(is.costComplete).toBe(true);
  });

  it("counts COGS once, not twice: expenses exclude it", async () => {
    const is = await R.incomeStatement(ORG, { periodKey: "1405-06" });
    expect(is.expenses.map((e) => e.code)).not.toContain("5101");
    for (const e of is.expenses) expect(e.accountId, e.code).toBeGreaterThan(0);
    expect(is.netProfitToman).toBe(is.revenueToman - is.cogsToman - is.totalExpensesToman);
  });

  it("honesty 1: the journal report says WHICH journals were reversed", async () => {
    const original = await sale(5_000_000, null, "2026-09-05T10:00:00.000Z");
    await postJournalIn({
      organizationId: ORG,
      postedAt: "2026-09-06T10:00:00.000Z",
      sourceType: "REVERSAL",
      sourceId: original,
      reversesJournalId: original,
      createdBy: 2,
      memo: "ابطال: اشتباه",
      legs: [
        { accountId: (await accountIdByCode("1201"))!, side: "C", amountToman: 5_000_000 },
        { accountId: (await accountIdByCode("4101"))!, side: "D", amountToman: 5_000_000 },
      ],
    });
    /* UNFILTERED: the reversal is a REVERSAL row, so filtering to SALE would exclude the very
       row this test is looking for -- my first version did exactly that. */
    const jr = await R.journalReport(ORG);
    const row = jr.rows.find((r) => r.journalId === original)!;
    expect(row.reversedByJournalId).not.toBeNull();
    expect(row.reversedByJournalId).not.toBe(original);
    expect(jr.rows.find((r) => r.reversesJournalId === original)!.reversesJournalId).toBe(original);
    // A real payment is NOT mistaken for a correction of an identical one.
    const twin = await sale(5_000_000, null, "2026-09-07T10:00:00.000Z");
    expect((await R.journalReport(ORG)).rows.find((r) => r.journalId === twin)!.reversedByJournalId).toBeNull();
  });

  it("honesty 3: a CLOSED period stays readable, and names who closed it", async () => {
    await getDb()
      .prepare(
        `INSERT INTO fiscal_periods (organization_id, period_key, status, closed_at, closed_by, created_at)
         VALUES (?, '1399-01', 'closed', '2026-01-01', 1, '2026-01-01') ON CONFLICT DO NOTHING`
      )
      .run(ORG);
    const closed = (await R.listPeriods(ORG)).find((p) => p.periodKey === "1399-01")!;
    expect(closed.status).toBe("closed");
    expect(closed.closedByName).toBe("Rep");
  });

  it("the balance sheet balances, and exposes the difference rather than absorbing it", async () => {
    const bs = await R.balanceSheet(ORG);
    expect(bs.difference).toBe(0);
    expect(bs.totals.assets).toBeGreaterThan(0);
  });

  it("every balance-sheet account line names its account, so the screen can open its ledger", async () => {
    const bs = await R.balanceSheet(ORG);
    for (const r of [...bs.assets, ...bs.liabilities]) expect(r.accountId, r.code).toBeGreaterThan(0);
    // Only the derived earnings line (3900) may lack one: no account sits behind it.
    for (const r of bs.equity) if (r.code !== "3900") expect(r.accountId, r.code).toBeGreaterThan(0);
  });

  it("reports a NON-ZERO difference when a ledger is broken -- it is not hardcoded to 0", async () => {
    /* Every other fixture here balances, so `difference: 0` was indistinguishable from
       "difference is hardcoded to 0" -- M37 passed. A guard that only ever sees the happy
       path is not a guard.

       The breakage goes in ORG 2, deliberately. A one-sided journal cannot be REPAIRED --
       postJournal needs two legs, and a reversal of a debit with no matching credit would
       itself be unbalanced -- so breaking ORG 1 would have poisoned the trial-balance
       assertion later in this file. Tenant isolation is what makes the test safe. */
    const db = getDb();
    await db.prepare(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Second', 'second', '2026-01-01') ON CONFLICT DO NOTHING"
    ).run();
    await db.prepare(
      `INSERT INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
       VALUES (3, 'u3', 'x', 'Third', 'owner', 2, 'x') ON CONFLICT DO NOTHING`
    ).run();
    const j = Number(
      (await db
        .prepare(
          `INSERT INTO journals (organization_id, seq, posted_at, period_key, memo, source_type, created_by, created_at)
           VALUES (2, 9001, '2026-09-30T10:00:00.000Z', '1405-06', 'broken', 'MANUAL', 3, 'x')`
        )
        .run()).lastInsertRowid
    );
    await db.prepare(
      `INSERT INTO ledger_entries (organization_id, journal_id, account_id, side, amount_toman, created_at)
       VALUES (2, ?, ?, 'D', 12345, 'x')`
    ).run(j, (await accountIdByCode("1101"))!);

    expect((await R.balanceSheet(2)).difference).toBe(12_345); // visible, not absorbed
    // And ORG 1 is untouched by another tenant's broken books.
    expect((await R.balanceSheet(ORG)).difference).toBe(0);
  });

  it("the balance sheet is a MOMENT: an as-at date excludes later entries", async () => {
    const early = await R.balanceSheet(ORG, { onDate: "2026-07-03T00:00:00.000Z" });
    const all = await R.balanceSheet(ORG);
    expect(early.totals.assets).toBeLessThan(all.totals.assets);
    expect(early.difference).toBe(0);
  });

  it("payables are DERIVED: paying down moves the balance and nothing is stored", async () => {
    await postJournalIn({
      organizationId: ORG,
      postedAt: "2026-09-10T10:00:00.000Z",
      sourceType: "PURCHASE",
      createdBy: 1,
      legs: [
        { accountId: (await accountIdByCode("1203"))!, side: "D", amountToman: 800_000 },
        {
          accountId: (await accountIdByCode("2101"))!,
          side: "C",
          amountToman: 800_000,
          supplierId,
        },
      ],
    });
    expect((await R.agedPayables(ORG)).find((r) => r.supplierId === supplierId)!.balanceToman).toBe(800_000);
    await postSupplierPayment(getDb(), {
      organizationId: ORG,
      supplierId,
      amountToman: 300_000,
      method: "CASH",
      paidAt: "2026-09-11T10:00:00.000Z",
      paidBy: 1,
    });
    expect((await R.agedPayables(ORG)).find((r) => r.supplierId === supplierId)!.balanceToman).toBe(500_000);
  });

  it("a fully-paid supplier drops out of the payables list entirely", async () => {
    await postSupplierPayment(getDb(), {
      organizationId: ORG,
      supplierId,
      amountToman: 500_000,
      method: "CASH",
      paidAt: "2026-09-12T10:00:00.000Z",
      paidBy: 1,
    });
    expect((await R.agedPayables(ORG)).find((r) => r.supplierId === supplierId)).toBeUndefined();
  });

  it("the account ledger opens at the period's opening balance, not at zero", async () => {
    /* Receivables, not cash: in this file the only cash postings are supplier PAYMENTS,
       which credit it. So a September opening on cash is genuinely 0, and my first
       expectation of `> 0` was wrong about the fixture rather than the code. AR has July
       sales in front of it, which is what makes the opening meaningful. */
    expect((await R.accountLedger(ORG, (await accountIdByCode("1101"))!)).openingToman).toBe(0);

    const ar = (await accountIdByCode("1201"))!;
    expect((await R.accountLedger(ORG, ar)).openingToman).toBe(0); // unfiltered -> no opening at all

    const sept = await R.accountLedger(ORG, ar, { periodKey: "1405-06" });
    expect(sept.openingToman).toBeGreaterThan(0); // July and August sales precede it
    const moved = sept.lines.reduce(
      (s, l) => s + (l.side === "D" ? l.amountToman : -l.amountToman),
      0
    );
    expect(sept.closingToman).toBe(sept.openingToman + moved);
  });

  it("a closed period's report still answers, because closing hides nothing", async () => {
    const is = await R.incomeStatement(ORG, { periodKey: "1399-01" });
    expect(is.periodKey).toBe("1399-01");
    expect(is.revenueToman).toBe(0);
  });

  it("the trial balance still balances after every report was read", async () => {
    const tb = await trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("scopes every report to one tenant", async () => {
    const db = getDb();
    await db
      .prepare(
        "INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Second', 'second', '2026-01-01') ON CONFLICT DO NOTHING"
      )
      .run();
    /* ORG 2 holds only the DELIBERATE breakage from the previous test -- no revenue, no
       payables, and a journal count of exactly 1 (its own). ORG 1's figures are entirely
       unaffected, which is the isolation this is really asserting. */
    expect((await R.incomeStatement(2)).revenueToman).toBe(0);
    expect(await R.agedPayables(2)).toHaveLength(0);
    // ORG 2 sees ONLY its own journal, found by id rather than assumed, so this does not
    // depend on the previous test having run.
    const org2Journals = (await R.journalReport(2)).rows;
    expect(org2Journals.length).toBe(
      (await db.prepare("SELECT COUNT(*) AS n FROM journals WHERE organization_id = 2").get() as { n: number }).n
    );
    // ORG 1 sees none of them, and the two ledgers are genuinely independent.
    const org2Ids = new Set(org2Journals.map((r) => r.journalId));
    expect((await R.journalReport(1)).rows.some((r) => org2Ids.has(r.journalId))).toBe(false);
    expect((await R.balanceSheet(1)).difference).toBe(0);
  });
});

describe("journal and ledger paging", () => {
  const PERIOD = "1405-06";
  beforeAll(async () => {
    for (let i = 1; i <= 7; i++) await sale(1_000 * i, i % 2 ? 400 * i : null, `2026-09-${String(10 + i).padStart(2, "0")}T10:00:00.000Z`);
  });

  it("journal legs are the same ones a per-journal query returns, in the same order", async () => {
    const db = getDb();
    const report = await R.journalReport(ORG, { limit: 1000 });
    expect(report.rows.length).toBeGreaterThan(7);
    for (const row of report.rows) {
      const expected = await db
        .prepare(
          `SELECT a.code, a.name_fa AS nameFa, e.side, e.amount_toman AS amountToman
             FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.journal_id = ? ORDER BY a.code`
        )
        .all(row.journalId);
      expect(row.legs, `journal ${row.journalId}`).toEqual(expected);
    }
  });

  it("a journal page is a faithful slice of the newest-first list and reports the true total", async () => {
    const all = await R.journalReport(ORG, { limit: 1000 });
    const page = await R.journalReport(ORG, { limit: 3, offset: 2 });
    expect(page.rows.map((r) => r.journalId)).toEqual(all.rows.slice(2, 5).map((r) => r.journalId));
    expect(page.total).toBe(all.rows.length);
    expect(all.total).toBe(all.rows.length);
  });

  it("the total counts past the old 500-row cut-off, and respects the filters", async () => {
    expect((await R.journalReport(ORG, { periodKey: PERIOD, limit: 2 })).total).toBe((await R.journalReport(ORG, { periodKey: PERIOD, limit: 1000 })).rows.length);
    expect((await R.journalReport(ORG, { sourceType: "NO_SUCH_SOURCE" })).total).toBe(0);
  });

  it("a ledger page carries the same running balances and the same closing figure", async () => {
    const ar = (await accountIdByCode("1201"))!;
    const full = await R.accountLedger(ORG, ar, { periodKey: PERIOD });
    expect(full.lines.length).toBeGreaterThanOrEqual(7);
    const page = await R.accountLedger(ORG, ar, { periodKey: PERIOD, limit: 3, offset: 2 });
    expect(page.lines).toEqual(full.lines.slice(2, 5));
    expect(page.openingToman).toBe(full.openingToman);
    expect(page.closingToman).toBe(full.closingToman);
    expect(page.totalLines).toBe(full.lines.length);
    // asking without a limit still returns everything (print/export paths)
    expect((await R.accountLedger(ORG, ar, { periodKey: PERIOD })).lines).toEqual(full.lines);
    expect(full.totalLines).toBe(full.lines.length);
  });
});
