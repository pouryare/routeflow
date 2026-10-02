# Accounting Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a double-entry ledger that becomes the single source of truth for money, then cut the existing payment path over to it and add accounts payable, expenses, and six reports.

**Architecture:** Four new tables (`accounts`, `fiscal_periods`, `journals`, `ledger_entries`) plus `suppliers`. One function — `postJournal` — writes a journal; every money event in the app routes through it. The ledger is append-only, enforced by database triggers, and every report is a query over postings rather than a stored total.

**Tech Stack:** Next.js (App Router), `node:sqlite` (`DatabaseSync`), TypeScript, Vitest. No chart library — SVG is hand-rolled in `components/charts/`.

**Spec:** `docs/superpowers/specs/2026-10-02-accounting-section-design.md` (committed `40b0899`, corrected `5bfc2ad`).

---

## Conventions this plan obeys

These are not preferences; they are existing repo rules. Violating one fails a test or a review.

1. **Every repo takes `organizationId` first** and scopes every read/write (`lib/repo/base.ts:4-10`).
   `accounts` is the ONE exception — the chart is global, deliberately (spec decision 4).
2. **Tests set `process.env.ROUTEFLOW_DB_PATH` to a tmpfile BEFORE `await import("@/lib/db")`** —
   the path is read at module load (`lib/db.ts:17`). Copy `tests/payments-schema.test.ts:1-17`.
3. **Migrations are idempotent functions guarded by an `app_meta` key**, not a version table.
   Copy `backfillLegacyPayments` (`lib/db.ts:376`).
4. **`IF NOT EXISTS` on every `CREATE TRIGGER`** — triggers re-run each boot and a bare
   `CREATE TRIGGER` throws (`lib/db.ts:3583`).
5. **Refusals throw**; they never return a flag (`PaymentError` idiom, `lib/repo/payments.ts`).
6. **Section headings go through `SectionHead`** — a hand-styled `<h2>`/`<h3>` fails
   `tests/section-headings.test.ts:32`.
7. **Never `Math.round` money** — use `roundToman` (`lib/money.ts:63`), which rounds half away
   from zero. `Math.round(-0.5)` is `-0` and would leave a reversal 1 Toman off.
