import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-doorsale-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { recordMovementsTxn, onHand } = await import("@/lib/repo/stock");
const vs = await import("@/lib/repo/vanStock");
const ds = await import("@/lib/repo/doorSale");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("VC4 door sale and samples", () => {
  let driver = 0, customer = 0, product = 0, packaging = 0, wh = 0, van = 0;
  const loaded = 100; // base units on the van: 10 packs of 10

  beforeAll(async () => {
    const db = getDb();
    const now = new Date().toISOString();
    driver = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('ds-d','x:y','علی','delivery_driver',1,?,1)").run(now)).lastInsertRowid);
    customer = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('DS1','رستوران تست','RESTAURANT','active','2026-01-01',1)").run()).lastInsertRowid);
    await db.prepare("INSERT INTO vehicles (name, plate, driver_default_id, active, organization_id, created_at, updated_at) VALUES ('نیسان','12-345',?,1,1,?,?)").run(driver, now, now);
    await ensureWarehouse(db);
    wh = (await db.prepare("SELECT id FROM facilities WHERE organization_id = 1 AND kind = 'warehouse' LIMIT 1").get() as { id: number }).id;
    product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
    packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
    await setPrice(db, { product_id: product, price_toman: 5_000, valid_from: "2026-01-01" });
    await recordMovementsTxn(db, 1, [{ facility_id: wh, product_id: product, batch_id: null, base_qty: 500, kind: "PURCHASE_IN", ref_type: "test", occurred_at: now, created_by: null }]);
    van = (await vs.vansToLoad(1))[0].facility_id;
    await vs.loadVanChecked(1, { facilityId: van, productId: product, qty: loaded, actorId: driver });
  });

  const line = (packs: number) => ({ product_id: product, packaging_id: packaging, packs });

  it("offers only whole packs the van holds, priced", async () => {
    const e = await ds.doorSaleEntry(1, driver);
    expect(e.hasVan).toBe(true);
    expect(e.items).toEqual([expect.objectContaining({ packaging_id: packaging, packs_on_van: 10, price_toman: 5_000 })]);
  });

  it("sells from the van, takes the cash, and takes the goods off the van only", async () => {
    const r = await ds.sellAtDoor(1, { id: driver, canDrive: true }, { customer_id: customer, lines: [line(2)], collected_toman: 10_000, client_uuid: "sale-1" });
    expect(r).toMatchObject({ total_toman: 10_000, collected_toman: 10_000, held: null });
    const db = getDb();
    const o = await db.prepare("SELECT status, paid_toman, channel FROM orders WHERE id = ?").get(r.order_id) as { status: string; paid_toman: number; channel: string };
    expect(o).toMatchObject({ paid_toman: 10_000, channel: "driver" });
    expect(["DELIVERED", "CLOSED"]).toContain(o.status);
    expect(await vs.vanOnHand(1, van, product)).toBe(loaded - 20);
    // The warehouse was debited once, when the van was loaded, and not again at the door.
    expect(await onHand(1, { product_id: product, facility_id: wh })).toBe(500 - loaded);
    const stop = await db.prepare("SELECT status FROM delivery_stops WHERE order_id = ?").get(r.order_id) as { status: string };
    expect(stop.status).toBe("delivered");
  });

  it("a resent request is answered, not sold twice", async () => {
    const again = await ds.sellAtDoor(1, { id: driver, canDrive: true }, { customer_id: customer, lines: [line(2)], collected_toman: 10_000, client_uuid: "sale-1" });
    expect(again.duplicate).toBe(true);
    expect(await vs.vanOnHand(1, van, product)).toBe(loaded - 20);
  });

  it("a sale on account leaves the cash at zero", async () => {
    const r = await ds.sellAtDoor(1, { id: driver, canDrive: true }, { customer_id: customer, lines: [line(1)], collected_toman: 0 });
    expect(r).toMatchObject({ total_toman: 5_000, collected_toman: 0, held: null });
    expect(await vs.vanOnHand(1, van, product)).toBe(loaded - 30);
  });

  it("refuses more than the van holds, and more cash than the sale plus the debt", async () => {
    await expect(ds.sellAtDoor(1, { id: driver, canDrive: true }, { customer_id: customer, lines: [line(99)], collected_toman: 0 })).rejects.toThrow(/نیست/);
    await expect(ds.sellAtDoor(1, { id: driver, canDrive: true }, { customer_id: customer, lines: [line(1)], collected_toman: 999_999_999 })).rejects.toThrow(/بیشتر/);
    // Nothing was written by the refusals.
    expect(await vs.vanOnHand(1, van, product)).toBe(loaded - 30);
  });

  it("a shop that paid ahead can still buy and pay cash", async () => {
    const db = getDb();
    const { recordPaymentTxn } = await import("@/lib/repo/payments");
    const c2 = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('DS2','فروشگاه پیش‌پرداخت','RESTAURANT','active','2026-01-01',1)").run()).lastInsertRowid);
    await recordPaymentTxn(db, 1, { customer_id: c2, amount_toman: 50_000, method: "CASH", received_at: new Date().toISOString(), received_by: driver, allocations: [{ order_id: null, amount_toman: 50_000 }], allow_overpay: true });
    const r = await ds.sellAtDoor(1, { id: driver, canDrive: true }, { customer_id: c2, lines: [line(1)], collected_toman: 5_000 });
    expect(r).toMatchObject({ total_toman: 5_000, collected_toman: 5_000, held: null });
    await vs.loadVanChecked(1, { facilityId: van, productId: product, qty: 10, actorId: driver });
  });

  it("a person who cannot drive is told to take the order for later", async () => {
    await expect(ds.sellAtDoor(1, { id: driver, canDrive: false }, { customer_id: customer, lines: [line(1)], collected_toman: 0 })).rejects.toThrow(/برای بعد/);
  });

  it("a sample leaves the van, makes no order and no debt, and is counted", async () => {
    const db = getDb();
    const orders = Number((await db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n);
    const r = await ds.giveSamples(1, { id: driver }, { customer_id: customer, lines: [line(1)], client_uuid: "samp-1", note: "برای آزمایش" });
    expect(r.ids).toHaveLength(1);
    expect(await vs.vanOnHand(1, van, product)).toBe(loaded - 40);
    expect(Number((await db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n)).toBe(orders);
    const mv = await db.prepare("SELECT kind, base_qty FROM stock_movements WHERE ref_type = 'sample' AND ref_id = ?").get(r.ids[0]) as { kind: string; base_qty: number };
    expect(mv).toEqual({ kind: "SAMPLE_OUT", base_qty: -10 });
    const again = await ds.giveSamples(1, { id: driver }, { customer_id: customer, lines: [line(1)], client_uuid: "samp-1" });
    expect(again.duplicate).toBe(true);
    expect(await vs.vanOnHand(1, van, product)).toBe(loaded - 40);
    await expect(ds.giveSamples(1, { id: driver }, { customer_id: customer, lines: [line(99)] })).rejects.toThrow(/نیست/);
    expect((await ds.doorSaleEntry(1, driver)).today).toMatchObject({ sales: 3, samples: 1 });
  });

  it("the sample report counts a shop that buys after the sample", async () => {
    const rows = await ds.sampleReport(1, 30);
    // The shop bought (the door sales above) after the sample's day or on it; the order must be strictly later.
    expect(rows).toEqual([expect.objectContaining({ user_id: driver, given: 1, customers: 1 })]);
  });
});
