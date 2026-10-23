import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-ledger-recon-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, backfillLedger, unmappedBackfillPayments, rawSqlite } = await import("@/lib/db");
const { recordPayment, voidPayment } = await import("@/lib/repo/payments");
const { accountIdByCode, trialBalance } = await import("@/lib/repo/ledger");

const ORG = 1;
let customerId = 0;

const debitOf = async (code: string) =>
  (await getDb()
    .prepare(
      "SELECT COALESCE(SUM(amount_toman),0) AS n FROM ledger_entries WHERE account_id = ? AND side = 'D'"
    )
    .get((await accountIdByCode(code))!) as { n: number }).n;
/* NET movement on an account: debits minus credits.

   A void does not DELETE the receipt, it adds a REVERSAL whose cash leg is a CREDIT. So
   summing only side='D' counts the original debit and never the credit that cancels it,
   and the comparison below would read 1,000,000 against a payments total of 0. Net is
   what "how much cash is in the box" actually means, and it is the same arithmetic
   trialBalance uses. */
const netOf = async (code: string) =>
  (await getDb()
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN e.side='D' THEN e.amount_toman ELSE 0 END)
                    - SUM(CASE WHEN e.side='C' THEN e.amount_toman ELSE 0 END), 0) AS n
         FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
        WHERE a.code = ?`
    )
    .get(code) as { n: number }).n;

const paid = async (clause: string) =>
  (await getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount_toman),0) AS n FROM payments WHERE ${clause} AND voided_at IS NULL`
    )
    .get() as { n: number }).n;