8. **Raw SQL lives in `lib/repo/`**, never in a route or a component.
9. **No `next build` on this machine.** Verify with `npx tsc --noEmit` and `npx vitest run` only.
   Background the full suite (`setsid nohup npx vitest run > /tmp/v.log 2>&1 &`) and poll the log —
   it takes ~14 minutes. A foreground "timeout" usually means it is still running.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/db.ts` (modify) | New tables, triggers, `seedAccounts`, `backfillLedger` |
| `lib/repo/ledger.ts` (new) | `postJournal` / `postJournalIn`, balance validation, trial balance |
| `lib/repo/ledgerPostings.ts` (new) | Business-event → journal mappings. Split from the engine so it holds no domain knowledge |
| `lib/repo/suppliers.ts` (new) | Tenant-scoped supplier CRUD via `makeRepo` |
| `lib/repo/payments.ts` (modify) | `recordPaymentTxn` posts; `voidPaymentTxn` posts a reversal |
| `lib/delivery.ts` (modify) | Posts the revenue + cost journal on a delivery |
| `lib/purchases.ts` (modify) | Writes `supplier_id`; posts the inventory/AP journal |
| `lib/appNav.ts`, `lib/pageMeta.ts`, `proxy.ts` (modify) | Nav group, route metadata, edge gates |
| `app/(shell)/accounting/**` (new) | 6 reports + expenses + suppliers screens |
| `components/accounting/**` (new) | Report tables; reuse `components/charts/` |
| `tests/ledger-*.test.ts` (new) | Schema, engine, reconciliation, AP, reports |

**Why `ledger.ts` and `ledgerPostings.ts` are separate:** the engine is the only thing allowed to
insert a journal (spec decision 2). If the business-event mappings lived in the same file, a later
editor could add a "just this one special case" `postJournal` call to the engine and nothing would
catch it. Separate files make the rule structural rather than a comment.

---

## Task 1: The schema and the seeded chart

**Files:**
- Modify: `lib/db.ts` (inside the existing `db.exec` schema block, after `product_costs`; plus a `seedAccounts` export called from `migrate()`)
- Test: `tests/ledger-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ledger-schema.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-ledger-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("ledger schema", () => {
  it("amount_toman is INTEGER, NOT NULL and strictly positive", () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(ledger_entries)").all() as {
      name: string; type: string; notnull: number;
    }[];
    const amount = cols.find((c) => c.name === "amount_toman");
    expect(amount?.type).toBe("INTEGER");
    expect(amount?.notnull).toBe(1);
    expect(() =>
      db.prepare(
        "INSERT INTO ledger_entries (organization_id,journal_id,account_id,side,amount_toman,created_at) VALUES (1,1,1,'D',0,'x')"
      ).run()
    ).toThrow();
  });

  it("refuses an UPDATE and a DELETE on ledger_entries", () => {
    const db = getDb();
    expect(() => db.prepare("UPDATE ledger_entries SET amount_toman = 5 WHERE id = 1").run()).toThrow();
    expect(() => db.prepare("DELETE FROM ledger_entries WHERE id = 1").run()).toThrow();
  });

  it("refuses an UPDATE and a DELETE on journals", () => {
    const db = getDb();
    expect(() => db.prepare("UPDATE journals SET memo = 'x' WHERE id = 1").run()).toThrow();
    expect(() => db.prepare("DELETE FROM journals WHERE id = 1").run()).toThrow();
  });

  it("accounts has no organization_id -- the chart is global", () => {
    const cols = getDb().prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
    expect(cols.find((c) => c.name === "organization_id")).toBeUndefined();
  });

  it("journals, ledger_entries and fiscal_periods are all tenant-scoped", () => {
    const db = getDb();
    for (const t of ["journals", "ledger_entries", "fiscal_periods"]) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all() as {
        name: string; type: string; notnull: number;
      }[];
      const org = cols.find((c) => c.name === "organization_id");
      expect(org, `${t}.organization_id missing`).toBeDefined();
      expect(org?.notnull).toBe(1);
    }
  });

  it("seeds the chart, and every code sits in its own statement block", () => {
    const rows = getDb()
      .prepare("SELECT code, type FROM accounts WHERE is_system = 1 AND is_postable = 1")
      .all() as { code: string; type: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(22);
    const blockType: Record<string, string> = {
      "1": "ASSET", "2": "LIABILITY", "3": "EQUITY", "4": "REVENUE", "5": "EXPENSE",
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
    const postable = db
      .prepare("SELECT is_postable FROM accounts WHERE code = '1000'")
      .get() as { is_postable: number };
    expect(postable.is_postable).toBe(0);
  });

  it("carries the accounts this app needs that a textbook would not", () => {
    const codes = (getDb().prepare("SELECT code FROM accounts").all() as { code: string }[])
      .map((r) => r.code);
    expect(codes).toContain("2103"); // تعهدات کمیسیون
    expect(codes).toContain("2104"); // مالیات پرداختنی
    expect(codes).toContain("1103"); // تنخواه گردان
    expect(codes).toContain("2102"); // چک‌های پرداختنی
  });

  it("seeding twice does not duplicate the chart", async () => {
    const { seedAccounts } = await import("@/lib/db");
    const before = (getDb().prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
    seedAccounts(getDb());
    const after = (getDb().prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ledger-schema.test.ts`
Expected: FAIL — `no such table: ledger_entries` / `no such table: accounts`.

- [ ] **Step 3: Add the tables and triggers**

In `lib/db.ts`, inside the large `db.exec(...)` schema string, after the `product_costs` table and
its `idx_product_costs_lookup` index, insert exactly this:

```sql
    /* ---- Ledger ---------------------------------------------------------------------
       accounts is GLOBAL on purpose: the chart is the business's structure, the postings
       are the tenant's. That is the product_costs argument (69a7e25), and it is why this
       is the one table below with no organization_id. */

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name_fa TEXT NOT NULL,
      name_en TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
      parent_id INTEGER REFERENCES accounts(id),
      is_postable INTEGER NOT NULL DEFAULT 1 CHECK (is_postable IN (0,1)),
      normal_balance TEXT NOT NULL CHECK (normal_balance IN ('DEBIT','CREDIT')),
      is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
    );

    CREATE TABLE IF NOT EXISTS fiscal_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      period_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      closed_at TEXT,
      closed_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE (organization_id, period_key)
    );

    CREATE TABLE IF NOT EXISTS journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      seq INTEGER NOT NULL,
      posted_at TEXT NOT NULL,
      period_key TEXT NOT NULL,
      memo TEXT,
      source_type TEXT NOT NULL CHECK (source_type IN
        ('PAYMENT','CHEQUE','SALE','PURCHASE','SUPPLIER_PAYMENT','EXPENSE','OPENING','MANUAL','REVERSAL')),
      source_id INTEGER,
      reverses_journal_id INTEGER REFERENCES journals(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_journals_org_seq ON journals(organization_id, seq);

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      journal_id INTEGER NOT NULL REFERENCES journals(id),
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      side TEXT NOT NULL CHECK (side IN ('D','C')),
      amount_toman INTEGER NOT NULL CHECK (amount_toman > 0),
      customer_id INTEGER REFERENCES customers(id),
      supplier_id INTEGER REFERENCES suppliers(id),
      memo TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_ledger_entries_journal ON ledger_entries(journal_id);
    CREATE INDEX IF NOT EXISTS ix_ledger_entries_account ON ledger_entries(account_id, posted_at);

    /* Append-only, enforced by the DATABASE and not by convention. IF NOT EXISTS is
       mandatory: these re-run on every boot and a bare CREATE TRIGGER throws. The pattern
       is lib/repo/crm/migrate.ts's -- and payments has no trigger at all, so this is the
       first thing in the money path to have one. */
    CREATE TRIGGER IF NOT EXISTS journals_no_update BEFORE UPDATE ON journals
      BEGIN SELECT RAISE(ABORT, 'journals is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journals_no_delete BEFORE DELETE ON journals
      BEGIN SELECT RAISE(ABORT, 'journals is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update BEFORE UPDATE ON ledger_entries
      BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete BEFORE DELETE ON ledger_entries
      BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
```

- [ ] **Step 4: Add the idempotent chart seeder**

Add this exported function to `lib/db.ts`, directly above `backfillStockLedger`:

```ts
/** Seed the chart of accounts. Idempotent on accounts.code, so it re-runs safely.
 *
 *  The leading digit carries the statement -- 1xxx assets, 2xxx liabilities,
 *  3xxx equity, 4xxx revenue, 5xxx expenses -- so an account's type is readable
 *  from its code without a lookup. Group headers (1000..5000) are not postable.
 *
 *  2103 Commission payable and 2104 Taxes payable exist because THIS app needs them:
 *  the commission subsystem already knows what a rep is owed, and without a
 *  liability the balance sheet does not. */
export function seedAccounts(db: DatabaseSync): void {
  const rows: Array<[string, string, string, string, string, number]> = [
    // code, name_fa, name_en, type, normal_balance, is_postable
    ["1000", "دارایی‌ها", "Assets", "ASSET", "DEBIT", 0],
    ["1101", "صندوق", "Cash on hand", "ASSET", "DEBIT", 1],
    ["1102", "بانک", "Bank account", "ASSET", "DEBIT", 1],
    ["1103", "تنخواه گردان", "Petty cash", "ASSET", "DEBIT", 1],
    ["1201", "حساب‌های دریافتنی", "Accounts receivable", "ASSET", "DEBIT", 1],
    ["1202", "چک‌های دریافتنی", "Cheques receivable", "ASSET", "DEBIT", 1],
    ["1203", "موجودی کالا", "Inventory", "ASSET", "DEBIT", 1],
    ["1301", "پیش‌پرداخت", "Prepayments", "ASSET", "DEBIT", 1],
    ["2000", "بدهی‌ها", "Liabilities", "LIABILITY", "CREDIT", 0],
    ["2101", "حساب‌های پرداختنی", "Accounts payable", "LIABILITY", "CREDIT", 1],
    ["2102", "چک‌های پرداختنی", "Cheques payable", "LIABILITY", "CREDIT", 1],
    ["2103", "تعهدات کمیسیون", "Commission payable", "LIABILITY", "CREDIT", 1],
    ["2104", "مالیات پرداختنی", "Taxes payable", "LIABILITY", "CREDIT", 1],
    ["3000", "سرمایه", "Equity", "EQUITY", "CREDIT", 0],
    ["3101", "سرمایه", "Capital", "EQUITY", "CREDIT", 1],
    ["3102", "برداشت و اضافه‌برداشت", "Owner's equity", "EQUITY", "CREDIT", 1],
    ["3103", "سود انباشته", "Retained earnings", "EQUITY", "CREDIT", 1],
    ["4000", "درآمدها", "Revenue", "REVENUE", "CREDIT", 0],
    ["4101", "فروش", "Sales revenue", "REVENUE", "CREDIT", 1],
    ["4102", "برگشت از فروش", "Sales returns", "REVENUE", "CREDIT", 1],
    ["5000", "هزینه‌ها", "Expenses", "EXPENSE", "DEBIT", 0],
    ["5101", "بهای تمام‌شده", "COGS", "EXPENSE", "DEBIT", 1],
    ["5102", "اجاره", "Rent", "EXPENSE", "DEBIT", 1],
    ["5103", "حقوق", "Salary", "EXPENSE", "DEBIT", 1],
    ["5104", "سوخت و حمل", "Fuel and delivery", "EXPENSE", "DEBIT", 1],
    ["5105", "تلفن و اینترنت", "Phone and internet", "EXPENSE", "DEBIT", 1],
    ["5106", "سایر", "Other expenses", "EXPENSE", "DEBIT", 1],
  ];
  const ins = db.prepare(
    `INSERT INTO accounts (code, name_fa, name_en, type, normal_balance, is_postable, is_system, active)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1)
     ON CONFLICT(code) DO NOTHING`
  );
  for (const r of rows) ins.run(r[0], r[1], r[2], r[3], r[4], r[5]);
}
```

- [ ] **Step 5: Call the seeder from `migrate()`**

In `lib/db.ts`, find `backfillStockLedger(db);` (around line 3680) and add the seed immediately
**before** it:

```ts
  // Seed the chart before any ledger backfill can need an account.
  seedAccounts(db);

  // Phase 2: convert legacy purchases + deliveries into the stock-movement ledger, once.
  backfillStockLedger(db);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/ledger-schema.test.ts`
Expected: PASS, 9/9.

- [ ] **Step 7: Type-check and check for regressions**

Run: `npx tsc --noEmit` — Expected: 0 errors.

Run: `setsid nohup npx vitest run > /tmp/vitest-t1.log 2>&1 &`
Poll `tail -5 /tmp/vitest-t1.log` until it finishes (~14 min). Expected: all pass except the three
documented flakes (`district-coverage`, `api/routing-route`, `routing-repo`).

- [ ] **Step 8: Commit**

```bash
git add lib/db.ts tests/ledger-schema.test.ts
git commit -m "feat(ledger): the schema, and the chart that reads its own type

Four tables. accounts is GLOBAL on purpose -- the chart is the business's
structure, the postings are the tenant's -- so it is the one table here with
no organization_id.

Append-only is enforced by triggers rather than convention, copying the
activities pattern from lib/repo/crm/migrate.ts. payments has no trigger at
all; this is the first thing in the money path to have one.

The leading digit carries the statement (1xxx assets .. 5xxx expenses), and a
test asserts every seeded code sits in its own block -- the audit that caught
the spec numbering equity 22xx while the headers claimed 3000."
```

---

## Task 2: The posting engine

**Files:**
- Create: `lib/repo/ledger.ts`
- Test: `tests/ledger-engine.test.ts`

**The one thing to get right here:** `postJournal` must NOT open a transaction. `recordDelivery`
already holds `BEGIN IMMEDIATE` from `lib/delivery.ts:283` through the payment call at `:400` to
`COMMIT` at `:513`, on the same `db` handle. A nested `BEGIN` throws in SQLite, so an engine that
opened its own would crash on every cash collected at a delivery door. Hence two exports.

**Signature, stated once so the test and the implementation cannot drift:** `PostInput` carries
its own `organizationId`, and `postJournal(db, input)` takes exactly two arguments — there is no
positional `orgId` anywhere in this file.

- [ ] **Step 1: Write the failing test (part 1 of the file)**

Create `tests/ledger-engine.test.ts` with this header and helpers:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-ledger-engine-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { LedgerError, postJournal, postJournalIn, trialBalance, accountIdByCode } =
  await import("@/lib/repo/ledger");

const ORG = 1;
const USER = 1;
const cash = () => accountIdByCode("1101")!;
const ar = () => accountIdByCode("1201")!;

beforeAll(() => {
  getDb().prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
     VALUES (?, 'engine-tester', 'x', 'Engine Tester', 'owner', ?, '2026-01-01')`
  ).run(USER, ORG);
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("postJournal", () => {
  it("posts a balanced journal and allocates a gapless seq", () => {
    const id = postJournalIn({
      organizationId: ORG,
      postedAt: "2026-07-14T10:00:00.000Z",
      sourceType: "MANUAL",
      createdBy: USER,
      memo: "test",
      legs: [
        { accountId: cash(), side: "D", amountToman: 5_000_000 },
        { accountId: ar(), side: "C", amountToman: 5_000_000, customerId: 1 },
      ],
    });
    expect(id).toBeGreaterThan(0);
    const j = getDb().prepare("SELECT seq, period_key FROM journals WHERE id = ?").get(id) as {
      seq: number; period_key: string;
    };
    expect(j.seq).toBe(1);
    expect(j.period_key).toBe("1405-04"); // 2026-07-14 in the Jalali calendar
  });

  it("refuses an unbalanced journal", () => {
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

  it("refuses a non-positive amount", () => {
    expect(() =>
      postJournalIn({
        organizationId: ORG,
        postedAt: "2026-07-14T10:00:00.000Z",
        sourceType: "MANUAL",
        createdBy: USER,
        legs: [
          { accountId: cash(), side: "D", amountToman: 0 },
          { accountId: ar(), side: "C", amountToman: 0 },
        ],
      })
    ).toThrow(LedgerError);
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

  it("refuses to post into a CLOSED period", () => {
    getDb().prepare(
      `INSERT INTO fiscal_periods (organization_id, period_key, status, closed_at, closed_by, created_at)
       VALUES (?, '1399-01', 'closed', '2026-01-01', ?, '2026-01-01')`
    ).run(ORG, USER);
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
    getDb().prepare(
      `INSERT OR IGNORE INTO organizations (id, name, created_at) VALUES (2, 'Second', '2026-01-01')`
    ).run();
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
    expect(j.seq).toBe(1); // org 2's first journal is 1, not org 1's next number
  });

  it("postJournal nests inside a caller's transaction without opening its own", () => {
    const db = getDb();
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
    expect((db.prepare("SELECT COUNT(*) AS n FROM journals").get() as { n: number }).n)
      .toBeGreaterThan(0);
  });

  it("rolls the whole journal back when a leg fails validation", () => {
    const db = getDb();
    const before = (db.prepare("SELECT COUNT(*) AS n FROM journals").get() as { n: number }).n;
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
    const after = (db.prepare("SELECT COUNT(*) AS n FROM journals").get() as { n: number }).n;
    expect(after).toBe(before);
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ledger-engine.test.ts`
Expected: FAIL — `Cannot find module '@/lib/repo/ledger'`.

- [ ] **Step 3: Write `lib/repo/ledger.ts` (part 1: types and helpers)**

Create `lib/repo/ledger.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
import { sumToman } from "@/lib/money";
import { toJalali } from "@/lib/jalali";

/** A refusal the caller shows the user, not a bug. Same shape as PaymentError. */
export class LedgerError extends Error {}

export type LedgerSide = "D" | "C";

export type LedgerSourceType =
  | "PAYMENT" | "CHEQUE" | "SALE" | "PURCHASE"
  | "SUPPLIER_PAYMENT" | "EXPENSE" | "OPENING" | "MANUAL" | "REVERSAL";

export interface LedgerLeg {
  accountId: number;
  side: LedgerSide;
  amountToman: number;
  customerId?: number | null;
  supplierId?: number | null;
  memo?: string | null;
}

export interface PostInput {
  organizationId: number;
  postedAt: string;
  sourceType: LedgerSourceType;
  createdBy: number;
  legs: LedgerLeg[];
  memo?: string | null;
  sourceId?: number | null;
  reversesJournalId?: number | null;
}

/** The chart is global, so this lookup is deliberately NOT tenant-scoped. */
export function accountIdByCode(code: string): number | undefined {
  const row = getDb().prepare("SELECT id FROM accounts WHERE code = ?").get(code) as
    | { id: number }
    | undefined;
  return row?.id;
}

/** 'YYYY-MM-DD' -> '1405-04'. Derived here, never trusted from a caller. */
export function periodKeyOf(postedAt: string): string | null {
  const j = toJalali(postedAt.slice(0, 10));
  if (!j) return null;
  return `${j.jy}-${String(j.jm).padStart(2, "0")}`;
}

function assertPeriodOpen(db: DatabaseSync, orgId: number, periodKey: string): void {
  const existing = db
    .prepare("SELECT status FROM fiscal_periods WHERE organization_id = ? AND period_key = ?")
    .get(orgId, periodKey) as { status: string } | undefined;

  // A MISSING period auto-creates OPEN. The backfill restores history older than any
  // period a user could have closed, so a strict reading would make it refuse its own past.
  if (!existing) {
    db.prepare(
      `INSERT INTO fiscal_periods (organization_id, period_key, status, created_at)
       VALUES (?, ?, 'open', ?)`
    ).run(orgId, periodKey, new Date().toISOString());
    return;
  }
  if (existing.status === "closed") {
    throw new LedgerError(`دورهٔ ${periodKey} بسته است و امکان ثبت ندارد`);
  }
}
```

Now append the two functions and the trial balance to the same file:

```ts
/**
 * Post one balanced journal. THE ONLY function that writes a journal.
 *
 * Deliberately does NOT open a transaction: recordDelivery already holds BEGIN IMMEDIATE
 * across the payment call, and a nested BEGIN throws in SQLite. The caller owns the
 * transaction; use postJournalIn when you are not inside one.
 */
export function postJournal(db: DatabaseSync, input: PostInput): number {
  const orgId = input.organizationId;
  const periodKey = periodKeyOf(input.postedAt);
  if (!periodKey) throw new LedgerError("تاریخ سند نامعتبر است");
  if (input.legs.length < 2) throw new LedgerError("سند باید حداقل دو ردیف داشته باشد");

  // sumToman THROWS on a fraction, so a float cannot enter the ledger even by accident.
  const debitTotal = sumToman(input.legs.filter((l) => l.side === "D").map((l) => l.amountToman));
  const creditTotal = sumToman(input.legs.filter((l) => l.side === "C").map((l) => l.amountToman));
  if (debitTotal !== creditTotal) {
    throw new LedgerError("سند تراز نیست: جمع بدهکار و بستانکار برابر نیست");
  }

  // Every leg must name a postable, active account. Checked BEFORE any insert so a bad
  // account cannot leave a half-written journal behind.
  const checkAcc = db.prepare("SELECT is_postable, active FROM accounts WHERE id = ?");
  for (const leg of input.legs) {
    if (!(leg.amountToman > 0)) throw new LedgerError("مبلغ ردیف باید بزرگ‌تر از صفر باشد");
    const acc = checkAcc.get(leg.accountId) as
      | { is_postable: number; active: number }
      | undefined;
    if (!acc) throw new LedgerError("حساب یافت نشد");
    if (!acc.is_postable || !acc.active) throw new LedgerError("به این حساب نمی‌توان سند زد");
  }

  assertPeriodOpen(db, orgId, periodKey);

  // Gapless per organization. Safe because the caller's transaction is IMMEDIATE.
  const seqRow = db
    .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM journals WHERE organization_id = ?")
    .get(orgId) as { next: number };
  const now = new Date().toISOString();

  const journalId = Number(
    db
      .prepare(
        `INSERT INTO journals
           (organization_id, seq, posted_at, period_key, memo, source_type, source_id,
            reverses_journal_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        orgId, seqRow.next, input.postedAt, periodKey, input.memo ?? null,
        input.sourceType, input.sourceId ?? null, input.reversesJournalId ?? null,
        input.createdBy, now
      ).lastInsertRowid
  );

  const insLeg = db.prepare(
    `INSERT INTO ledger_entries
       (organization_id, journal_id, account_id, side, amount_toman, customer_id, supplier_id, memo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const leg of input.legs) {
    insLeg.run(
      orgId, journalId, leg.accountId, leg.side, leg.amountToman,
      leg.customerId ?? null, leg.supplierId ?? null, leg.memo ?? null, now
    );
  }
  return journalId;
}

/** The wrapper for callers that are NOT already inside a transaction. */
export function postJournalIn(input: PostInput): number {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const id = postJournal(db, input);
    db.exec("COMMIT");
    return id;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
```

Then append the trial balance to the same file:

```ts
export interface TrialBalanceRow {
  accountId: number;
  code: string;
  nameFa: string;
  type: string;
  debit: number;
  credit: number;
  /** Signed in the account's own normal direction. */
  balance: number;
}

export function trialBalance(orgId: number): {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
} {
  const raw = getDb()
    .prepare(
      `SELECT a.id AS accountId, a.code, a.name_fa AS nameFa, a.type,
              a.normal_balance AS normalBalance,
              COALESCE(SUM(CASE WHEN e.side = 'D' THEN e.amount_toman END), 0) AS debit,
              COALESCE(SUM(CASE WHEN e.side = 'C' THEN e.amount_toman END), 0) AS credit
         FROM ledger_entries e
         JOIN accounts a ON a.id = e.account_id
        WHERE e.organization_id = ?
        GROUP BY a.id
        ORDER BY a.code`
    )
    .all(orgId) as Array<{
      accountId: number; code: string; nameFa: string; type: string;
      debit: number; credit: number; normalBalance: "DEBIT" | "CREDIT";
    }>;

  const rows: TrialBalanceRow[] = raw.map((r) => ({
    accountId: r.accountId,
    code: r.code,
    nameFa: r.nameFa,
    type: r.type,
    debit: r.debit,
    credit: r.credit,
    balance: r.normalBalance === "DEBIT" ? r.debit - r.credit : r.credit - r.debit,
  }));

  return {
    rows,
    totalDebit: rows.reduce((s, r) => s + r.debit, 0),
    totalCredit: rows.reduce((s, r) => s + r.credit, 0),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ledger-engine.test.ts`
Expected: PASS, 13/13.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit` — Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add lib/repo/ledger.ts tests/ledger-engine.test.ts
git commit -m "feat(ledger): one function writes a journal, and it never opens a transaction

postJournal is the only insert path into journals, which is what makes 'the
ledger is the truth' a structural rule rather than a comment.

It deliberately does not open a transaction. recordDelivery already holds
BEGIN IMMEDIATE from lib/delivery.ts:283 across the payment call at :400, so a
nested BEGIN throws in SQLite -- an engine that opened its own would crash on
every cash collected at a delivery door, the most common money event here.
postJournalIn is the wrapper for callers not already inside one, mirroring the
recordPayment / recordPaymentTxn convention already in lib/repo/payments.ts.

sumToman validates the balance and throws on a fraction, so a float cannot enter
the ledger. A MISSING fiscal period auto-creates OPEN, because the backfill
restores history older than any period a user could have closed."
```

---

## Task 3: The backfill and the reconciliation gate

**Files:**
- Modify: `lib/db.ts` (add `backfillLedger`, called from `migrate()` after `seedAccounts`)
- Test: `tests/ledger-reconciliation.test.ts`

**This task is the gate.** Nothing user-visible ships until `tests/ledger-reconciliation.test.ts`
is green. Two guards, both required: the `app_meta` key is the fast path, and the `NOT EXISTS`
clause is the correctness proof that survives even if the key is missing.

**On the import cycle:** `db.ts` already imports repo modules at the top (`./repo/retiredWording`,
`./repo/crm/migrate`), and `ledger.ts` will import `getDb` from `db.ts`. ESM handles this because
neither module calls the other at module-evaluation time — `getDb` is a function. So use a normal
top-level `import`, not a lazy `require` (which does not exist in an ES module).

- [ ] **Step 1: Write the failing test**

Create `tests/ledger-reconciliation.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-ledger-recon-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, backfillLedger } = await import("@/lib/db");
const { recordPayment, voidPayment } = await import("@/lib/repo/payments");
const { accountIdByCode, trialBalance } = await import("@/lib/repo/ledger");

const ORG = 1;
let customerId = 0;

beforeAll(() => {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
     VALUES (?, 'recon-tester', 'x', 'Recon Tester', 'owner', ?, '2026-01-01')`
  ).run(1, ORG);
  const c = db.prepare(
    `INSERT INTO customers (business_name, customer_code, organization_id, lifecycle, created_at)
     VALUES ('مشتری آزمایشی', 'C-RECON', ?, 'active', '2026-01-01')`
  ).run(ORG);
  customerId = Number(c.lastInsertRowid);

  // Real receipts through the REAL path, dated across two Jalali months.
  recordPayment(ORG, {
    customer_id: customerId, amount_toman: 1_000_000, method: "CASH",
    received_at: "2026-07-14T10:00:00.000Z", received_by: 1, allocations: [],
  });
  recordPayment(ORG, {
    customer_id: customerId, amount_toman: 2_500_000, method: "CARD_TO_CARD",
    received_at: "2026-08-02T10:00:00.000Z", received_by: 1, allocations: [],
  });

  backfillLedger(getDb());
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("the reconciliation gate", () => {
  it("sums the cash accounts to exactly what payments say, per method", () => {
    const db = getDb();
    const debitOf = (code: string) =>
      (db.prepare(
        "SELECT COALESCE(SUM(amount_toman),0) AS n FROM ledger_entries WHERE account_id = ? AND side = 'D'"
      ).get(accountIdByCode(code)!) as { n: number }).n;
    const paid = (clause: string) =>
      (db.prepare(
        `SELECT COALESCE(SUM(amount_toman),0) AS n FROM payments WHERE ${clause} AND voided_at IS NULL`
      ).get() as { n: number }).n;

    expect(debitOf("1101")).toBe(paid("method = 'CASH'"));
    expect(debitOf("1102")).toBe(paid("method IN ('CARD_TO_CARD','POS')"));
  });

  it("sums per Jalali month too, which a total-only check would miss", () => {
    const db = getDb();
    const rows = db.prepare(
      `SELECT j.period_key AS periodKey,
              COALESCE(SUM(CASE WHEN e.side='D' THEN e.amount_toman END),0) AS debit,
              COALESCE(SUM(CASE WHEN e.side='C' THEN e.amount_toman END),0) AS credit
         FROM journals j JOIN ledger_entries e ON e.journal_id = j.id
        WHERE j.organization_id = ?
        GROUP BY j.period_key ORDER BY j.period_key`
    ).all(ORG) as { periodKey: string; debit: number; credit: number }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(r.debit).toBe(r.credit);
  });

  it("balances the whole ledger", () => {
    const tb = trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("running the backfill again changes nothing", () => {
    const db = getDb();
    const before = (db.prepare("SELECT COUNT(*) AS n FROM journals").get() as { n: number }).n;
    backfillLedger(db);
    const after = (db.prepare("SELECT COUNT(*) AS n FROM journals").get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it("excludes VOIDED payments from the cash total, because they have a reversal", () => {
    const db = getDb();
    const p = db.prepare("SELECT id FROM payments WHERE method = 'CASH'").get() as { id: number };
    voidPayment(ORG, p.id, 1, "آزمون ابطال");
    const debit = (db.prepare(
      "SELECT COALESCE(SUM(amount_toman),0) AS n FROM ledger_entries WHERE account_id = ? AND side = 'D'"
    ).get(accountIdByCode("1101")!) as { n: number }).n;
    const stillPaid = (db.prepare(
      "SELECT COALESCE(SUM(amount_toman),0) AS n FROM payments WHERE method='CASH' AND voided_at IS NULL"
    ).get() as { n: number }).n;
    expect(debit).toBe(stillPaid);
    expect(trialBalance(ORG).totalDebit).toBe(trialBalance(ORG).totalCredit);
  });

  it("keeps one tenant's payments out of another tenant's postings", () => {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO organizations (id, name, created_at) VALUES (2, 'Second', '2026-01-01')`
    ).run();
    const n = (db.prepare("SELECT COUNT(*) AS n FROM journals WHERE organization_id = 2").get() as {
      n: number;
    }).n;
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ledger-reconciliation.test.ts`
Expected: FAIL — `backfillLedger` is not exported from `@/lib/db`.

- [ ] **Step 3: Write `backfillLedger`**

Add to `lib/db.ts`, directly above `backfillStockLedger`:

```ts
/** Turn existing payments into ledger postings. Idempotent, twice over.
 *
 *  Guard 1 is the app_meta key (the fast path). Guard 2 is the NOT EXISTS clause in the
 *  SELECT below, which is what makes a re-run safe even without the key -- the same
 *  two-guard shape backfillLegacyPayments uses.
 *
 *  Voided payments are skipped: they have a reversal, not a receipt. Historical orders
 *  are NOT recognised for revenue here, because product_costs is effective-dated and new
 *  and today's average is not what the goods cost then -- a wrong number that looks
 *  right is worse than an absent one. */
export function backfillLedger(db: DatabaseSync): void {
  const done = db
    .prepare("SELECT value FROM app_meta WHERE key = 'ledger_backfill_done'")
    .get() as { value: string } | undefined;
  if (done) return;

  const acct = (code: string) =>
    db.prepare("SELECT id FROM accounts WHERE code = ?").get(code) as { id: number } | undefined;
  const cash = acct("1101");
  const bank = acct("1102");
  const ar = acct("1201");
  // The chart has not been seeded yet; leave the marker unset so a later boot does the work.
  if (!cash || !bank || !ar) return;

  const rows = db
    .prepare(
      `SELECT p.id, p.organization_id, p.customer_id, p.amount_toman, p.method,
              p.received_at, p.received_by
         FROM payments p
        WHERE p.voided_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM journals j
             WHERE j.source_type = 'PAYMENT' AND j.source_id = p.id
          )`
    )
    .all() as Array<{
      id: number; organization_id: number | null; customer_id: number; amount_toman: number;
      method: string; received_at: string; received_by: number;
    }>;

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const p of rows) {
      const cashAccount = p.method === "CASH" ? cash.id : bank.id;
      postJournal(db, {
        organizationId: p.organization_id ?? 1,
        postedAt: p.received_at,
        sourceType: "PAYMENT",
        sourceId: p.id,
        createdBy: p.received_by,
        memo: "انتقال از سیستم قبلی",
        legs: [
          { accountId: cashAccount, side: "D", amountToman: p.amount_toman },
          { accountId: ar.id, side: "C", amountToman: p.amount_toman, customerId: p.customer_id },
        ],
      });
    }
    db.prepare(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('ledger_backfill_done', ?)"
    ).run(new Date().toISOString());
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
```

Add the import at the top of `lib/db.ts`, beside the existing repo imports:

```ts
import { postJournal } from "./repo/ledger";
```

**If `tsc` reports a circular-import error here:** it means `ledger.ts` reached for something from
`db.ts` at module-evaluation time. It must only call `getDb()` inside function bodies — which is
how it is written, so this should not happen.

- [ ] **Step 4: Call the backfill from `migrate()`**

In `lib/db.ts`, add immediately after `seedAccounts(db);`:

```ts
  backfillLedger(db);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/ledger-reconciliation.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit` — Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts tests/ledger-reconciliation.test.ts
git commit -m "feat(ledger): backfill the history, and prove it balances

Two guards, both required: the app_meta key is the fast path, and the NOT
EXISTS clause in the SELECT is what makes a re-run safe without it -- the shape
backfillLegacyPayments already uses.

Voided payments are skipped; they have a reversal, not a receipt. Historical
orders are NOT recognised for revenue, because product_costs is effective-dated
and new: today's average is not what the goods cost then, and a wrong number
that looks right is worse than an absent one.

The gate compares per method AND per Jalali month. The per-month check is not
redundant -- it catches a period_key derivation bug that a total-only comparison
would hide."
```

---

## Task 4: Cut the payment path over to the ledger

**Files:**
- Create: `lib/repo/ledgerPostings.ts`
- Modify: `lib/repo/payments.ts` (`recordPaymentTxn` and `voidPaymentTxn`)
- Test: `tests/ledger-cutover.test.ts`

**This is the highest-risk task in the plan.** It is the moment money starts moving through two
systems at once, so its gate is the *entire existing payments suite*, not a new test.

**Why a separate `ledgerPostings.ts`:** `postJournal` must remain the only function that writes a
journal. If the business-event mappings lived inside `ledger.ts`, a later editor could add a "just
this one special case" call to the engine and nothing would catch it. Separate files make the rule
structural rather than a comment.

- [ ] **Step 1: Write the failing test**

Create `tests/ledger-cutover.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-ledger-cutover-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { recordPayment, voidPayment } = await import("@/lib/repo/payments");
const { accountIdByCode, trialBalance } = await import("@/lib/repo/ledger");

const ORG = 1;
let customerId = 0;

beforeAll(() => {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
     VALUES (?, 'cutover-tester', 'x', 'Cutover Tester', 'owner', ?, '2026-01-01')`
  ).run(1, ORG);
  customerId = Number(db.prepare(
    `INSERT INTO customers (business_name, customer_code, organization_id, lifecycle, created_at)
     VALUES ('مشتری برش', 'C-CUTOVER', ?, 'active', '2026-01-01')`
  ).run(ORG).lastInsertRowid);
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const legsOf = (paymentId: number) =>
  getDb().prepare(
    `SELECT e.side, e.amount_toman AS amount, a.code, e.customer_id AS customerId
       FROM ledger_entries e
       JOIN journals j ON j.id = e.journal_id
       JOIN accounts a ON a.id = e.account_id
      WHERE j.source_type = 'PAYMENT' AND j.source_id = ? ORDER BY a.code`
  ).all(paymentId) as { side: string; amount: number; code: string; customerId: number | null }[];

describe("the payment cutover", () => {
  it("writes ONE balanced journal per receipt, cash against receivables", () => {
    const id = recordPayment(ORG, {
      customer_id: customerId, amount_toman: 3_000_000, method: "CASH",
      received_at: "2026-07-20T09:00:00.000Z", received_by: 1, allocations: [],
    });
    const legs = legsOf(id);
    expect(legs.length).toBe(2);
    expect(legs.find((l) => l.code === "1101")).toMatchObject({ side: "D", amount: 3_000_000 });
    const credit = legs.find((l) => l.code === "1201")!;
    expect(credit.side).toBe("C");
    expect(credit.amount).toBe(3_000_000);
    // The receivable leg carries the customer, which is what makes per-customer ageing possible.
    expect(credit.customerId).toBe(customerId);
  });

  it("routes a non-cash method to the bank account, not the cash box", () => {
    const id = recordPayment(ORG, {
      customer_id: customerId, amount_toman: 1_200_000, method: "CARD_TO_CARD",
      received_at: "2026-07-21T09:00:00.000Z", received_by: 1, allocations: [],
    });
    expect(legsOf(id).find((l) => l.code === "1102")).toMatchObject({ side: "D", amount: 1_200_000 });
  });

  it("does NOT recognise revenue on a payment -- allocation posts nothing", () => {
    const id = recordPayment(ORG, {
      customer_id: customerId, amount_toman: 500_000, method: "CASH",
      received_at: "2026-07-22T09:00:00.000Z", received_by: 1, allocations: [],
    });
    const codes = legsOf(id).map((l) => l.code);
    expect(codes).not.toContain("4101"); // no revenue
    expect(codes).not.toContain("5101"); // no cost
  });

  it("keeps the whole ledger balanced after every receipt", () => {
    const tb = trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("posts a REVERSAL referencing the original when a payment is voided", () => {
    const id = recordPayment(ORG, {
      customer_id: customerId, amount_toman: 900_000, method: "CASH",
      received_at: "2026-07-23T09:00:00.000Z", received_by: 1, allocations: [],
    });
    voidPayment(ORG, id, 1, "اشتباه در ثبت");

    const reversal = getDb().prepare(
      `SELECT id, reverses_journal_id AS reverses FROM journals
        WHERE source_type = 'REVERSAL' AND source_id = ?`
    ).get(id) as { id: number; reverses: number };
    expect(reversal.reverses).toBeGreaterThan(0);
    expect(reversal.reverses).not.toBe(reversal.id); // never points at itself

    // The reversal's legs mirror the original, with the sides flipped.
    const revLegs = getDb().prepare(
      `SELECT a.code, e.side, e.amount_toman AS amount
         FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.journal_id = ?`
    ).all(reversal.id) as { code: string; side: string; amount: number }[];
    expect(revLegs.find((l) => l.code === "1101")).toMatchObject({ side: "C", amount: 900_000 });
    expect(revLegs.find((l) => l.code === "1201")).toMatchObject({ side: "D", amount: 900_000 });
  });

  it("restores the exact prior balance of every account after a reversal", () => {
    const before = trialBalance(ORG).rows.map((r) => `${r.code}:${r.balance}`).join("|");
    const id = recordPayment(ORG, {
      customer_id: customerId, amount_toman: 1_111_000, method: "CASH",
      received_at: "2026-07-24T09:00:00.000Z", received_by: 1, allocations: [],
    });
    voidPayment(ORG, id, 1, "آزمون بازگشت");
    const after = trialBalance(ORG).rows.map((r) => `${r.code}:${r.balance}`).join("|");
    expect(after).toBe(before);
  });

  it("refuses to void the same payment twice, and reverses it exactly once", () => {
    const id = recordPayment(ORG, {
      customer_id: customerId, amount_toman: 300_000, method: "CASH",
      received_at: "2026-07-25T09:00:00.000Z", received_by: 1, allocations: [],
    });
    voidPayment(ORG, id, 1, "اول");
    expect(() => voidPayment(ORG, id, 1, "دوم")).toThrow();
    const n = (getDb().prepare(
      "SELECT COUNT(*) AS n FROM journals WHERE source_type = 'REVERSAL' AND source_id = ?"
    ).get(id) as { n: number }).n;
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ledger-cutover.test.ts`
Expected: FAIL — `legsOf` returns `[]`, because a receipt currently posts no journal.

- [ ] **Step 3: Create `lib/repo/ledgerPostings.ts`**

This module owns the *business meaning* of each event. It is the only place that knows cash
methods map to accounts.

```ts
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
import { postJournal, accountIdByCode, LedgerError } from "./ledger";

function accountOrThrow(code: string): number {
  const id = accountIdByCode(code);
  if (!id) throw new LedgerError(`حساب ${code} یافت نشد`);
  return id;
}

/** Which account a payment method lands in.
 *
 *  A map in code, not a lookup table: there are six methods and this is accounting
 *  POLICY, not data. CREDIT_NOTE and OTHER are deliberately refused -- a credit note
 *  is not cash in, and OTHER needs the user to pick an account rather than have the app
 *  guess on their behalf. */
export function cashAccountFor(method: string): number {
  if (method === "CREDIT_NOTE" || method === "OTHER") {
    throw new LedgerError("برای این روش پرداخت باید حساب را خودتان انتخاب کنید");
  }
  const code = method === "CASH" ? "1101" : method === "CHEQUE" ? "1202" : "1102";
  return accountOrThrow(code);
}

/** A customer receipt: Dr cash (or cheques receivable) / Cr accounts receivable.
 *
 *  No revenue leg, ever. Revenue is recognised on delivery (Task 7), because the cash
 *  arriving and the goods moving are two different events, and a design that recognises
 *  revenue on payment is wrong even when the numbers happen to agree. */
export function postReceipt(
  db: DatabaseSync,
  input: {
    organizationId: number;
    paymentId: number;
    customerId: number;
    amountToman: number;
    method: string;
    receivedAt: string;
    receivedBy: number;
    memo?: string | null;
  }
): number {
  return postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.receivedAt,
    sourceType: "PAYMENT",
    sourceId: input.paymentId,
    createdBy: input.receivedBy,
    memo: input.memo ?? null,
    legs: [
      { accountId: cashAccountFor(input.method), side: "D", amountToman: input.amountToman },
      {
        accountId: accountOrThrow("1201"),
        side: "C",
        amountToman: input.amountToman,
        customerId: input.customerId,
      },
    ],
  });
}

/** Undo a receipt by posting the mirror image, referencing the original.
 *
 *  Spec decision 2 in code: nothing is edited or deleted. The reversal points back at
 *  the journal it cancels, so a reader sees the story of what happened instead of one
 *  quietly-corrected number. */
export function postReceiptReversal(
  db: DatabaseSync,
  input: {
    organizationId: number;
    paymentId: number;
    customerId: number;
    amountToman: number;
    method: string;
    originalJournalId: number;
    reversedAt: string;
    reversedBy: number;
    reason: string;
  }
): number {
  return postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.reversedAt,
    sourceType: "REVERSAL",
    sourceId: input.paymentId,
    reversesJournalId: input.originalJournalId,
    createdBy: input.reversedBy,
    memo: `ابطال: ${input.reason}`,
    legs: [
      // Sides flipped: the cash comes back out, the receivable goes back up.
      { accountId: cashAccountFor(input.method), side: "C", amountToman: input.amountToman },
      {
        accountId: accountOrThrow("1201"),
        side: "D",
        amountToman: input.amountToman,
        customerId: input.customerId,
      },
    ],
  });
}

/** The journal a payment's receipt produced, or undefined if it has none yet. */
export function receiptJournalIdFor(paymentId: number): number | undefined {
  const row = getDb()
    .prepare(
      "SELECT id FROM journals WHERE source_type = 'PAYMENT' AND source_id = ? ORDER BY id LIMIT 1"
    )
    .get(paymentId) as { id: number } | undefined;
  return row?.id;
}
```

- [ ] **Step 4: Wire the receipt into `recordPaymentTxn`**

In `lib/repo/payments.ts`, add the import beside the others:

```ts
import { postReceipt } from "./ledgerPostings";
```

Then inside `recordPaymentTxn`, add this call immediately **after** the `const paymentId = Number(...)`
statement and **before** the `insAlloc` prepare, so the receipt and its postings share one
transaction:

```ts
  // The receipt and its ledger postings commit or fail together. No revenue leg here --
  // revenue is recognised on delivery (Task 7).
  postReceipt(db, {
    organizationId,
    paymentId,
    customerId: input.customer_id,
    amountToman: input.amount_toman,
    method: input.method,
    receivedAt: input.received_at,
    receivedBy: input.received_by,
    memo: input.note ?? null,
  });
```

- [ ] **Step 5: Wire the reversal into `voidPaymentTxn`**

Add to the imports in `lib/repo/payments.ts`:

```ts
import { postReceiptReversal, receiptJournalIdFor } from "./ledgerPostings";
```

In `voidPaymentTxn`, the existing SELECT reads only `id, voided_at`. Widen it:

```ts
  const payment = db
    .prepare(
      "SELECT id, voided_at, customer_id, amount_toman, method FROM payments WHERE id = ? AND organization_id = ?"
    )
    .get(id, organizationId) as
    | { id: number; voided_at: string | null; customer_id: number; amount_toman: number; method: string }
    | undefined;
```

Then immediately **before** the existing `UPDATE payments SET voided_at = ...`, add:

```ts
  // Void means a REVERSAL, not an edit: the original journal stays and a mirror-image
  // journal cancels it. One click for the user, two rows in the ledger.
  const originalJournalId = receiptJournalIdFor(id);
  if (originalJournalId) {
    postReceiptReversal(db, {
      organizationId,
      paymentId: id,
      customerId: payment.customer_id,
      amountToman: payment.amount_toman,
      method: payment.method,
      originalJournalId,
      reversedAt: new Date().toISOString(),
      reversedBy: voidedBy,
      reason,
    });
  }
```

The existing `if (payment.voided_at) throw` guard runs above this, so a second void is refused
before a duplicate reversal can be written.

- [ ] **Step 6: Run the cutover test**

Run: `npx vitest run tests/ledger-cutover.test.ts`
Expected: PASS, 7/7.

- [ ] **Step 7: Run the EXISTING payments suite — this is the real gate**

```bash
npx vitest run tests/payments-repo.test.ts tests/payments-schema.test.ts \
  tests/delivery-payment.test.ts tests/legacy-payment-backfill.test.ts \
  tests/tenancy-isolation.test.ts tests/cheques-repo.test.ts \
  tests/api/payments-route.test.ts tests/api/deliveries-route.test.ts \
  tests/ledger-reconciliation.test.ts
```

**Then the full suite**, because `cashAccountFor` now refuses `CREDIT_NOTE` and `OTHER`, and any
existing test recording those methods will fail:

```bash
setsid nohup npx vitest run > /tmp/vitest-t4.log 2>&1 &
```

Poll `tail -20 /tmp/vitest-t4.log`. If a test records a `CREDIT_NOTE` or `OTHER` payment, fix that
test's setup — give it `CASH`, or post the receipt against an explicitly chosen account. **Do not**
widen `cashAccountFor` to guess; the refusal is deliberate.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit` — Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add lib/repo/ledgerPostings.ts lib/repo/payments.ts tests/ledger-cutover.test.ts
git commit -m "feat(ledger): a receipt now writes a journal beside the payment

recordPaymentTxn posts Dr cash / Cr receivables in the same transaction as the
payment row, so the two commit or fail together. voidPaymentTxn posts a
REVERSAL referencing the journal it cancels, in the same transaction as
voided_at -- one click for the user, two rows in the ledger.

The posting mappings live in ledgerPostings.ts rather than ledger.ts so the
engine stays the only insert path into journals. If the business meaning sat
beside the engine, a later editor could add a special-case call and nothing
would catch it.

No revenue leg on a receipt: the cash arriving and the goods moving are two
events, and recognising revenue on payment is wrong even when the numbers
happen to agree. That lands in Task 7.

CREDIT_NOTE and OTHER are refused rather than guessed at -- a credit note is not
cash in, and OTHER needs the user to choose an account."
```

---

## Task 5: Suppliers and accounts payable

**Files:**
- Modify: `lib/db.ts` (`suppliers` table; the rebuild migration adding `purchases.supplier_id`)
- Create: `lib/repo/suppliers.ts`
- Modify: `lib/repo/ledgerPostings.ts` (add the purchase and supplier-payment postings)
- Modify: `lib/purchases.ts` (write `supplier_id`, post the inventory/AP journal)
- Test: `tests/ledger-ap.test.ts`

**Two decisions that are easy to get wrong here:**

1. **A zero-total purchase posts NO journal.** `lib/purchases.ts:57` validates with `unit_cost_toman
   < 0`, so a zero-cost purchase is legal today. `ledger_entries` has `CHECK (amount_toman > 0)`,
   so posting one would throw. The purchase still records, still moves stock, still rolls the
   average cost — there is simply nothing to post.
2. **`roundToman`, never `Math.round` and never SQL `ROUND()`.** `purchase_lines.base_qty` is
   REAL, so the product genuinely produces fractions. `roundToman`'s own comment notes that
   `Math.round(-0.5)` returns `-0` and *"would make a reversal 1 Toman off from the sale it
   reverses"*.

- [ ] **Step 1: Write the failing test**

Create `tests/ledger-ap.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-ledger-ap-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { recordPurchase } = await import("@/lib/purchases");
const { createSupplier, listSuppliers } = await import("@/lib/repo/suppliers");
const { postSupplierPayment } = await import("@/lib/repo/ledgerPostings");
const { trialBalance } = await import("@/lib/repo/ledger");
const { roundToman } = await import("@/lib/money");

const ORG = 1;
let productId = 0;
let supplierId = 0;

beforeAll(() => {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
     VALUES (?, 'ap-tester', 'x', 'AP Tester', 'owner', ?, '2026-01-01')`
  ).run(1, ORG);
  db.prepare(
    `INSERT OR IGNORE INTO facilities (id, organization_id, kind, name, created_at)
     VALUES (1, ?, 'warehouse', 'انبار', '2026-01-01')`
  ).run(ORG);
  productId = Number(db.prepare(
    `INSERT INTO products (name, organization_id, avg_cost_toman, created_at)
     VALUES ('کالای آزمایشی', ?, 0, '2026-01-01')`
  ).run(ORG).lastInsertRowid);
  supplierId = createSupplier(ORG, { name: "تأمین‌کننده آزمایشی", createdBy: 1 });
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const purchaseLegs = (purchaseId: number) =>
  getDb().prepare(
    `SELECT a.code, e.side, e.amount_toman AS amount, e.supplier_id AS supplierId
       FROM ledger_entries e
       JOIN journals j ON j.id = e.journal_id
       JOIN accounts a ON a.id = e.account_id
      WHERE j.source_type = 'PURCHASE' AND j.source_id = ? ORDER BY a.code`
  ).all(purchaseId) as { code: string; side: string; amount: number; supplierId: number | null }[];

describe("accounts payable", () => {
  it("a purchase posts Dr inventory / Cr payables, carrying the supplier", () => {
    const id = recordPurchase(getDb(), {
      organization_id: ORG, created_by: 1, supplier_id: supplierId,
      purchase_date: "2026-07-15", supplier: "تأمین‌کننده آزمایشی",
      lines: [{ product_id: productId, base_qty: 10, unit_cost_toman: 100_000 }],
    });
    const legs = purchaseLegs(id);
    expect(legs.length).toBe(2);
    expect(legs.find((l) => l.code === "1203")).toMatchObject({ side: "D", amount: 1_000_000 });
    const credit = legs.find((l) => l.code === "2101")!;
    expect(credit.side).toBe("C");
    expect(credit.supplierId).toBe(supplierId);
  });

  it("a ZERO-total purchase posts NO journal but still records the purchase", () => {
    const id = recordPurchase(getDb(), {
      organization_id: ORG, created_by: 1, supplier_id: supplierId,
      purchase_date: "2026-07-16", supplier: "تأمین‌کننده آزمایشی",
      lines: [{ product_id: productId, base_qty: 5, unit_cost_toman: 0 }],
    });
    expect(purchaseLegs(id)).toHaveLength(0);
    expect(getDb().prepare("SELECT id FROM purchases WHERE id = ?").get(id)).toBeDefined();
  });

  it("roundToman and Math.round disagree exactly where it matters", () => {
    expect(roundToman(-0.5)).toBe(-1);
    expect(Math.round(-0.5)).toBe(-0); // the bug roundToman exists to prevent
  });

  it("paying a supplier posts Dr payables / Cr cash", () => {
    const journalId = postSupplierPayment(getDb(), {
      organizationId: ORG, supplierId, amountToman: 400_000,
      method: "CASH", paidAt: "2026-07-20T10:00:00.000Z", paidBy: 1,
    });
    const legs = getDb().prepare(
      `SELECT a.code, e.side, e.amount_toman AS amount FROM ledger_entries e
         JOIN accounts a ON a.id = e.account_id WHERE e.journal_id = ?`
    ).all(journalId) as { code: string; side: string; amount: number }[];
    expect(legs.find((l) => l.code === "2101")).toMatchObject({ side: "D", amount: 400_000 });
    expect(legs.find((l) => l.code === "1101")).toMatchObject({ side: "C", amount: 400_000 });
  });

  it("an OVERPAYMENT goes to prepayment, never to a negative payable", () => {
    const journalId = postSupplierPayment(getDb(), {
      organizationId: ORG, supplierId, amountToman: 900_000, overpayToPrepayment: true,
      method: "CASH", paidAt: "2026-07-21T10:00:00.000Z", paidBy: 1,
    });
    const legs = getDb().prepare(
      `SELECT a.code, e.side FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.journal_id = ?`
    ).all(journalId) as { code: string; side: string }[];
    expect(legs.find((l) => l.code === "2101")?.side).toBe("D");
    expect(legs.map((l) => l.code)).toContain("1301");
  });

  it("keeps the ledger balanced through every payable movement", () => {
    const tb = trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("scopes suppliers per organization", () => {
    getDb().prepare(
      `INSERT OR IGNORE INTO organizations (id, name, created_at) VALUES (2, 'Second', '2026-01-01')`
    ).run();
    expect(listSuppliers(ORG).map((s) => s.name)).toContain("تأمین‌کننده آزمایشی");
    expect(listSuppliers(2)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ledger-ap.test.ts`
Expected: FAIL — `Cannot find module '@/lib/repo/suppliers'`.

- [ ] **Step 3: Add the `suppliers` table**

In `lib/db.ts`, inside the schema block, immediately after the `ledger_entries` indexes:

```sql
    /* Tenant-scoped, unlike accounts: a supplier is ONE business's relationship, not a
       shared taxonomy. That is the same distinction the chart decision draws. */
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      phone TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_org_name ON suppliers(organization_id, name);
```

- [ ] **Step 4: Rebuild `purchases` to carry `supplier_id`**

SQLite cannot add a foreign key to an existing table, so this is rebuild-and-copy, following the
`organization_id` backfill at `lib/db.ts:3676`. Add this exported function to `lib/db.ts`:

```ts
/** Fold the free-text purchases.supplier into real supplier rows and give purchases a
 *  supplier_id. Idempotent: the PRAGMA check short-circuits a re-run, and the DISTINCT
 *  below is the guard that keeps a re-run from creating duplicate suppliers.
 *
 *  The legacy TEXT column is KEPT. It is the only record of the original string when two
 *  suppliers share a name after trimming, and dropping it buys tidiness at the price of
 *  irreversible data loss. */
export function migratePurchaseSuppliers(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(purchases)").all() as { name: string }[];
  if (cols.some((c) => c.name === "supplier_id")) return; // already migrated

  const now = new Date().toISOString();
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchases_tn_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier TEXT,
        supplier_id INTEGER REFERENCES suppliers(id),
        purchase_date TEXT NOT NULL,
        invoice_no TEXT,
        notes TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        organization_id INTEGER
      );
      INSERT INTO purchases_tn_new
        (id, supplier, purchase_date, invoice_no, notes, created_by, created_at, organization_id)
        SELECT id, supplier, purchase_date, invoice_no, notes, created_by, created_at, organization_id
          FROM purchases;
      DROP TABLE purchases;
      ALTER TABLE purchases_tn_new RENAME TO purchases;
    `);
    db.exec(
      "INSERT OR IGNORE INTO suppliers (organization_id, name, created_at) " +
      "SELECT DISTINCT COALESCE(organization_id, 1), TRIM(supplier), ? " +
      "FROM purchases WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''"
    , [now]);
    db.exec(
      "UPDATE purchases SET supplier_id = (" +
      "SELECT s.id FROM suppliers s WHERE s.name = TRIM(purchases.supplier) " +
      "AND s.organization_id = COALESCE(purchases.organization_id, 1)" +
      ") WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''"
    );
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}
```

Call it from `migrate()` **after** the `suppliers` table exists — i.e. after `seedAccounts(db)`.

- [ ] **Step 5: Create `lib/repo/suppliers.ts`**

```ts
import { makeRepo } from "./base";
import { getDb } from "@/lib/db";

export class SupplierError extends Error {}

export interface SupplierRow {
  id: number;
  organization_id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  active: number;
  created_by: number | null;
  created_at: string;
}

const repo = makeRepo<SupplierRow>("suppliers", { tenant: true });

/** Create a supplier, or return the existing one with that exact name.
 *
 *  Idempotent on (organization_id, name): the purchase migration inserts distinct names
 *  that a user could be creating at the same moment, and a duplicate here would split one
 *  real supplier's balance across two ids. */
export function createSupplier(
  organizationId: number,
  input: { name: string; phone?: string | null; notes?: string | null; createdBy: number }
): number {
  const name = input.name.trim();
  if (!name) throw new SupplierError("نام تأمین‌کننده لازم است");

  const existing = repo.list(organizationId, { name } as Partial<SupplierRow>)[0];
  if (existing) return existing.id;

  return repo.insert(organizationId, {
    organization_id: organizationId,
    name,
    phone: input.phone ?? null,
    notes: input.notes ?? null,
    active: 1,
    created_by: input.createdBy,
    created_at: new Date().toISOString(),
  } as Omit<SupplierRow, "id">);
}

export function listSuppliers(organizationId: number): SupplierRow[] {
  return getDb()
    .prepare("SELECT * FROM suppliers WHERE organization_id = ? ORDER BY name")
    .all(organizationId) as SupplierRow[];
}
```

- [ ] **Step 6: Add the purchase and supplier-payment postings**

Append to `lib/repo/ledgerPostings.ts`. Also widen its existing `./ledger` import to include the
type: `import { postJournal, accountIdByCode, LedgerError, type LedgerLeg } from "./ledger";`

```ts
/** A purchase: Dr inventory / Cr accounts payable.
 *
 *  Posts NOTHING when the total is zero. purchases.ts permits unit_cost_toman === 0 and
 *  ledger_entries CHECKs amount_toman > 0, so a zero purchase has nothing to say to the
 *  ledger -- it still records, still moves stock, still rolls the average cost. */
export function postPurchase(
  db: DatabaseSync,
  input: {
    organization_id: number;
    purchaseId: number;
    supplier_id: number | null;
    totalToman: number;
    purchased_at: string;
    created_by: number;
  }
): number | null {
  if (input.totalToman <= 0) return null;

  // No supplier means the liability is not attributable, and an unattributable payable is
  // the exact thing Task 5 exists to remove. Refuse rather than post one.
  if (input.supplier_id === null) {
    throw new LedgerError("برای ثبت بدهی، تأمین‌کننده لازم است");
  }

  const legs: LedgerLeg[] = [
    { accountId: accountOrThrow("1203"), side: "D", amountToman: input.totalToman },
    {
      accountId: accountOrThrow("2101"),
      side: "C",
      amountToman: input.totalToman,
      supplierId: input.supplier_id,
    },
  ];

  return postJournal(db, {
    organizationId: input.organization_id,
    postedAt: input.purchased_at,
    sourceType: "PURCHASE",
    sourceId: input.purchaseId,
    createdBy: input.created_by,
    memo: "خرید",
    legs,
  });
}

/** Paying a supplier: Dr accounts payable / Cr cash.
 *
 *  `overpayToPrepayment` sends the amount to 1301 instead, because a negative payable is
 *  impossible (amount_toman > 0) and an overpayment is an ASSET, not a negative debt. */
export function postSupplierPayment(
  db: DatabaseSync,
  input: {
    organizationId: number;
    supplierId: number;
    amountToman: number;
    method: string;
    paidAt: string;
    paidBy: number;
    overpayToPrepayment?: boolean;
    memo?: string | null;
  }
): number {
  return postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.paidAt,
    sourceType: "SUPPLIER_PAYMENT",
    createdBy: input.paidBy,
    memo: input.memo ?? null,
    legs: [
      {
        accountId: accountOrThrow(input.overpayToPrepayment ? "1301" : "2101"),
        side: "D",
        amountToman: input.amountToman,
        supplierId: input.supplierId,
      },
      { accountId: cashAccountFor(input.method), side: "C", amountToman: input.amountToman },
    ],
  });
}
```

- [ ] **Step 7: Wire `recordPurchase` to write `supplier_id` and post**

In `lib/purchases.ts`:

1. Add `supplier_id?: number | null;` to `PurchaseInput`.
2. Add `supplier_id` to the INSERT column list and its values, passing `input.supplier_id ?? null`.
3. Add these imports:
   ```ts
   import { roundToman, sumToman } from "@/lib/money";
   import { postPurchase } from "./repo/ledgerPostings";
   ```
4. Immediately after the purchase INSERT, add:

```ts
  // The payable side, which purchases has never had: the goods arrive and the money now
  // owed is recorded in the same transaction. base_qty is REAL, so each line total is
  // rounded with roundToman -- Math.round would leave a reversal 1 Toman off.
  const totalToman = sumToman(
    input.lines.map((l) => roundToman(l.unit_cost_toman * l.base_qty))
  );
  postPurchase(db, {
    organization_id: input.organization_id,
    purchaseId,
    supplier_id: input.supplier_id ?? null,
    totalToman,
    purchased_at: `${input.purchase_date}T00:00:00.000Z`,
    created_by: input.created_by,
  });
```

`sumToman` throws if anything is still fractional — the guard against a float sneaking in.

- [ ] **Step 8: Run the test**

Run: `npx vitest run tests/ledger-ap.test.ts`
Expected: PASS, 7/7.

- [ ] **Step 9: Check for regressions and type-check**

```bash
npx vitest run tests/stock-repo.test.ts tests/legacy-payment-backfill.test.ts \
  tests/ledger-reconciliation.test.ts tests/ledger-cutover.test.ts
npx tsc --noEmit
```

The `purchases` rebuild touches a live table, so run the full suite too:
`setsid nohup npx vitest run > /tmp/vitest-t5.log 2>&1 &`, then poll.

- [ ] **Step 10: Commit**

```bash
git add lib/db.ts lib/repo/suppliers.ts lib/repo/ledgerPostings.ts lib/purchases.ts tests/ledger-ap.test.ts
git commit -m "feat(ap): a purchase now records the money side too

suppliers is tenant-scoped, unlike accounts -- a supplier is ONE business's
relationship, not a shared taxonomy. purchases gains supplier_id by
rebuild-and-copy, because SQLite cannot add a foreign key to an existing table;
the legacy TEXT column is KEPT, since it is the only record of the original
string when two suppliers share a name after trimming.

A purchase posts Dr inventory / Cr payables in the same transaction that moves
the stock. It posts NOTHING when the total is zero: purchases.ts permits
unit_cost_toman === 0 and ledger_entries CHECKs amount_toman > 0, so a zero
purchase has nothing to say to the ledger -- it still records and still rolls
the average cost.

The line total is roundToman(unit_cost x base_qty) because base_qty is REAL.
Math.round(-0.5) is -0, which is exactly the 1-Toman reversal error roundToman
exists to prevent.

Overpaying a supplier posts to 1301 prepayment. amount_toman > 0 makes a
negative payable impossible, and an overpayment is an asset, not a negative debt."
```

---

## Task 6: Expenses

**Files:**
- Modify: `lib/repo/ledgerPostings.ts` (add `postExpense` and `expenseCategories`)
- Create: `app/api/accounting/expenses/route.ts` (POST)
- Test: `tests/ledger-expenses.test.ts`

**The category IS an account id.** There is no `expenses` table and no free-text category field.
This is the deliberate lesson from `purchases.supplier`, where free text made accounts payable
impossible: adding a category later is adding a row to `accounts`, with no code change and no
migration.

**`5101 COGS` is excluded from the manual list.** It is posted by delivery recognition (Task 7),
never by hand — otherwise a cost of goods gets expensed manually and the income statement
double-counts it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-ledger-exp-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { postExpense, expenseCategories } = await import("@/lib/repo/ledgerPostings");
const { trialBalance } = await import("@/lib/repo/ledger");

const ORG = 1;

beforeAll(() => {
  getDb().prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
     VALUES (?, 'exp-tester', 'x', 'Exp Tester', 'owner', ?, '2026-01-01')`
  ).run(1, ORG);
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("expenses", () => {
  it("lists the manual expense categories and EXCLUDES COGS", () => {
    const codes = expenseCategories().map((c) => c.code);
    expect(codes).toContain("5102"); // اجاره
    expect(codes).toContain("5103"); // حقوق
    expect(codes).not.toContain("5101"); // COGS is posted by delivery, never by hand
    expect(codes).not.toContain("5000"); // a group header is not a category
  });

  it("posts Dr expense / Cr cash", () => {
    const rent = expenseCategories().find((c) => c.code === "5102")!;
    const journalId = postExpense(getDb(), {
      organizationId: ORG, accountId: rent.id, amountToman: 25_000_000,
      method: "CASH", incurredAt: "2026-07-05T10:00:00.000Z", incurredBy: 1,
      memo: "اجاره ماه",
    });
    const legs = getDb().prepare(
      `SELECT a.code, e.side, e.amount_toman AS amount FROM ledger_entries e
         JOIN accounts a ON a.id = e.account_id WHERE e.journal_id = ?`
    ).all(journalId) as { code: string; side: string; amount: number }[];
    expect(legs.find((l) => l.code === "5102")).toMatchObject({ side: "D", amount: 25_000_000 });
    expect(legs.find((l) => l.code === "1101")).toMatchObject({ side: "C", amount: 25_000_000 });
  });

  it("refuses to post an expense to the COGS account by hand", () => {
    const cogs = getDb().prepare("SELECT id FROM accounts WHERE code = '5101'").get() as { id: number };
    expect(() =>
      postExpense(getDb(), {
        organizationId: ORG, accountId: cogs.id, amountToman: 1_000,
        method: "CASH", incurredAt: "2026-07-05T10:00:00.000Z", incurredBy: 1,
      })
    ).toThrow();
  });

  it("refuses to post to a non-expense account", () => {
    const cash = getDb().prepare("SELECT id FROM accounts WHERE code = '1101'").get() as { id: number };
    expect(() =>
      postExpense(getDb(), {
        organizationId: ORG, accountId: cash.id, amountToman: 1_000,
        method: "CASH", incurredAt: "2026-07-05T10:00:00.000Z", incurredBy: 1,
      })
    ).toThrow();
  });

  it("keeps the ledger balanced", () => {
    const tb = trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/ledger-expenses.test.ts`
Expected: FAIL — `expenseCategories is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/repo/ledgerPostings.ts`:

```ts
/** COGS is posted by delivery recognition, never by hand. */
const COGS_CODE = "5101";

export interface ExpenseCategory {
  id: number;
  code: string;
  nameFa: string;
  nameEn: string;
}

/** The manual expense categories: every postable EXPENSE account EXCEPT COGS.
 *
 *  Populated from the chart, so adding a category is adding a row -- no code change, no
 *  migration, and no reshaping of history. This is the deliberate lesson from
 *  purchases.supplier, where free text made accounts payable impossible to build. */
export function expenseCategories(): ExpenseCategory[] {
  return getDb()
    .prepare(
      `SELECT id, code, name_fa AS nameFa, name_en AS nameEn
         FROM accounts
        WHERE type = 'EXPENSE' AND is_postable = 1 AND active = 1 AND code <> ?
        ORDER BY code`
    )
    .all(COGS_CODE) as ExpenseCategory[];
}

/** An expense: Dr the category / Cr cash.
 *
 *  The category is an account id, not a string. Hand-posting to COGS is refused because
 *  delivery recognition owns it, and a manual COGS line would double-count cost. */
export function postExpense(
  db: DatabaseSync,
  input: {
    organizationId: number;
    accountId: number;
    amountToman: number;
    method: string;
    incurredAt: string;
    incurredBy: number;
    memo?: string | null;
  }
): number {
  const acct = db
    .prepare("SELECT id, type, code, is_postable, active FROM accounts WHERE id = ?")
    .get(input.accountId) as
    | { id: number; type: string; code: string; is_postable: number; active: number }
    | undefined;

  if (!acct || acct.type !== "EXPENSE" || !acct.is_postable || !acct.active) {
    throw new LedgerError("این حساب، حساب هزینه نیست");
  }
  if (acct.code === COGS_CODE) {
    throw new LedgerError("بهای تمام‌شده با تحویل کالا ثبت می‌شود و دستی ثبت نمی‌شود");
  }

  return postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.incurredAt,
    sourceType: "EXPENSE",
    createdBy: input.incurredBy,
    memo: input.memo ?? null,
    legs: [
      { accountId: input.accountId, side: "D", amountToman: input.amountToman },
      { accountId: cashAccountFor(input.method), side: "C", amountToman: input.amountToman },
    ],
  });
}
```

- [ ] **Step 4: Add the route**

Create `app/api/accounting/expenses/route.ts`, following the shape of `app/api/payments/route.ts`:
`requireRole` from `@/lib/session` with `OWNER_ROLES` **plus** `group_manager` (the user approved
this on 2026-10-02 — rent and fuel are real daily costs and an owner should not type every line),
parse the JSON body, open `BEGIN IMMEDIATE`, call `postExpense(getDb(), …)`, `COMMIT`, and return
the new journal id; `ROLLBACK` and rethrow on failure. Accountability is `created_by` on the journal
plus the expense report showing who entered what — attribution, not a second set of books.

- [ ] **Step 5: Run the test, type-check, commit**

```bash
npx vitest run tests/ledger-expenses.test.ts   # PASS, 5/5
npx tsc --noEmit                              # 0 errors
git add lib/repo/ledgerPostings.ts app/api/accounting/expenses/route.ts tests/ledger-expenses.test.ts
git commit -m "feat(expenses): the category is an account, not a string

There is no expenses table and no free-text category field. The dropdown is
populated from accounts WHERE type='EXPENSE' AND is_postable=1, so adding a
category is adding a row -- no code change, no migration, no reshaping of
history. That is the deliberate lesson from purchases.supplier, where free text
made accounts payable impossible to build.

5101 COGS is excluded and postExpense refuses it by hand: delivery recognition
owns cost, and a manual COGS line would double-count it on the income statement.

A group_manager may enter expenses (user decision, 2026-10-02). Accountability is
created_by on the journal plus the report showing who entered what."
```

---

## Task 7: Delivery recognition — revenue and cost

**Files:**
- Modify: `lib/repo/ledgerPostings.ts` (add `postDeliveryRecognition`)
- Modify: `lib/delivery.ts` (call it after a successful or partial delivery)
- Test: `tests/ledger-recognition.test.ts`

**This is where revenue is recognised — on delivery, not on order and not on payment.** A customer
paying 5,000,000 against a 20,000,000 order posts Dr Cash / Cr AR (Task 4). Revenue posts here,
when the goods move. The two are separate journals because the cash arriving and the goods moving
are separate events, and recognising revenue on payment is wrong even when the numbers agree.

**COGS is NOT invented.** `effectiveCost()` returns `null` when no cost is in force, and
`avgCostFor()` returns `null` when there is no average. When both are null the revenue leg posts
**alone** and the cost stays visibly unrecognised — the same *"refuse rather than invent"* instinct
as `lib/margin/solve.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-ledger-recog-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { postDeliveryRecognition } = await import("@/lib/repo/ledgerPostings");
const { trialBalance } = await import("@/lib/repo/ledger");

const ORG = 1;

beforeAll(() => {
  getDb().prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
     VALUES (?, 'recog-tester', 'x', 'Recog Tester', 'owner', ?, '2026-01-01')`
  ).run(1, ORG);
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const legsOf = (stopId: number) =>
  getDb().prepare(
    `SELECT a.code, e.side, e.amount_toman AS amount FROM ledger_entries e
       JOIN journals j ON j.id = e.journal_id
       JOIN accounts a ON a.id = e.account_id
      WHERE j.source_type = 'SALE' AND j.source_id = ? ORDER BY a.code`
  ).all(stopId) as { code: string; side: string; amount: number }[];

describe("delivery recognition", () => {
  it("recognises revenue AND cost on delivery", () => {
    postDeliveryRecognition(getDb(), {
      organizationId: ORG, deliveryStopId: 1001, customerId: 7,
      deliveredAt: "2026-07-18T10:00:00.000Z", deliveredBy: 1,
      revenueToman: 8_000_000, costToman: 6_000_000,
    });
    const legs = legsOf(1001);
    expect(legs.find((l) => l.code === "1201")).toMatchObject({ side: "D", amount: 8_000_000 });
    expect(legs.find((l) => l.code === "4101")).toMatchObject({ side: "C", amount: 8_000_000 });
    expect(legs.find((l) => l.code === "5101")).toMatchObject({ side: "D", amount: 6_000_000 });
    expect(legs.find((l) => l.code === "1203")).toMatchObject({ side: "C", amount: 6_000_000 });
  });

  it("posts REVENUE ALONE when the cost is unknown -- it is not invented", () => {
    postDeliveryRecognition(getDb(), {
      organizationId: ORG, deliveryStopId: 1002, customerId: 7,
      deliveredAt: "2026-07-18T11:00:00.000Z", deliveredBy: 1,
      revenueToman: 2_000_000, costToman: null,
    });
    expect(legsOf(1002).map((l) => l.code).sort()).toEqual(["1201", "4101"]);
  });

  it("posts NOTHING when nothing was delivered", () => {
    const id = postDeliveryRecognition(getDb(), {
      organizationId: ORG, deliveryStopId: 1003, customerId: 7,
      deliveredAt: "2026-07-18T12:00:00.000Z", deliveredBy: 1,
      revenueToman: 0, costToman: null,
    });
    expect(id).toBeNull();
    expect(legsOf(1003)).toHaveLength(0);
  });

  it("is idempotent per delivery stop, so a retried sync converges", () => {
    const args = {
      organizationId: ORG, deliveryStopId: 1004, customerId: 7,
      deliveredAt: "2026-07-19T10:00:00.000Z", deliveredBy: 1,
      revenueToman: 3_000_000, costToman: 2_000_000,
    };
    expect(postDeliveryRecognition(getDb(), args)).not.toBeNull();
    expect(postDeliveryRecognition(getDb(), args)).toBeNull();
    expect(legsOf(1004)).toHaveLength(4); // not 8
  });

  it("balances the ledger in every case, including the cost-unknown one", () => {
    const tb = trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/ledger-recognition.test.ts`
Expected: FAIL — `postDeliveryRecognition is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/repo/ledgerPostings.ts`:

```ts
/** Revenue and cost recognised on a delivery: Dr AR / Cr revenue, and Dr COGS / Cr inventory.
 *
 *  This is where revenue is recognised -- NOT on the order and NOT on the payment. A receipt
 *  posts Dr cash / Cr AR (Task 4); the goods moving is a different event.
 *
 *  `costToman` of null means the cost is not known, and the revenue leg posts ALONE. A
 *  fabricated cost would put a wrong number on the income statement, and a wrong number
 *  that looks right is worse than an absent one.
 *
 *  Returns null when there is nothing to post, or when this stop was already recognised --
 *  the guard that makes a retried sync converge instead of stacking. */
export function postDeliveryRecognition(
  db: DatabaseSync,
  input: {
    organizationId: number;
    deliveryStopId: number;
    customerId: number;
    deliveredAt: string;
    deliveredBy: number;
    revenueToman: number;
    costToman: number | null;
  }
): number | null {
  if (!(input.revenueToman > 0)) return null; // nothing went out

  const already = db
    .prepare("SELECT id FROM journals WHERE source_type = 'SALE' AND source_id = ? LIMIT 1")
    .get(input.deliveryStopId);
  if (already) return null;

  const legs: LedgerLeg[] = [
    {
      accountId: accountOrThrow("1201"),
      side: "D",
      amountToman: input.revenueToman,
      customerId: input.customerId,
    },
    { accountId: accountOrThrow("4101"), side: "C", amountToman: input.revenueToman },
  ];

  // Only when the cost is actually known.
  if (input.costToman !== null && input.costToman > 0) {
    legs.push(
      { accountId: accountOrThrow("5101"), side: "D", amountToman: input.costToman },
      { accountId: accountOrThrow("1203"), side: "C", amountToman: input.costToman }
    );
  }

  return postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.deliveredAt,
    sourceType: "SALE",
    sourceId: input.deliveryStopId,
    createdBy: input.deliveredBy,
    memo: "تحویل کالا",
    legs,
  });
}
```

- [ ] **Step 4: Wire it into `recordDelivery`**

In `lib/delivery.ts`, add the imports:

```ts
import { postDeliveryRecognition } from "./repo/ledgerPostings";
import { effectiveCost, costRowsFor, avgCostFor } from "./repo/productCosts";
import { effectivePacks, lineTotalToman } from "@/lib/orderMath";
import { roundToman, sumToman } from "@/lib/money";
```

Then, immediately after the `DELIVERY_OUT` stock-movements loop (which ends around line 453) and
still inside the same transaction, add:

```ts
    // Revenue and cost, recognised when the goods MOVE -- not on the order, and not on the
    // payment (which posts its own Dr cash / Cr AR journal).
    //
    // Revenue is the DELIVERED value, so a partial delivery recognises only the partial
    // amount. Cost comes from the same resolver the margin work built; when it is null the
    // revenue leg posts alone rather than carrying a fabricated cost.
    if (!nothingTaken) {
      let revenueToman = 0;
      let costToman = 0;
      let costKnown = true;

      for (const line of stopLines(db, stop.order_id)) {
        revenueToman += roundToman(lineTotalToman([line]));
        const override = effectiveCost(
          costRowsFor(db, line.product_id),
          line.packaging_id ?? null,
          now
        );
        const unit = override ? override.cost_toman : avgCostFor(db, line.product_id);
        if (unit === null) {
          costKnown = false; // not invented
          break;
        }
        costToman += roundToman(unit * effectivePacks(line));
      }

      postDeliveryRecognition(db, {
        organizationId: stop.organization_id || 1,
        deliveryStopId: stopId,
        customerId: stop.customer_id,
        deliveredAt: now,
        deliveredBy: input.by,
        revenueToman: sumToman([revenueToman]),
        costToman: costKnown ? sumToman([costToman]) : null,
      });
    }
```

If `effectiveCost`'s row field is named differently, read it from `CostRow` in
`lib/repo/productCosts.ts` — use the field that holds `cost_toman`, do not invent one.

- [ ] **Step 5: Run, type-check, commit**

```bash
npx vitest run tests/ledger-recognition.test.ts tests/delivery-payment.test.ts \
  tests/api/deliveries-route.test.ts tests/ledger-reconciliation.test.ts
npx tsc --noEmit
git add lib/repo/ledgerPostings.ts lib/delivery.ts tests/ledger-recognition.test.ts
git commit -m "feat(recognition): revenue and cost post when the goods move

Dr AR / Cr revenue plus Dr COGS / Cr inventory, inside the delivery's own
transaction. This is where revenue is recognised -- not on the order, and not on
the payment, which posts its own Dr cash / Cr AR journal. They are separate
journals because the cash arriving and the goods moving are separate events, and
recognising revenue on payment is wrong even when the numbers happen to agree.

Revenue is the DELIVERED value, so a partial delivery recognises only the
partial amount.

COGS is not invented. effectiveCost() and avgCostFor() both return null when no
cost is known, and then the revenue leg posts ALONE: a fabricated cost would put
a wrong number on the income statement, and a wrong number that looks right is
worse than an absent one.

Keyed off delivery_stops.id with a guard, so a retried sync converges instead of
stacking a second revenue journal."
```

---

## Task 8: Reports, nav, roles, and the payments screen

**Files:**
- Create: `app/(shell)/accounting/{trial-balance,ledger/[accountId],journal,balance-sheet,income-statement,payables,expenses,suppliers}/page.tsx`
- Modify: `lib/appNav.ts`, `lib/pageMeta.ts`, `lib/roles.ts`, `proxy.ts`, `components/sales/PaymentsPanel.tsx`
- Test: `tests/accounting-nav.test.ts`, `tests/accounting-reports.test.ts`

**Every number on every screen is a query over `journals` / `ledger_entries`.** None is stored,
none is cached, none is computed by the UI. That is what lets a formal report be added later with
no new maths.

**Three honesty requirements on the face of the screens:**

1. **A reversal must be visible on the journal.** A reversed entry appears struck through, labelled
   «ابطال‌شده توسط X در Y», linked to the reversing journal. One number with a hidden edit behind
   it is exactly what spec decision 2 refuses.
2. **Periods before the ledger are labelled cost-incomplete**, on the balance sheet and the income
   statement. The screen must never look more certain than the data underneath it.
3. **A closed period stays READABLE.** Closing hides a period from *posting*, never from reading.
   Closing must never make history disappear.

- [ ] **Step 1: Write the failing nav test**

Create `tests/accounting-nav.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const appNav = readFileSync("lib/appNav.ts", "utf8");
const proxy = readFileSync("proxy.ts", "utf8");
const pageMeta = readFileSync("lib/pageMeta.ts", "utf8");

const ROUTES = [
  "/accounting/trial-balance",
  "/accounting/journal",
  "/accounting/balance-sheet",
  "/accounting/income-statement",
  "/accounting/payables",
  "/accounting/expenses",
  "/accounting/suppliers",
];

describe("the accounting shell", () => {
  it("adds an «accounts» nav group rather than 8 tabs in «فروش و دریافت»", () => {
    expect(appNav).toContain('id: "accounts"');
    expect(appNav).toContain("حسابداری");
  });

  it("registers every accounting route in exactly one group", () => {
    for (const r of ROUTES) {
      const hits = appNav.split(`href: "${r}"`).length - 1;
      expect(hits, `${r} appears ${hits} times`).toBe(1);
    }
  });

  it("gates with the OWNER_ROLES constant, never a hand-written literal", () => {
    expect(proxy).toContain("/accounting");
    // The bug lib/roles.ts:46 warns about: a hand-written ['owner'] silently excludes
    // platform_owner, which is a documented strict superset of owner.
    expect(proxy).not.toMatch(/role\s*!==\s*["']owner["']/);
    expect(proxy).toMatch(/OWNER_ROLES/);
  });

  it("gives every accounting route a pageMeta entry", () => {
    for (const r of ROUTES) expect(pageMeta).toContain(`"${r}"`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/accounting-nav.test.ts`
Expected: FAIL — `id: "accounts"` is not in `lib/appNav.ts`.

- [ ] **Step 3: Add the nav group and tabs**

In `lib/appNav.ts`, add to `APP_GROUPS` (line 31) after the `reports` entry, and add `"accounts"`
to the `AppGroupId` union:

```ts
  { id: "accounts", label: "حسابداری" },
```

Then in `appTabs`, after the `reports` block (around line 126) and before `// تنظیمات سازمان`:

```ts
    // حسابداری — org-wide money. isOwner, never a literal 'owner': platform_owner is a
    // strict superset (lib/roles.ts:46) and a hand-written list silently excludes it.
    { href: "/accounting/trial-balance", label: "تراز آزمایشی", group: "accounts", ready: isOwner(r) },
    { href: "/accounting/journal", label: "دفتر روزنامه", group: "accounts", ready: isOwner(r) || r === "group_manager" },
    { href: "/accounting/balance-sheet", label: "ترازنامه", group: "accounts", ready: isOwner(r) },
    { href: "/accounting/income-statement", label: "سود و زیان", group: "accounts", ready: isOwner(r) },
    { href: "/accounting/payables", label: "بدهی تأمین‌کنندگان", group: "accounts", ready: isOwner(r) },
    { href: "/accounting/expenses", label: "هزینه‌ها", group: "accounts", ready: isOwner(r) || r === "group_manager" },
    { href: "/accounting/suppliers", label: "تأمین‌کنندگان", group: "accounts", ready: isOwner(r) },
```

Add to `lib/roles.ts`, derived from the constant so the two cannot drift:

```ts
/** Owner-only, including the platform's god key. Derived from OWNER_ROLES on purpose:
 *  writing `r === "owner"` at a call site is the bug this avoids. */
export const isOwner = (r: Role) => OWNER_ROLES.includes(r);
```

Two rules from that file's header comment still apply: every ready tab lands in exactly one group,
and no two visible tabs share a label.

- [ ] **Step 4: Add the proxy gates**

In `proxy.ts`, beside the existing `isCheques` gate (around line 131), and importing `OWNER_ROLES`
from `@/lib/roles`:

```ts
  // The accounting reports are org-wide money. Gate at the edge AND re-check in each
  // route -- the same shape as isCheques above, whose comment says "The API re-checks;
  // this keeps the bundle and the tab off their screen".
  const isAccounting = pathname.startsWith("/accounting");
  if (isAccounting && !OWNER_ROLES.includes(claims.role) && claims.role !== "group_manager") {
    return deny("/sales");
  }
  // Period close and manual journals are owner-only; a manager may READ reports.
  const isAccountingWrite =
    pathname.startsWith("/api/accounting/periods") ||
    pathname.startsWith("/api/accounting/journals");
  if (isAccountingWrite && !OWNER_ROLES.includes(claims.role)) {
    return deny("/sales");
  }
```

**Do not** write `claims.role !== "owner"` — that is the exact bug the constant was introduced to
prevent (`lib/roles.ts:46`).

- [ ] **Step 5: Add pageMeta entries**

In `lib/pageMeta.ts`, in the `// مالی` block, following the shape at line 163:

```ts
  "/accounting/trial-balance": {
    title: "تراز آزمایشی",
    titleEn: "Trial balance",
    overview: "جمع بدهکار و بستانکار هر حساب. هر دو ستون باید برابر باشند؛ این برابری، تعریف دفتر سالم است.",
  },
  "/accounting/journal": {
    title: "دفتر روزنامه",
    titleEn: "Journal",
    overview: "همهٔ اسناد به ترتیب، با فیلتر بر اساس دوره و حساب و مشتری. ردیف باطل‌شده خط‌خورده می‌ماند و به سند معکوسش وصل است.",
  },
  "/accounting/balance-sheet": {
    title: "ترازنامه",
    titleEn: "Balance sheet",
    overview: "دارایی در برابر بدهی و سرمایه، در یک تاریخ مشخص. دوره‌های پیش از دفتر «ناقص از نظر بهای تمام‌شده» علامت می‌خورند.",
  },
  "/accounting/income-statement": {
    title: "سود و زیان",
    titleEn: "Income statement",
    overview: "درآمد منهای بهای تمام‌شده و هزینه‌ها، برای یک دوره.",
  },
  "/accounting/payables": {
    title: "بدهی تأمین‌کنندگان",
    titleEn: "Accounts payable",
    overview: "مانده و سن هر بدهی به تأمین‌کننده، در سه بازهٔ ۰ تا ۷ روز، ۸ تا ۳۰ روز، و بیش از ۳۰ روز.",
  },
  "/accounting/expenses": {
    title: "هزینه‌ها",
    titleEn: "Expenses",
    overview: "ثبت اجاره، حقوق، سوخت و سایر هزینه‌ها. دستهٔ هزینه یک حساب کد است، نه متن آزاد.",
  },
  "/accounting/suppliers": {
    title: "تأمین‌کنندگان",
    titleEn: "Suppliers",
    overview: "فهرست تأمین‌کنندگان و ماندهٔ هرکدام.",
  },
```

- [ ] **Step 6: Build the report pages**

Each follows the structure of `app/(shell)/sales/commission/page.tsx`:

```tsx
export const dynamic = "force-dynamic";

export default async function TrialBalancePage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");
  // proxy.ts denies phone_sales at the edge; every route re-checks, as isCheques does.
  if (!isOwner(session.role)) redirect("/sales");

  const tb = trialBalance(session.organizationId);
  // ... render with <PageHeader> and <SectionHead>
}
```

Rules for all eight pages:
- **`SectionHead`, never a hand-styled `<h2>`/`<h3>`** — `tests/section-headings.test.ts:32` fails
  on the latter.
- **Charts reuse `components/charts/`** — `BarChart`, `DonutChart`, `LineChart`, `StatCard`. There is
  no chart library, and new hand-rolled SVG is a review failure, not a contribution.
- Amounts through `faToman` (`@/lib/format`); dates through `faJalaliDate` (`@/lib/jalali`).
- The trial balance shows both totals and an explicit «تراز است / تراز نیست» line.
- The journal renders a reversed entry struck through, labelled and linked to its reversal.
- The balance sheet and income statement carry the cost-incomplete label for periods predating the
  backfill.
- **Tenancy:** every query filters `organization_id = session.organizationId`.

- [ ] **Step 7: Improve `components/sales/PaymentsPanel.tsx`**

| Change | From | To |
|---|---|---|
| Filters | none at all | date range / method / customer / voided |
| Pagination | renders every recent payment | paged |
| Totals | nothing sums on screen | today / week / month cards per method |
| Export | none | CSV, Persian headers |
| **Allocation UI** | FIFO and invisible | per-order allocation, editable, on-account remainder shown as such |
| Grouping | one flat list | Jalali month sections |

The **allocation UI** is the change a user feels most: today a customer 40M on account cannot see
which orders it covers. The data already supports it — `payment_allocations.order_id NULL` is
on-account credit — so only the screen is missing.

The **void button becomes «ابطال + ثبت معکوس»**. Task 4 already made the void post a reversal, so
the button needs only its label and confirmation copy updated: one click, two rows.

- [ ] **Step 8: Run every gate, then the full suite**

```bash
npx vitest run tests/accounting-nav.test.ts tests/section-headings.test.ts \
  tests/appNav.test.ts tests/pageMeta.test.ts tests/proxy.test.ts \
  tests/ledger-schema.test.ts tests/ledger-engine.test.ts \
  tests/ledger-reconciliation.test.ts tests/ledger-cutover.test.ts \
  tests/ledger-ap.test.ts tests/ledger-expenses.test.ts tests/ledger-recognition.test.ts
npx tsc --noEmit
setsid nohup npx vitest run > /tmp/vitest-t8.log 2>&1 &   # then poll
```

- [ ] **Step 9: Commit**

```bash
git add "app/(shell)/accounting" components/sales/PaymentsPanel.tsx \
  lib/appNav.ts lib/pageMeta.ts lib/roles.ts proxy.ts tests/accounting-nav.test.ts
git commit -m "feat(accounting): six reports, a nav group, and a payments screen that explains itself

Every number on every screen is a query over journals/ledger_entries -- none
stored, none cached, none computed by the UI. That is what lets a formal report
be added later with no new maths.

«حسابداری» is a new nav group rather than eight more tabs in «فروش و دریافت»,
which already holds orders, products, payments, cheques and commission.

Gates name OWNER_ROLES, never a literal 'owner': platform_owner is a documented
strict superset (lib/roles.ts:46) and a hand-written list silently excludes it.

Three things the screens refuse to hide: a reversed entry is shown struck through
and attributed rather than quietly corrected; periods predating the ledger are
labelled cost-incomplete; and a CLOSED period stays readable, because closing
hides a period from posting and never from reading.

The payments screen gains an allocation UI. Today allocation is FIFO and
invisible, so a customer 40M on account cannot see which orders it covers -- the
data model already answers it (order_id NULL is on-account credit), only the
screen was missing."
```

---

## Definition of done

All eight tasks merged, and every one of these true:

- `npx tsc --noEmit` → **0 errors**
- `npx vitest run` → all pass except the three documented flakes: `district-coverage` "has no
  interior hole in the net", `api/routing-route` "plans, commits and freezes", and `routing-repo`
  "builds a greedy plan ordered nearest-first from the depot". A run reporting 1–2 failures with
  **those names** is a pass. Re-run any other failure alone before believing it.
- `tests/ledger-reconciliation.test.ts` green against real backfilled history
- Every new account code sits in its own statement block
- No `UPDATE` or `DELETE` on `journals` / `ledger_entries` anywhere in app code
- `SectionHead` on all eight pages; `tests/section-headings.test.ts` green
- Every accounting route has a `pageMetaFor` entry and an `OWNER_ROLES` gate

## Out of scope, so it is not mistaken for an omission

VAT / ارزش افزوده, tax periods, tax-office numbering, e-invoicing · cheques **payable** (the
`issued` state is kept, its write path is not built) · retroactive recompute of historical cost ·
bank reconciliation · recurring entries · multi-currency · budgets · dropping the legacy
`purchases.supplier` TEXT column · commission accrual to `2103` (the account is seeded; the accrual
is not, because the subsystem pays on its own schedule and posting an accrual it does not drive
would create a second source of truth).

**Task 4 — cut the payment path over.** `recordPaymentTxn` posts one journal inside its own
transaction (`Dr <cash acct by method> / Cr 1201`, `customer_id` on the credit leg); `voidPaymentTxn`
posts a `REVERSAL` journal with `reverses_journal_id` in the same transaction as `voided_at`. New
module `lib/repo/ledgerPostings.ts` holds the business-event mappings so the engine stays
domain-free. **Gate: the whole existing payments suite** — `tests/payments-repo.test.ts`,
`tests/delivery-payment.test.ts`, `tests/legacy-payment-backfill.test.ts`,
`tests/tenancy-isolation.test.ts`.

**Task 5 — suppliers + the `purchases` migration.** New `suppliers` table (tenant-scoped, unlike
`accounts`). Rebuild-and-copy migration adding `purchases.supplier_id` — SQLite cannot add a FK to an
existing table, so this follows the `organization_id` backfill shape at `lib/db.ts:3676`.
**Keep the legacy TEXT column.** `lib/purchases.ts:57` allows `unit_cost_toman === 0`, so a
zero-total purchase posts **no journal**. Use `roundToman(unit_cost × base_qty)` per line, never
`Math.round` and never SQL `ROUND()` — `base_qty` is REAL.

**Task 6 — AP and expenses.** `Dr 1203 / Cr 2101` per purchase; `Dr 2101 / Cr 1101` for supplier
payment, with overpayment going to `1301` prepayment and never a negative 2101; `Dr 51xx / Cr 1101`
for expenses, with `5101 COGS` **excluded** from the manual dropdown.

**Task 7 — delivery recognition.** On a successful or partial delivery post
`Dr 1201 / Cr 4101` plus `Dr 5101 / Cr 1203`. Revenue uses `effectivePacks()`
(`lib/orderMath.ts:34`); COGS reads `lib/repo/productCosts.ts:52` and **is not invented when null**.
Keyed off `delivery_stops.id` with a `NOT EXISTS` guard so a retried sync converges.

**Task 8 — reports, nav, roles, the payments screen.** Six reports under `/accounting/**`, all
numbers queried not stored; new `accounts` nav group «حسابداری»; `proxy.ts` gates naming
`OWNER_ROLES` (never a literal `['owner']` — `lib/roles.ts:46`); `SectionHead` on every page; the
payments page's six improvements including the allocation UI and the one-click
«ابطال + ثبت معکوس».

**Two decisions Tasks 4–8 must not re-open:** `postJournal` never opens a transaction (the nested
`BEGIN` hazard); and a missing `fiscal_periods` row auto-creates OPEN (the backfill must be able to
post its own history).