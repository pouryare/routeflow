import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-input-validation-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
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

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  owner = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('o','x','م','owner',1,?,1)").run(now)).lastInsertRowid);
  customer = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('C','x','active',?,1)").run(now)).lastInsertRowid);
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  await setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2020-01-01" });
});

const order = async (packs: unknown, extra: Record<string, unknown> = {}) =>
  await createOrder(getDb(), {
    customer_id: customer, order_date: today, created_by: owner, organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs: packs as number }], ...extra,
  } as never);

describe("order input", () => {
  it("accepts a normal and a fractional quantity", async () => {
    expect((await order(2)).id).toBeGreaterThan(0);
    expect((await order(1.5)).id).toBeGreaterThan(0);
  });
  it.each([0, -3, 1e12, MAX_PACKS_PER_LINE + 1, NaN, null, "5", 1.2345])("refuses packs = %s", async (packs) => {
    await expect((async () => await order(packs))()).rejects.toThrow(OrderError);
  });
  it("refuses a date years ahead or years back", async () => {
    await expect((async () => await order(1, { order_date: "2999-01-01" }))()).rejects.toThrow(OrderError);
    await expect((async () => await order(1, { order_date: "1900-01-01" }))()).rejects.toThrow(OrderError);
  });
  it("refuses oversized notes and too many lines", async () => {
    await expect((async () => await order(1, { notes: "x".repeat(2001) }))()).rejects.toThrow(OrderError);
    const lines = Array.from({ length: 201 }, () => ({ product_id: product, packaging_id: packaging, packs: 1 }));
    await expect((async () => await createOrder(getDb(), { customer_id: customer, order_date: today, created_by: owner, organization_id: 1, lines }))()).rejects.toThrow(OrderError);
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
  const pay = async (amount: number, received_at = new Date().toISOString()) =>
    await recordPayment(1, { customer_id: customer, amount_toman: amount, method: "CASH", received_at, received_by: owner } as never);
  it("refuses an absurd amount and a bad or far-future date", async () => {
    expect(await pay(1000)).toBeGreaterThan(0);
    await expect((async () => await pay(1e15))()).rejects.toThrow(PaymentError);
    await expect((async () => await pay(9007199254740993))()).rejects.toThrow(PaymentError);
    await expect((async () => await pay(1000, "not-a-date"))()).rejects.toThrow(PaymentError);
    await expect((async () => await pay(1000, "2999-01-01T00:00:00Z"))()).rejects.toThrow(PaymentError);
  });
});

describe("shape checks", () => {
  it("dates", async () => {
    const { isIsoDay, isDayWithin, isTimestampWithin } = await import("@/lib/inputChecks");
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(isIsoDay("zzz")).toBe(false);
    expect(isIsoDay("2026-10-20")).toBe(true);
    const now = Date.parse("2026-10-20T00:00:00Z");
    expect(isDayWithin("2026-10-25", 366, 366, now)).toBe(true);
    expect(isDayWithin("1900-01-01", 366, 366, now)).toBe(false);
    expect(isDayWithin("2999-01-01", 366, 366, now)).toBe(false);
    expect(isTimestampWithin("not-a-date", 10, 10, now)).toBe(false);
  });
  it("quantities and text", async () => {
    const { isQuantity, boundedText } = await import("@/lib/inputChecks");
    expect(isQuantity(10, 1e9)).toBe(true);
    expect(isQuantity(-5, 1e9)).toBe(true);
    for (const bad of [1e15, NaN, Infinity, "5", 1.2345]) expect(isQuantity(bad, 1e9)).toBe(false);
    expect(boundedText("  ab ", 5)).toBe("ab");
    expect(boundedText("x".repeat(6), 5)).toBeNull();
    expect(boundedText(5, 5)).toBeNull();
  });
});

describe("routing routes validate the plan they are given", () => {
  const src = (f: string) => fs.readFileSync(f, "utf8");
  it("the plan route refuses a date outside the planning window", () => {
    expect(src("app/api/sales/routing/plan/route.ts")).toMatch(/isDayWithin\(b\.date, 30, 120\)/);
  });
  it("the commit route checks the date and every figure before committing", () => {
    const s = src("app/api/sales/routing/commit/route.ts");
    expect(s).toMatch(/isDayWithin\(b\.plan\.date, 30, 120\)/);
    expect(s.indexOf("sane(a.distance_km")).toBeGreaterThan(-1);
    expect(s.indexOf("sane(a.distance_km")).toBeLessThan(s.indexOf("commitPlan("));
  });
});
