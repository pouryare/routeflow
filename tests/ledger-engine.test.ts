import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-ledger-engine-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { LedgerError, postJournal, postJournalIn, trialBalance, accountIdByCode } =
  await import("@/lib/repo/ledger");

const ORG = 1;
const USER = 1;
/* customers is empty on a fresh database, and ledger_entries.customer_id REFERENCES
   customers(id) with foreign_keys ON. So the AR leg needs a customer that really exists. */
let CUSTOMER = 1;
const cash = () => accountIdByCode("1101")!;
const ar = () => accountIdByCode("1201")!;
const countJournals = (org = ORG) =>
  (getDb().prepare("SELECT COUNT(*) AS n FROM journals WHERE organization_id = ?").get(org) as {
    n: number;
  }).n;
const maxSeq = (org: number) =>
  (getDb()
    .prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM journals WHERE organization_id = ?")
    .get(org) as { n: number }).n;

beforeAll(() => {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
     VALUES (?, 'engine-tester', 'x', 'Engine Tester', 'owner', ?, '2026-01-01')`
  ).run(USER, ORG);
  // organizations gets one seeded row (id 1) by the migration; customers get none.
  db.prepare(
    "INSERT OR IGNORE INTO organizations (id, name, slug, created_at) VALUES (1, 'Default', 'default', '2026-01-01')"
  ).run();
  CUSTOMER = Number(
    db
      .prepare(
        "INSERT INTO customers (id, customer_code, business_name, synced_at) VALUES (?, 'C-1', 'Test Customer', '2026-01-01')"
      )
      .run(CUSTOMER).lastInsertRowid
  );
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("postJournal", () => {
  it("posts a balanced journal and allocates the next gapless seq", () => {
    /* Asserted RELATIVE to the current max, not to the literal 1. Three earlier tests post
       to ORG, so a hard-coded 1 passes only by accident of ordering. */
    const before = maxSeq(ORG);
    const id = postJournalIn({
      organizationId: ORG,
      postedAt: "2026-07-14T10:00:00.000Z",
      sourceType: "MANUAL",
      createdBy: USER,
      memo: "test",
      legs: [
        { accountId: cash(), side: "D", amountToman: 5_000_000 },
        { accountId: ar(), side: "C", amountToman: 5_000_000, customerId: CUSTOMER },
      ],
    });
    expect(id).toBeGreaterThan(0);
    const j = getDb().prepare("SELECT seq, period_key FROM journals WHERE id = ?").get(id) as {
      seq: number;
      period_key: string;
    };
    expect(j.seq).toBe(before + 1);
    expect(j.period_key).toBe("1405-04"); // 2026-07-14 in the Jalali calendar
  });

  it("writes exactly one leg per entry, with the customer on the AR leg", () => {
    const id = postJournalIn({
      organizationId: ORG,
      postedAt: "2026-07-14T10:00:00.000Z",
      sourceType: "MANUAL",
      createdBy: USER,
      legs: [
        { accountId: cash(), side: "D", amountToman: 700_000 },
        { accountId: ar(), side: "C", amountToman: 700_000, customerId: CUSTOMER },
      ],
    });
    const legs = getDb()
      .prepare("SELECT side, amount_toman, customer_id FROM ledger_entries WHERE journal_id = ?")
      .all(id) as { side: string; amount_toman: number; customer_id: number | null }[];
    expect(legs.length).toBe(2);
    expect(legs.find((l) => l.side === "C")!.customer_id).toBe(1);
  });

  it("refuses an unbalanced journal", () => {
    const before = countJournals();
    expect(() =>
      postJournalIn({
        organizationId: ORG,
        postedAt: "2026-07-14T10:00:00.000Z",
        sourceType: "MANUAL",
        createdBy: USER,
        legs: [
          { accountId: cash(), side: "D", amountToman: 5_000_000 },
          { accountId: ar(), side: "C", amountToman: 4_000_000 },
        ],
      })
    ).toThrow(LedgerError);
    expect(countJournals()).toBe(before);
  });

  it("refuses a single-leg journal", () => {
    expect(() =>
      postJournalIn({
        organizationId: ORG,
        postedAt: "2026-07-14T10:00:00.000Z",
        sourceType: "MANUAL",
        createdBy: USER,
        legs: [{ accountId: cash(), side: "D", amountToman: 5_000_000 }],
      })
    ).toThrow(LedgerError);
  });

  it("refuses an EMPTY journal, which no other check would catch", () => {
    /* A one-leg journal is refused by the BALANCE check (one side totals 5M, the other 0),
       so testing only that leaves the >=2 guard unproven. Empty legs pass the balance check
       -- 0 === 0 -- and produce a journal header with nothing under it, which reconciles
       against no total at all. Verified by deleting the guard: the journal posted with
       zero legs. */
    const before = countJournals();
    expect(() =>
      postJournalIn({
        organizationId: ORG,
        postedAt: "2026-07-14T10:00:00.000Z",
        sourceType: "MANUAL",
        createdBy: USER,
        legs: [],
      })
    ).toThrow(LedgerError);
    expect(countJournals()).toBe(before);
  });

  it("refuses a zero and a negative amount", () => {
    for (const amount of [0, -100]) {
      expect(() =>
        postJournalIn({
          organizationId: ORG,
          postedAt: "2026-07-14T10:00:00.000Z",
          sourceType: "MANUAL",
          createdBy: USER,
          legs: [
            { accountId: cash(), side: "D", amountToman: 100 },
            { accountId: ar(), side: "C", amountToman: amount },
          ],
        })
      ).toThrow(LedgerError);
    }
  });

  it("refuses a fractional amount, because sumToman throws", () => {
    expect(() =>
      postJournalIn({
        organizationId: ORG,
        postedAt: "2026-07-14T10:00:00.000Z",
        sourceType: "MANUAL",
        createdBy: USER,
        legs: [
          { accountId: cash(), side: "D", amountToman: 1000.5 },
          { accountId: ar(), side: "C", amountToman: 1000.5 },
        ],
      })
    ).toThrow(TypeError);
  });

  it("refuses a post to a non-postable group header", () => {
    expect(() =>
      postJournalIn({
        organizationId: ORG,
        postedAt: "2026-07-14T10:00:00.000Z",
        sourceType: "MANUAL",
        createdBy: USER,
        legs: [
          { accountId: accountIdByCode("1000")!, side: "D", amountToman: 100 },
          { accountId: ar(), side: "C", amountToman: 100 },
        ],
      })
    ).toThrow(LedgerError);
  });

  it("refuses a post to a DEACTIVATED account", () => {
    const off = getDb().prepare("SELECT id FROM accounts WHERE code = '5106'").get() as {
      id: number;
    };
    getDb().prepare("UPDATE accounts SET active = 0 WHERE id = ?").run(off.id);
    try {
      expect(() =>
        postJournalIn({
          organizationId: ORG,
          postedAt: "2026-07-14T10:00:00.000Z",
          sourceType: "MANUAL",
          createdBy: USER,
          legs: [
            { accountId: cash(), side: "D", amountToman: 100 },
            { accountId: off.id, side: "C", amountToman: 100 },
          ],
        })
      ).toThrow(LedgerError);
    } finally {
      getDb().prepare("UPDATE accounts SET active = 1 WHERE id = ?").run(off.id);
    }
  });

  it("refuses to post into a CLOSED period", () => {
    getDb()
      .prepare(
        `INSERT INTO fiscal_periods (organization_id, period_key, status, closed_at, closed_by, created_at)
         VALUES (?, '1399-01', 'closed', '2026-01-01', ?, '2026-01-01')`
      )
      .run(ORG, USER);
    const before = countJournals();
    expect(() =>
      postJournalIn({
        organizationId: ORG,
        postedAt: "2020-04-01T10:00:00.000Z", // 1399-01
        sourceType: "MANUAL",
        createdBy: USER,
        legs: [
          { accountId: cash(), side: "D", amountToman: 100 },
          { accountId: ar(), side: "C", amountToman: 100 },
        ],
      })
    ).toThrow(LedgerError);
    expect(countJournals()).toBe(before);
  });

  it("auto-creates a MISSING period as open, so the backfill can post history", () => {
    const id = postJournalIn({
      organizationId: ORG,
      postedAt: "2019-06-10T10:00:00.000Z", // 1398-03
      sourceType: "MANUAL",
      createdBy: USER,
      legs: [
        { accountId: cash(), side: "D", amountToman: 700 },
        { accountId: ar(), side: "C", amountToman: 700 },
      ],
    });
    expect(id).toBeGreaterThan(0);
    const p = getDb()
      .prepare("SELECT status FROM fiscal_periods WHERE organization_id = ? AND period_key = ?")
      .get(ORG, "1398-03") as { status: string };
    expect(p.status).toBe("open");
  });

  it("numbers seq per organization, not globally", () => {
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO organizations (id, name, slug, created_at) VALUES (2, 'Second', 'second', '2026-01-01')"
      )
      .run();
    const before = maxSeq(2);
    const id = postJournalIn({
      organizationId: 2,
      postedAt: "2026-07-14T10:00:00.000Z",
      sourceType: "MANUAL",
      createdBy: USER,
      legs: [
        { accountId: cash(), side: "D", amountToman: 250 },
        { accountId: ar(), side: "C", amountToman: 250 },
      ],
    });
    const j = getDb().prepare("SELECT seq FROM journals WHERE id = ?").get(id) as { seq: number };
    expect(j.seq).toBe(before + 1); // org 2 counts its own, not org 1's
  });

  it("keeps one org's money out of another org's trial balance", () => {
    expect(trialBalance(2).totalDebit).toBeLessThan(trialBalance(ORG).totalDebit);
  });

  it("postJournal nests inside a caller's transaction without opening its own", () => {
    const db = getDb();
    const before = countJournals();
    db.exec("BEGIN IMMEDIATE");
    try {
      postJournal(db, {
        organizationId: ORG,
        postedAt: "2026-07-14T11:00:00.000Z",
        sourceType: "MANUAL",
        createdBy: USER,
        legs: [
          { accountId: cash(), side: "D", amountToman: 999 },
          { accountId: ar(), side: "C", amountToman: 999 },
        ],
      });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    expect(countJournals()).toBe(before + 1);
  });

  it("rolls the WHOLE journal back when a leg fails validation", () => {
    const before = countJournals();
    const legsBefore = (
      getDb().prepare("SELECT COUNT(*) AS n FROM ledger_entries").get() as { n: number }
    ).n;
    expect(() =>
      postJournalIn({
        organizationId: ORG,
        postedAt: "2026-07-14T12:00:00.000Z",
        sourceType: "MANUAL",
        createdBy: USER,
        legs: [
          { accountId: cash(), side: "D", amountToman: 500 },
          { accountId: 999_999, side: "C", amountToman: 500 },
        ],
      })
    ).toThrow(LedgerError);
    expect(countJournals()).toBe(before);
    // A header row with no legs would be the worst outcome: a balanced-looking journal
    // reporting a total that nothing can be reconciled against.
    expect(
      (getDb().prepare("SELECT COUNT(*) AS n FROM ledger_entries").get() as { n: number }).n
    ).toBe(legsBefore);
  });
});

describe("trialBalance", () => {
  it("debits equal credits across every posting", () => {
    const tb = trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("returns a signed balance in the account's own normal direction", () => {
    const tb = trialBalance(ORG);
    const cashRow = tb.rows.find((r) => r.code === "1101");
    expect(cashRow).toBeDefined();
    expect(cashRow!.balance).toBeGreaterThan(0); // cash is debit-normal
  });

  it("returns no row for an account with no movement", () => {
    const tb = trialBalance(ORG);
    expect(tb.rows.every((r) => r.debit > 0 || r.credit > 0)).toBe(true);
  });
});
