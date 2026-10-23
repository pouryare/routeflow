import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-ledger-cutover-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { recordPayment, voidPayment } = await import("@/lib/repo/payments");
const { trialBalance } = await import("@/lib/repo/ledger");

const ORG = 1;
let customerId = 0;

beforeAll(async () => {
  const db = getDb();
  await db.prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
     VALUES (?, 'cutover-tester', 'x', 'Cutover Tester', 'owner', ?, '2026-01-01')`
  ).run(1, ORG);
  /* customers has NO created_at column -- see the note in ledger-reconciliation.test.ts.
     The plan's version of this insert names it and would throw. */
  customerId = Number(
    (await db
      .prepare(
        `INSERT INTO customers (business_name, customer_code, organization_id, lifecycle, synced_at)
         VALUES ('مشتری برش', 'C-CUTOVER', ?, 'active', '2026-01-01')`
      )
      .run(ORG)).lastInsertRowid
  );
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/* `allocations` is deliberately OMITTED, never []. An empty array is truthy, so it skips
   autoAllocateFIFO and then fails the sum check (lib/repo/payments.ts:177). */
const receipt = async (amount_toman: number, method: string, received_at: string) =>
  await recordPayment(ORG, {
    customer_id: customerId,
    amount_toman,
    method: method as "CASH",
    received_at,
    received_by: 1,
  });

const legsOf = async (paymentId: number) =>
  await getDb()
    .prepare(
      `SELECT e.side, e.amount_toman AS amount, a.code, e.customer_id AS customerId
         FROM ledger_entries e
         JOIN journals j ON j.id = e.journal_id
         JOIN accounts a ON a.id = e.account_id
        WHERE j.source_type = 'PAYMENT' AND j.source_id = ? ORDER BY a.code`
    )
    .all(paymentId) as { side: string; amount: number; code: string; customerId: number | null }[];

describe("the payment cutover", () => {
  it("writes ONE balanced journal per receipt, cash against receivables", async () => {
    const id = await receipt(3_000_000, "CASH", "2026-07-20T09:00:00.000Z");
    const legs = await legsOf(id);
    expect(legs.length).toBe(2);
    expect(legs.find((l) => l.code === "1101")).toMatchObject({ side: "D", amount: 3_000_000 });
    const credit = legs.find((l) => l.code === "1201")!;
    expect(credit.side).toBe("C");
    expect(credit.amount).toBe(3_000_000);
    // The receivable leg carries the customer -- that is what makes ageing possible.
    expect(credit.customerId).toBe(customerId);
  });

  it("routes a non-cash method to the bank account, not the cash box", async () => {
    const id = await receipt(1_200_000, "CARD_TO_CARD", "2026-07-21T09:00:00.000Z");
    expect((await legsOf(id)).find((l) => l.code === "1102")).toMatchObject({
      side: "D",
      amount: 1_200_000,
    });
  });

  it("routes a CHEQUE to cheques receivable, which is an asset of its own", async () => {
    const id = await receipt(700_000, "CHEQUE", "2026-07-21T10:00:00.000Z");
    expect((await legsOf(id)).find((l) => l.code === "1202")).toMatchObject({
      side: "D",
      amount: 700_000,
    });
  });

  it("REFUSES a CREDIT_NOTE rather than guessing an account", async () => {
    await expect((async () => await receipt(500_000, "CREDIT_NOTE", "2026-07-21T11:00:00.000Z"))()).rejects.toThrow();
  });

  it("does NOT recognise revenue on a payment -- allocation posts nothing", async () => {
    const id = await receipt(500_000, "CASH", "2026-07-22T09:00:00.000Z");
    const codes = (await legsOf(id)).map((l) => l.code);
    expect(codes).not.toContain("4101"); // no revenue
    expect(codes).not.toContain("5101"); // no cost
  });

  it("keeps the whole ledger balanced after every receipt", async () => {
    const tb = await trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("posts a REVERSAL referencing the original when a payment is voided", async () => {
    const id = await receipt(900_000, "CASH", "2026-07-23T09:00:00.000Z");
    await voidPayment(ORG, id, 1, "اشتباه در ثبت");

    const reversal = await getDb()
      .prepare(
        `SELECT id, reverses_journal_id AS reverses FROM journals
          WHERE source_type = 'REVERSAL' AND source_id = ?`
      )
      .get(id) as { id: number; reverses: number };
    expect(reversal.reverses).toBeGreaterThan(0);
    expect(reversal.reverses).not.toBe(reversal.id); // never points at itself

    // The reversal's legs mirror the original, sides flipped.
    const revLegs = await getDb()
      .prepare(
        `SELECT a.code, e.side, e.amount_toman AS amount
           FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
          WHERE e.journal_id = ?`
      )
      .all(reversal.id) as { code: string; side: string; amount: number }[];
    expect(revLegs.find((l) => l.code === "1101")).toMatchObject({ side: "C", amount: 900_000 });
    expect(revLegs.find((l) => l.code === "1201")).toMatchObject({ side: "D", amount: 900_000 });
  });

  it("restores the exact prior balance of every account after a reversal", async () => {
    const before = (await trialBalance(ORG))
      .rows.map((r) => `${r.code}:${r.balance}`)
      .join("|");
    const id = await receipt(1_111_000, "CASH", "2026-07-24T09:00:00.000Z");
    await voidPayment(ORG, id, 1, "آزمون بازگشت");
    const after = (await trialBalance(ORG))
      .rows.map((r) => `${r.code}:${r.balance}`)
      .join("|");
    expect(after).toBe(before);
  });

  it("refuses to void the same payment twice, and reverses it exactly once", async () => {
    const id = await receipt(300_000, "CASH", "2026-07-25T09:00:00.000Z");
    await voidPayment(ORG, id, 1, "اول");
    await expect((async () => await voidPayment(ORG, id, 1, "دوم"))()).rejects.toThrow();
    const n = (
      await getDb()
        .prepare(
          "SELECT COUNT(*) AS n FROM journals WHERE source_type = 'REVERSAL' AND source_id = ?"
        )
        .get(id) as { n: number }
    ).n;
    expect(n).toBe(1);
  });
});
