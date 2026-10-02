import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-ledger-ap-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
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
  /* facilities: the plan's INSERT names (id, organization_id, kind, name, created_at) but
     slug, lat, lng and updated_at are NOT NULL with no default -- verified against the
     CREATE TABLE. That insert would throw NOT NULL constraint failed. recordPurchase needs
     a facility anyway (defaultFacilityId), so a real one is created here. */
  db.prepare(
    `INSERT OR IGNORE INTO facilities (id, slug, kind, name, lat, lng, created_at, updated_at)
     VALUES (1, 'wh-1', 'warehouse', 'انبار', 35.7, 51.4, '2026-01-01', '2026-01-01')`
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO facilities (id, slug, kind, name, lat, lng, created_at, updated_at)
     VALUES (2, 'wh-2', 'warehouse', 'انبار ۲', 35.8, 51.5, '2026-01-01', '2026-01-01')`
  ).run();
  productId = Number(
    db
      .prepare(
        `INSERT INTO products (name, organization_id, avg_cost_toman, created_at, updated_at)
         VALUES ('کالای آزمایشی', ?, 0, '2026-01-01', '2026-01-01')`
      )
      .run(ORG).lastInsertRowid
  );
  supplierId = createSupplier(ORG, { name: "تأمین‌کننده آزمایشی", createdBy: 1 });
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const purchaseLegs = (purchaseId: number) =>
  getDb()
    .prepare(
      `SELECT a.code, e.side, e.amount_toman AS amount, e.supplier_id AS supplierId
         FROM ledger_entries e
         JOIN journals j ON j.id = e.journal_id
         JOIN accounts a ON a.id = e.account_id
        WHERE j.source_type = 'PURCHASE' AND j.source_id = ? ORDER BY a.code`
    )
    .all(purchaseId) as { code: string; side: string; amount: number; supplierId: number | null }[];

const buy = (base_qty: number, unit_cost_toman: number, purchase_date: string) =>
  recordPurchase(getDb(), {
    organization_id: ORG,
    created_by: 1,
    supplier_id: supplierId,
    purchase_date,
    supplier: "تأمین‌کننده آزمایشی",
    lines: [{ product_id: productId, base_qty, unit_cost_toman }],
  });

describe("accounts payable", () => {
  it("a purchase posts Dr inventory / Cr payables, carrying the supplier", () => {
    const id = buy(10, 100_000, "2026-07-15");
    const legs = purchaseLegs(id);
    expect(legs.length).toBe(2);
    expect(legs.find((l) => l.code === "1203")).toMatchObject({ side: "D", amount: 1_000_000 });
    const credit = legs.find((l) => l.code === "2101")!;
    expect(credit.side).toBe("C");
    expect(credit.supplierId).toBe(supplierId);
  });

  it("a ZERO-total purchase posts NO journal but still records the purchase", () => {
    const id = buy(5, 0, "2026-07-16");
    expect(purchaseLegs(id)).toHaveLength(0);
    expect(getDb().prepare("SELECT id FROM purchases WHERE id = ?").get(id)).toBeDefined();
  });

  it("roundToman and Math.round disagree exactly where it matters", () => {
    expect(roundToman(-0.5)).toBe(-1);
    expect(Math.round(-0.5)).toBe(-0); // the bug roundToman exists to prevent
  });

  it("paying a supplier posts Dr payables / Cr cash", () => {
    const journalId = postSupplierPayment(getDb(), {
      organizationId: ORG,
      supplierId,
      amountToman: 400_000,
      method: "CASH",
      paidAt: "2026-07-20T10:00:00.000Z",
      paidBy: 1,
    });
    const legs = getDb()
      .prepare(
        `SELECT a.code, e.side, e.amount_toman AS amount FROM ledger_entries e
           JOIN accounts a ON a.id = e.account_id WHERE e.journal_id = ?`
      )
      .all(journalId) as { code: string; side: string; amount: number }[];
    expect(legs.find((l) => l.code === "2101")).toMatchObject({ side: "D", amount: 400_000 });
    expect(legs.find((l) => l.code === "1101")).toMatchObject({ side: "C", amount: 400_000 });
  });

  it("an OVERPAYMENT puts the excess in prepayment, never a negative payable", () => {
    /* Owe 600,000, hand over 900,000. The split is STATED by the caller, because this
       function reading a balance itself would silently override a decision the caller
       already made. Note 1301 is DEBITED: the excess is money we have handed over and
       expect goods for, so it is an asset. Crediting it -- the intuitive-looking version --
       gives debits 600,000 against credits 1,500,000 and does not balance at all. */
    const journalId = postSupplierPayment(getDb(), {
      organizationId: ORG,
      supplierId,
      amountToman: 900_000,
      payableToman: 600_000,
      overpayToPrepayment: true,
      method: "CASH",
      paidAt: "2026-07-21T10:00:00.000Z",
      paidBy: 1,
    });
    const legs = getDb()
      .prepare(
        `SELECT a.code, e.side, e.amount_toman AS amount FROM ledger_entries e
           JOIN accounts a ON a.id = e.account_id WHERE e.journal_id = ?`
      )
      .all(journalId) as { code: string; side: string; amount: number }[];
    expect(legs.find((l) => l.code === "2101")).toMatchObject({ side: "D", amount: 600_000 });
    expect(legs.find((l) => l.code === "1301")).toMatchObject({ side: "D", amount: 300_000 });
    expect(legs.find((l) => l.code === "1101")).toMatchObject({ side: "C", amount: 900_000 });
  });

  it("refuses a payment larger than the payable it claims to clear", () => {
    expect(() =>
      postSupplierPayment(getDb(), {
        organizationId: ORG,
        supplierId,
        amountToman: 100_000,
        payableToman: 500_000,
        method: "CASH",
        paidAt: "2026-07-22T10:00:00.000Z",
        paidBy: 1,
      })
    ).toThrow();
  });

  it("keeps the ledger balanced through every payable movement", () => {
    const tb = trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("scopes suppliers per organization", () => {
    getDb()
      .prepare(
        "INSERT OR IGNORE INTO organizations (id, name, slug, created_at) VALUES (2, 'Second', 'second', '2026-01-01')"
      )
      .run();
    expect(listSuppliers(ORG).map((s) => s.name)).toContain("تأمین‌کننده آزمایشی");
    expect(listSuppliers(2)).toHaveLength(0);
  });

  it("keeps two suppliers that differ only in whitespace DISTINCT", () => {
    /* The plan folds free text into suppliers with INSERT ... SELECT DISTINCT TRIM(...), so
       "  ACME  " and "ACME" would collapse into ONE supplier. createSupplier normalises on
       the RAW name, so the two stay distinct -- and the legacy purchases.supplier TEXT column
       is kept precisely because it is the only record of what was originally typed when the
       two were not the same supplier. */
    createSupplier(ORG, { name: "  ACME  ", createdBy: 1 });
    createSupplier(ORG, { name: "ACME", createdBy: 1 });
    const acme = listSuppliers(ORG).filter((s) => s.name.trim() === "ACME");
    expect(acme).toHaveLength(2);
  });
});
