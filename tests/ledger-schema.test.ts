import { describe, it, expect, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-ledger-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

/* A journal row to point the immutability tests at. The plan's first draft asserted
   `UPDATE ... WHERE id = 1` against an EMPTY table -- a BEFORE trigger fires per matched
   row, so that test proved nothing and would have passed with the trigger deleted. Every
   immutability assertion here runs against a row that really exists. */
let journalId = 0;
let entryId = 0;

beforeAll(() => {
  const db = getDb();
  const org = db
    .prepare("INSERT INTO organizations (name, slug, created_at) VALUES ('A','a','x')")
    .run();
  const user = db
    .prepare(
      "INSERT INTO users (username, password_hash, display_name, organization_id, created_at) VALUES ('u','p','u',?,'x')"
    )
    .run(org.lastInsertRowid);
  const cash = db.prepare("SELECT id FROM accounts WHERE code = '1101'").get() as { id: number };
  journalId = Number(
    db
      .prepare(
        `INSERT INTO journals (organization_id, seq, posted_at, period_key, source_type, created_by, created_at)
         VALUES (?, 1, '2026-01-01', '1404-10', 'MANUAL', ?, 'x')`
      )
      .run(org.lastInsertRowid, user.lastInsertRowid).lastInsertRowid
  );
  entryId = Number(
    db
      .prepare(
        `INSERT INTO ledger_entries (organization_id, journal_id, account_id, side, amount_toman, created_at)
         VALUES (?, ?, ?, 'D', 1000, 'x')`
      )
      .run(org.lastInsertRowid, journalId, cash.id).lastInsertRowid
  );
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("ledger schema", () => {
  it("amount_toman is INTEGER, NOT NULL and strictly positive", () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(ledger_entries)").all() as {
      name: string;
      type: string;
      notnull: number;
    }[];
    const amount = cols.find((c) => c.name === "amount_toman");
    expect(amount?.type).toBe("INTEGER");
    expect(amount?.notnull).toBe(1);
    expect(() =>
      db
        .prepare(
          `INSERT INTO ledger_entries (organization_id, journal_id, account_id, side, amount_toman, created_at)
           VALUES (1, ${journalId}, 1, 'D', 0, 'x')`
        )
        .run()
    ).toThrow();
  });

  it("refuses a zero and a negative amount, but accepts a real one", () => {
    const db = getDb();
    const cash = db.prepare("SELECT id FROM accounts WHERE code = '1101'").get() as { id: number };
    const ins = (n: number) =>
      db
        .prepare(
          `INSERT INTO ledger_entries (organization_id, journal_id, account_id, side, amount_toman, created_at)
           VALUES (1, ${journalId}, ?, 'D', ?, 'x')`
        )
        .run(cash.id, n);
    expect(() => ins(0)).toThrow();
    expect(() => ins(-500)).toThrow();
    expect(ins(500).changes).toBe(1);
  });

  it("refuses an UPDATE and a DELETE on ledger_entries -- on a row that exists", () => {
    const db = getDb();
    expect(entryId).toBeGreaterThan(0);
    const still = db
      .prepare("SELECT amount_toman FROM ledger_entries WHERE id = ?")
      .get(entryId) as { amount_toman: number };
    expect(still.amount_toman).toBe(1000);
    expect(() =>
      db.prepare("UPDATE ledger_entries SET amount_toman = 5 WHERE id = ?").run(entryId)
    ).toThrow();
    expect(() => db.prepare("DELETE FROM ledger_entries WHERE id = ?").run(entryId)).toThrow();
    const after = db
      .prepare("SELECT amount_toman FROM ledger_entries WHERE id = ?")
      .get(entryId) as { amount_toman: number };
    expect(after.amount_toman).toBe(1000);
  });

  it("refuses an UPDATE and a DELETE on journals -- on a row that exists", () => {
    const db = getDb();
    expect(() => db.prepare("UPDATE journals SET memo = 'x' WHERE id = ?").run(journalId)).toThrow();
    expect(() => db.prepare("DELETE FROM journals WHERE id = ?").run(journalId)).toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM journals WHERE id = ?").get(journalId)).toEqual({
      n: 1,
    });
  });

  it("refuses to delete an account nothing has posted to yet", () => {
    const db = getDb();
    /* 5106 سایر has no legs in this file, so the FOREIGN KEY does NOT protect it --
       deleting it would succeed and take a seeded chart row with it. That is the case
       accounts_no_delete exists for. Deleting 1101 instead would prove nothing: the FK
       blocks that on its own, so the test passes with the trigger deleted. */
    const unused = db.prepare("SELECT id FROM accounts WHERE code = '5106'").get() as {
      id: number;
    };
    const legs = db
      .prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE account_id = ?")
      .get(unused.id) as { n: number };
    expect(legs.n, "this test needs an account with no legs").toBe(0);
    expect(() => db.prepare("DELETE FROM accounts WHERE id = ?").run(unused.id)).toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE id = ?").get(unused.id)).toEqual({
      n: 1,
    });
  });

  it("lets an account be DEACTIVATED, which is how one retires", () => {
    const db = getDb();
    const rent = db.prepare("SELECT id FROM accounts WHERE code = '5102'").get() as { id: number };
    expect(() => db.prepare("UPDATE accounts SET active = 0 WHERE id = ?").run(rent.id)).not.toThrow();
    expect((db.prepare("SELECT active FROM accounts WHERE id = ?").get(rent.id) as { active: number }).active).toBe(0);
  });

  it("accounts has no organization_id -- the chart is global", () => {
    const cols = getDb().prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
    expect(cols.find((c) => c.name === "organization_id")).toBeUndefined();
  });

  it("journals, ledger_entries and fiscal_periods are all tenant-scoped", () => {
    const db = getDb();
    for (const t of ["journals", "ledger_entries", "fiscal_periods"]) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all() as {
        name: string;
        notnull: number;
      }[];
      const org = cols.find((c) => c.name === "organization_id");
      expect(org, `${t}.organization_id missing`).toBeDefined();
      expect(org?.notnull, `${t}.organization_id must be NOT NULL`).toBe(1);
    }
  });

  it("seeds the chart, and every code sits in its own statement block", () => {
    const rows = getDb()
      .prepare("SELECT code, type FROM accounts WHERE is_system = 1 AND is_postable = 1")
      .all() as { code: string; type: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(22);
    const blockType: Record<string, string> = {
      "1": "ASSET",
      "2": "LIABILITY",
      "3": "EQUITY",
      "4": "REVENUE",
      "5": "EXPENSE",
    };
    for (const r of rows) {
      expect(blockType[r.code[0]], `${r.code} has an unknown leading digit`).toBeDefined();
      expect(r.type, `${r.code} is in the wrong block`).toBe(blockType[r.code[0]]);
    }
  });

  it("makes the five group headers non-postable", () => {
    const db = getDb();
    const rows = db
      .prepare("SELECT code FROM accounts WHERE code IN ('1000','2000','3000','4000','5000')")
      .all() as { code: string }[];
    expect(rows.length).toBe(5);
    for (const r of rows) {
      const postable = db
        .prepare("SELECT is_postable FROM accounts WHERE code = ?")
        .get(r.code) as { is_postable: number };
      expect(postable.is_postable, `${r.code} is a header and must not be postable`).toBe(0);
    }
  });

  it("gives every account a name in both scripts, and the right normal balance", () => {
    const rows = getDb()
      .prepare("SELECT code, name_fa, name_en, normal_balance FROM accounts")
      .all() as { code: string; name_fa: string; name_en: string; normal_balance: string }[];
    for (const r of rows) {
      expect(r.name_fa.trim().length, `${r.code} has no Persian name`).toBeGreaterThan(0);
      expect(r.name_en.trim().length, `${r.code} has no English name`).toBeGreaterThan(0);
    }
    expect(rows.find((r) => r.code === "1101")!.normal_balance).toBe("DEBIT");
    expect(rows.find((r) => r.code === "2101")!.normal_balance).toBe("CREDIT");
  });

  it("carries the accounts this app needs that a textbook would not", () => {
    const codes = (getDb().prepare("SELECT code FROM accounts").all() as { code: string }[]).map(
      (r) => r.code
    );
    expect(codes).toContain("2103"); // تعهدات کمیسیون
    expect(codes).toContain("2104"); // مالیات پرداختنی
    expect(codes).toContain("1103"); // تنخواه گردان
    expect(codes).toContain("2102"); // چک‌های پرداختنی
  });

  it("gives every postable account a unique Persian name", () => {
    const db = getDb();
    const dupeCode = db
      .prepare("SELECT code, COUNT(*) AS n FROM accounts GROUP BY code HAVING n > 1")
      .all();
    expect(dupeCode).toEqual([]);
    // Two postable accounts sharing a Persian label are indistinguishable in a dropdown.
    const dupeFa = db
      .prepare(
        "SELECT name_fa, COUNT(*) AS n FROM accounts WHERE is_postable = 1 GROUP BY name_fa HAVING n > 1"
      )
      .all();
    expect(dupeFa).toEqual([]);
  });

  it("seeding twice does not duplicate the chart", async () => {
    const { seedAccounts } = await import("@/lib/db");
    const before = (getDb().prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
    seedAccounts(getDb());
    const after = (getDb().prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
    expect(after).toBe(before);
  });
});
