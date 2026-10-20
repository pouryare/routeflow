import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-input-validation-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, OrderError } = await import("@/lib/orders");
const { recordPayment, PaymentError } = await import("@/lib/repo/payments");
const { isToman, MAX_TOMAN } = await import("@/lib/money");
const { parsePacks, isValidPacks, MAX_PACKS_PER_LINE } = await import("@/lib/orderLimits");
const { tehranTodayIso } = await import("@/lib/jalali");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0, customer = 0, product = 0, packaging = 0;
const today = tehranTodayIso();

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  owner = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('o','x','م','owner',1,?,1)").run(now).lastInsertRowid);
  customer = Number(db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C','x','active',?,1)").run(now).lastInsertRowid);
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2020-01-01" });
});

const order = (packs: unknown, extra: Record<string, unknown> = {}) =>
  createOrder(getDb(), {
    customer_id: customer, order_date: today, created_by: owner, organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs: packs as number }], ...extra,
  } as never);

describe("order input", () => {
  it("accepts a normal and a fractional quantity", () => {
    expect(order(2).id).toBeGreaterThan(0);
    expect(order(1.5).id).toBeGreaterThan(0);
  });
  it.each([0, -3, 1e12, MAX_PACKS_PER_LINE + 1, NaN, null, "5", 1.2345])("refuses packs = %s", (packs) => {
    expect(() => order(packs)).toThrow(OrderError);
  });
  it("refuses a date years ahead or years back", () => {
    expect(() => order(1, { order_date: "2999-01-01" })).toThrow(OrderError);
    expect(() => order(1, { order_date: "1900-01-01" })).toThrow(OrderError);
  });
  it("refuses oversized notes and too many lines", () => {
    expect(() => order(1, { notes: "x".repeat(2001) })).toThrow(OrderError);
    const lines = Array.from({ length: 201 }, () => ({ product_id: product, packaging_id: packaging, packs: 1 }));
    expect(() => createOrder(getDb(), { customer_id: customer, order_date: today, created_by: owner, organization_id: 1, lines })).toThrow(OrderError);
  });
});

describe("packs parsing", () => {
  it("reads Persian digits and refuses junk", () => {
    expect(parsePacks("۵")).toBe(5);
    expect(parsePacks("۱٫۵")).toBe(1.5);
    for (const bad of ["", "abc", "-3", "0", "1e3", "5 6x", "100001"]) expect(parsePacks(bad)).toBeNull();
    expect(isValidPacks(0.0004)).toBe(false);
  });
});

describe("money input", () => {
  it("caps a single amount", () => {
    expect(isToman(MAX_TOMAN)).toBe(true);
    expect(isToman(MAX_TOMAN + 1)).toBe(false);
    expect(isToman(9007199254740993)).toBe(false);
    expect(isToman(1.5)).toBe(false);
  });
  const pay = (amount: number, received_at = new Date().toISOString()) =>
    recordPayment(1, { customer_id: customer, amount_toman: amount, method: "CASH", received_at, received_by: owner } as never);
  it("refuses an absurd amount and a bad or far-future date", () => {
    expect(pay(1000)).toBeGreaterThan(0);
    expect(() => pay(1e15)).toThrow(PaymentError);
    expect(() => pay(9007199254740993)).toThrow(PaymentError);
    expect(() => pay(1000, "not-a-date")).toThrow(PaymentError);
    expect(() => pay(1000, "2999-01-01T00:00:00Z")).toThrow(PaymentError);
  });
});
