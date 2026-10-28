import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `ledger-commission-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery } = await import("@/lib/delivery");
const { setRate, statementFor } = await import("@/lib/commissionLedger");
const { paySales } = await import("@/lib/repo/routeAdapters");
const { syncCommissionAccrual, syncOnePerson } = await import("@/lib/repo/ledgerCommission");
const { trialBalance } = await import("@/lib/repo/ledger");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = {
  group: 0,
  owner: 0,
  nazanin: 0,
  yasamin: 0,
  driver: 0,
  customer: 0,
  product: 0,
  packaging: 0,
};

/** Confirms an order and delivers every line in full. */
async function sellAndDeliver(packs: number, orderDate: string, seller: number | null): Promise<number> {
  const db = getDb();
  const order = await createOrder(db, {
    customer_id: ctx.customer,
    order_date: orderDate,
    created_by: ctx.owner,
    organization_id: 1,
    salesperson_user_id: seller,
    lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs }],
  });
  await confirmOrder(db, order.id);

  const run = await createRun(db, {
    driver_user_id: ctx.driver,
    run_date: orderDate,
    created_by: ctx.owner,
    organization_id: 1,
  });
  const stopId = await addStop(db, run, order.id);
  const stop = (await readRun(db, run))!.stops.find((s) => s.id === stopId)!;
  await recordDelivery(db, stopId, {
    lines: stop.lines.map((l) => ({ line_id: l.id, packs_delivered: packs })),
    collected_toman: 0,
    by: ctx.driver,
  });
  return order.id;
}

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();

  ctx.group = Number(
    (await db
      .prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run("شرق", "east", "#0ff", now)).lastInsertRowid
  );
  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, 'x', ?, ?, ?, 1, ?, 1)"
  );
  ctx.owner = Number((await user.run("o", "مالک", "owner", null, now)).lastInsertRowid);
  ctx.nazanin = Number((await user.run("nazanin", "نازنین", "phone_sales", ctx.group, now)).lastInsertRowid);
  ctx.yasamin = Number((await user.run("yasamin", "یاسمین", "phone_sales", ctx.group, now)).lastInsertRowid);
  ctx.driver = Number((await user.run("d", "راننده", "delivery_driver", ctx.group, now)).lastInsertRowid);

  ctx.customer = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)"
      )
      .run("C1", "رستوران نمونه", ctx.group, now)).lastInsertRowid
  );

  ctx.product = await createProduct(db, { name: "کره گیاهی", kg_per_base_unit: 0.25, organization_id: 1 });
  ctx.packaging = await createPackaging(db, { product_id: ctx.product, name: "جعبه", qty_per_pack: 100 });
  await setPrice(db, { product_id: ctx.product, price_toman: 440000, valid_from: "2026-01-01" });

  // 2000 تومان per kilogram for everyone, from the start of the year.
  await setRate(db, { rate_per_kg_toman: 2000, valid_from: "2026-01-01", created_by: ctx.owner });
});


const net = async (code: string) => {
  const t = await trialBalance(1);
  return t.rows.find((r) => r.code === code)?.balance ?? 0;
};

describe("commission in the ledger", () => {
  it("posts the accrual once, tagged with the person and their group, and not again", async () => {
    await sellAndDeliver(2, "2026-05-10", ctx.nazanin); // 50 kg x 2000 = 100,000
    expect(await syncCommissionAccrual(getDb(), { organizationId: 1, asOf: "2026-05-31", createdBy: ctx.owner })).toBe(1);
    expect(await net("5107")).toBe(100000);
    expect(await net("2103")).toBe(100000);

    const leg = await getDb()
      .prepare(
        `SELECT e.group_id, p.user_id FROM ledger_entries e JOIN parties p ON p.id = e.party_id
           JOIN accounts a ON a.id = e.account_id WHERE a.code = '5107'`
      )
      .get() as { group_id: number; user_id: number };
    expect(leg).toEqual({ group_id: ctx.group, user_id: ctx.nazanin });

    expect(await syncCommissionAccrual(getDb(), { organizationId: 1, asOf: "2026-05-31", createdBy: ctx.owner })).toBe(0);
    expect(await net("5107")).toBe(100000);
  });

  it("tags the revenue and cost legs of a delivery with the customer's group", async () => {
    const legs = await getDb()
      .prepare(
        `SELECT a.code, e.group_id FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
          WHERE a.code IN ('4101', '1201')`
      )
      .all() as { code: string; group_id: number | null }[];
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.every((l) => l.group_id === ctx.group)).toBe(true);
  });

  it("posts only the difference when the accrual grows or a backdated rate cuts it", async () => {
    const db = getDb();
    await sellAndDeliver(2, "2026-06-10", ctx.nazanin); // +100,000
    await syncOnePerson(db, { organizationId: 1, kind: "sales", personId: ctx.nazanin, asOf: "2026-06-30", createdBy: ctx.owner });
    expect(await net("5107")).toBe(200000);

    await setRate(db, { salesperson_user_id: ctx.nazanin, rate_per_kg_toman: 1000, valid_from: "2026-01-01", created_by: ctx.owner });
    await syncOnePerson(db, { organizationId: 1, kind: "sales", personId: ctx.nazanin, asOf: "2026-06-30", createdBy: ctx.owner });
    const lifetime = (await statementFor(db, ctx.nazanin, { from: "0000-01-01", to: "9999-12-31" })).accrued_toman;
    expect(lifetime).toBe(100000); // 100 kg x 1000
    expect(await net("5107")).toBe(lifetime);
    expect(await net("2103")).toBe(lifetime);
  });

  it("books a payment as Dr 2103 / Cr cash, after bringing the accrual up to date", async () => {
    const before = await net("1101");
    await paySales({ salesperson_user_id: ctx.nazanin, amount_toman: 60000, paid_on: "2026-07-01", created_by: ctx.owner });
    expect(await net("2103")).toBe(40000); // 100,000 accrued - 60,000 paid
    expect(await net("1101")).toBe(before - 60000);
  });

  it("is refused in a closed period, and the payment row rolls back", async () => {
    const db = getDb();
    await db.prepare("INSERT INTO fiscal_periods (organization_id, period_key, status, created_at) VALUES (1, '1405-04', 'closed', ?) ON CONFLICT DO NOTHING").run(new Date().toISOString());
    await db.prepare("UPDATE fiscal_periods SET status = 'closed' WHERE organization_id = 1 AND period_key = '1405-04'").run();
    const paidBefore = (await db.prepare("SELECT COUNT(*) AS n FROM commission_payments").get() as { n: number }).n;
    // 1405-04 is Tir 1405 = 2026-06-22 .. 2026-07-22
    await expect(
      paySales({ salesperson_user_id: ctx.nazanin, amount_toman: 1000, paid_on: "2026-07-05", created_by: ctx.owner })
    ).rejects.toThrow();
    expect((await db.prepare("SELECT COUNT(*) AS n FROM commission_payments").get() as { n: number }).n).toBe(paidBefore);
  });
});
