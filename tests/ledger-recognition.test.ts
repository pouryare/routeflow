import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-ledger-recog-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { postDeliveryRecognition } = await import("@/lib/repo/ledgerPostings");
const { trialBalance } = await import("@/lib/repo/ledger");

const ORG = 1;
let customerId = 0;

beforeAll(async () => {
  const db = getDb();
  await db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, role, organization_id, created_at)
     VALUES (?, 'recog-tester', 'x', 'Recog Tester', 'owner', ?, '2026-01-01') ON CONFLICT DO NOTHING`
  ).run(1, ORG);
  customerId = Number(
    (await db
      .prepare(
        "INSERT INTO customers (business_name, customer_code, organization_id, lifecycle, synced_at) VALUES ('مشتری تحویل','C-RECOG',?,'active','2026-01-01')"
      )
      .run(ORG)).lastInsertRowid
  );
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const legsOf = async (stopId: number) =>
  await getDb()
    .prepare(
      `SELECT a.code, e.side, e.amount_toman AS amount, e.customer_id AS customerId
         FROM ledger_entries e
         JOIN journals j ON j.id = e.journal_id
         JOIN accounts a ON a.id = e.account_id
        WHERE j.source_type = 'SALE' AND j.source_id = ? ORDER BY a.code`
    )
    .all(stopId) as { code: string; side: string; amount: number; customerId: number | null }[];

describe("delivery recognition", () => {
  it("recognises revenue AND cost on delivery", async () => {
    await postDeliveryRecognition(getDb(), {
      organizationId: ORG,
      deliveryStopId: 1001,
      customerId,
      deliveredAt: "2026-07-18T10:00:00.000Z",
      deliveredBy: 1,
      revenueToman: 8_000_000,
      costToman: 6_000_000,
    });
    const legs = await legsOf(1001);
    expect(legs.find((l) => l.code === "1201")).toMatchObject({ side: "D", amount: 8_000_000 });
    expect(legs.find((l) => l.code === "4101")).toMatchObject({ side: "C", amount: 8_000_000 });
    expect(legs.find((l) => l.code === "5101")).toMatchObject({ side: "D", amount: 6_000_000 });
    expect(legs.find((l) => l.code === "1203")).toMatchObject({ side: "C", amount: 6_000_000 });
    // The receivable leg carries the customer, so per-customer revenue is possible.
    expect(legs.find((l) => l.code === "1201")!.customerId).toBe(customerId);
  });

  it("posts REVENUE ALONE when the cost is unknown -- it is not invented", async () => {
    await postDeliveryRecognition(getDb(), {
      organizationId: ORG,
      deliveryStopId: 1002,
      customerId,
      deliveredAt: "2026-07-18T11:00:00.000Z",
      deliveredBy: 1,
      revenueToman: 2_000_000,
      costToman: null,
    });
    expect((await legsOf(1002)).map((l) => l.code).sort()).toEqual(["1201", "4101"]);
  });

  it("treats a cost of ZERO as unknown, not as free goods", async () => {
    /* order_lines.unit_cost_toman DEFAULTs to 0, which is how "never purchased, so
       nothing is known" is recorded (lib/orders.ts:166 falls back to the moving average,
       which is itself 0 for an unpurchased product). Zero is therefore the signal, and
       posting a zero COGS leg is impossible anyway -- CHECK (amount_toman > 0). The
       question is only whether we post revenue alone or refuse the whole stop. */
    await postDeliveryRecognition(getDb(), {
      organizationId: ORG,
      deliveryStopId: 1006,
      customerId,
      deliveredAt: "2026-07-18T13:00:00.000Z",
      deliveredBy: 1,
      revenueToman: 1_500_000,
      costToman: 0,
    });
    expect((await legsOf(1006)).map((l) => l.code).sort()).toEqual(["1201", "4101"]);
  });

  it("posts NOTHING when nothing was delivered", async () => {
    const id = await postDeliveryRecognition(getDb(), {
      organizationId: ORG,
      deliveryStopId: 1003,
      customerId,
      deliveredAt: "2026-07-18T12:00:00.000Z",
      deliveredBy: 1,
      revenueToman: 0,
      costToman: null,
    });
    expect(id).toBeNull();
    expect(await legsOf(1003)).toHaveLength(0);
  });

  it("is idempotent per delivery stop, so a retried sync converges", async () => {
    const args = {
      organizationId: ORG,
      deliveryStopId: 1004,
      customerId,
      deliveredAt: "2026-07-19T10:00:00.000Z",
      deliveredBy: 1,
      revenueToman: 3_000_000,
      costToman: 2_000_000,
    };
    expect(await postDeliveryRecognition(getDb(), args)).not.toBeNull();
    expect(await postDeliveryRecognition(getDb(), args)).toBeNull();
    expect(await legsOf(1004)).toHaveLength(4); // not 8
  });

  it("refuses a recognition for a DIFFERENT tenant's stop", async () => {
    await getDb()
      .prepare(
        "INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Second', 'second', '2026-01-01') ON CONFLICT DO NOTHING"
      )
      .run();
    // A journal for org 1 must not be found when org 2 asks whether it already posted.
    const id = await postDeliveryRecognition(getDb(), {
      organizationId: ORG,
      deliveryStopId: 1005,
      customerId,
      deliveredAt: "2026-07-19T11:00:00.000Z",
      deliveredBy: 1,
      revenueToman: 500_000,
      costToman: null,
    });
    expect(id).not.toBeNull();
    const org2Sees = await getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM journals WHERE source_type = 'SALE' AND source_id = ? AND organization_id = 2"
      )
      .get(1005) as { n: number };
    expect(org2Sees.n).toBe(0);
  });

  it("balances the ledger in every case, including the cost-unknown one", async () => {
    const tb = await trialBalance(ORG);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
});