beforeAll(async () => {
  const db = getDb();
  await db.prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
     VALUES (?, 'recon-tester', 'x', 'Recon Tester', 'owner', ?, '2026-01-01')`
  ).run(1, ORG);
  /* customers has NO created_at column -- verified with PRAGMA table_info on a fresh
     database: customer_code/business_name/synced_at are NOT NULL, lifecycle defaults
     to 'lead', and created_at does not exist. The plan's version of this insert names
     created_at and would have thrown "table customers has no column named created_at". */
  const c = await db
    .prepare(
      `INSERT INTO customers (business_name, customer_code, organization_id, lifecycle, synced_at)
       VALUES ('مشتری آزمایشی', 'C-RECON', ?, 'active', '2026-01-01')`
    )
    .run(ORG);
  customerId = Number(c.lastInsertRowid);

  // Real receipts through the REAL path, dated across two Jalali months.
  await recordPayment(ORG, {
    customer_id: customerId,
    amount_toman: 1_000_000,
    method: "CASH",
    received_at: "2026-07-14T10:00:00.000Z",
    received_by: 1,
    // NOT allocations: []. An empty array is truthy, so it SKIPS autoAllocateFIFO and
    // then fails the sum check with "جمع تخصیص‌ها با مبلغ دریافت برابر نیست".
    // Omitting the key is what means "on account" -- see validateAllocations in
    // lib/repo/payments.ts:177.
  });
  await recordPayment(ORG, {
    customer_id: customerId,
    amount_toman: 2_500_000,
    method: "CARD_TO_CARD",
    received_at: "2026-08-02T10:00:00.000Z",
    received_by: 1,
    // NOT allocations: []. An empty array is truthy, so it SKIPS autoAllocateFIFO and
    // then fails the sum check with "جمع تخصیص‌ها با مبلغ دریافت برابر نیست".
    // Omitting the key is what means "on account" -- see validateAllocations in
    // lib/repo/payments.ts:177.
  });
  /* A CREDIT_NOTE that predates the cutover, inserted DIRECTLY rather than through
     recordPayment. Since Task 4 the live path REFUSES a CREDIT_NOTE outright -- there is
     no honest account for it -- so this row can only exist as history, which is exactly
     what the backfill has to cope with. Without a row of this method the rule is
     untested: mutation M10 (posting everything) passes when they are absent.

     The insert is verbatim payments' column list, because a hand-rolled INSERT that drifts
     from the schema is its own silent lie. */
  await getDb()
    .prepare(
      `INSERT INTO payments
         (organization_id, customer_id, amount_toman, method, received_at, received_by, created_at)
       VALUES (?, ?, 300000, 'CREDIT_NOTE', '2026-08-03T10:00:00.000Z', 1, '2026-08-03T10:00:00.000Z')`
    )
    .run(ORG, customerId);

  await backfillLedger(await rawSqlite(), getDb());
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("the reconciliation gate", () => {
  it("sums the cash accounts to exactly what payments say, per method", async () => {
    expect(await debitOf("1101")).toBe(await paid("method = 'CASH'"));
    expect(await debitOf("1102")).toBe(await paid("method IN ('CARD_TO_CARD','POS')"));
  });

  it("posted one PAYMENT journal per MAPPABLE receipt, and no more", async () => {
    /* Not "per receipt": a CREDIT_NOTE is deliberately unposted (see beforeAll), so the
       invariant is journals == receipts-that-have-an-account, which is what makes the
       omission visible instead of a silent gap. */
    const journals = (
      await getDb()
        .prepare("SELECT COUNT(*) AS n FROM journals WHERE source_type = 'PAYMENT'").get() as {
        n: number;
      }
    ).n;
    const mappable = (
      await getDb()
        .prepare(
          "SELECT COUNT(*) AS n FROM payments WHERE voided_at IS NULL AND method NOT IN ('CREDIT_NOTE','OTHER')"
        )
        .get() as { n: number }
    ).n;
    expect(journals).toBe(mappable);
  });

  it("leaves CREDIT_NOTE and OTHER unposted, and says so out loud", async () => {
    const skipped = unmappedBackfillPayments(await rawSqlite());
    expect(skipped.map((r) => r.method).sort()).toEqual(["CREDIT_NOTE"]);
    expect(skipped[0].amount_toman).toBe(300_000);
    // And it must not have leaked into the bank account.
    expect(await debitOf("1102")).toBe(await paid("method IN ('CARD_TO_CARD','POS')"));
  });

  it("sums per Jalali month too, which a total-only check would miss", async () => {
    const rows = await getDb()
      .prepare(
        `SELECT j.period_key AS periodKey,
                COALESCE(SUM(CASE WHEN e.side='D' THEN e.amount_toman END),0) AS debit,
                COALESCE(SUM(CASE WHEN e.side='C' THEN e.amount_toman END),0) AS credit
           FROM journals j JOIN ledger_entries e ON e.journal_id = j.id
          WHERE j.organization_id = ?
          GROUP BY j.period_key ORDER BY j.period_key`
      )
      .all(ORG) as { periodKey: string; debit: number; credit: number }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(r.debit, `period ${r.periodKey} does not balance`).toBe(r.credit);
  });

  it("balances the whole ledger", async () => {
    const tb = await trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("running the backfill again changes nothing", async () => {
    const before = (await getDb().prepare("SELECT COUNT(*) AS n FROM journals").get() as { n: number }).n;
    await backfillLedger(await rawSqlite(), getDb());
    const after = (await getDb().prepare("SELECT COUNT(*) AS n FROM journals").get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it("picks up a payment added AFTER a previous run -- the reason there is no marker", async () => {
    /* tests/no-one-shot-data-migration.test.ts forbids guarding a row-dependent migration
       behind an app_meta marker. This is the behaviour that rule exists to produce: a
       receipt taken after the backfill has already run still gets posted, on the next
       call. A marker would return early and leave it unposted forever, and the ledger
       would disagree with the payments screen by exactly this amount. */
    const before = (
      await getDb().prepare("SELECT COUNT(*) AS n FROM journals WHERE source_type = 'PAYMENT'").get() as {
        n: number;
      }
    ).n;
    await recordPayment(ORG, {
      customer_id: customerId,
      amount_toman: 400_000,
      method: "CASH",
      received_at: "2026-09-01T10:00:00.000Z",
      received_by: 1,
    });
    await backfillLedger(await rawSqlite(), getDb());
    const after = (
      await getDb().prepare("SELECT COUNT(*) AS n FROM journals WHERE source_type = 'PAYMENT'").get() as {
        n: number;
      }
    ).n;
    expect(after).toBe(before + 1);
    expect(await debitOf("1101")).toBe(await paid("method = 'CASH'"));
  });

  /* A void leaves the RECEIPT standing and adds a REVERSAL beside it. This was it.skip
     until Task 4 wired voidPaymentTxn to post one; the cutover is what closes it. */
  it("excludes VOIDED payments from the cash total, because they have a reversal", async () => {
    const p = await getDb().prepare("SELECT id FROM payments WHERE method = 'CASH'").get() as {
      id: number;
    };
    await voidPayment(ORG, p.id, 1, "آزمون ابطال");
    // NET cash now equals the non-voided cash receipts: the reversal has cancelled the
    // original debit without either row being edited or deleted.
    expect(await netOf("1101")).toBe(await paid("method='CASH'"));
    const tb = await trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("keeps one tenant's payments out of another tenant's postings", async () => {
    await getDb()
      .prepare(
        "INSERT OR IGNORE INTO organizations (id, name, slug, created_at) VALUES (2, 'Second', 'second', '2026-01-01')"
      )
      .run();
    const n = (
      await getDb().prepare("SELECT COUNT(*) AS n FROM journals WHERE organization_id = 2").get() as {
        n: number;
      }
    ).n;
    expect(n).toBe(0);
  });
});
