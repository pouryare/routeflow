import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-holds-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, submitOrder } = await import("@/lib/orders");
const { placeHold, releaseHold, activeHold } = await import("@/lib/repo/customerHolds");
const { holdProblem, holdActive, canReleaseHold } = await import("@/lib/customerHolds");
const { tehranTodayIso } = await import("@/lib/jalali");
const { addDaysIso } = await import("@/lib/flows/dates");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("hold rules", () => {
  const today = "2026-11-13";
  it("needs a reason and a date within 30 days", () => {
    expect(holdProblem({ reason: " ", expiresOn: "2026-11-20", today })).toMatch(/دلیل/);
    expect(holdProblem({ reason: "x", expiresOn: "2026-11-12", today })).toMatch(/تاریخ/);
    expect(holdProblem({ reason: "x", expiresOn: "2027-01-01", today })).toMatch(/۳۰/);
    expect(holdProblem({ reason: "x", expiresOn: "2026-11-20", today })).toBeNull();
  });
  it("holds through its last day, lapses after, and a release ends it", () => {
    expect(holdActive({ expires_on: today, released_at: null }, today)).toBe(true);
    expect(holdActive({ expires_on: "2026-11-12", released_at: null }, today)).toBe(false);
    expect(holdActive({ expires_on: "2026-11-30", released_at: "x" }, today)).toBe(false);
  });
  it("lets the placer or a manager release", () => {
    expect(canReleaseHold({ userId: 1, manager: false }, { placed_by: 1 })).toBe(true);
    expect(canReleaseHold({ userId: 2, manager: false }, { placed_by: 1 })).toBe(false);
    expect(canReleaseHold({ userId: 2, manager: true }, { placed_by: 1 })).toBe(true);
  });
});

let rep = 0, cust = 0, product = 0, packaging = 0;
const draft = async () =>
  ((await createOrder(getDb(), { customer_id: cust, order_date: "2026-11-13", created_by: rep, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }] } as never)) as unknown as { id: number }).id;

beforeAll(async () => {
  const db = getDb();
  rep = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('h-rep','x:y','م','phone_sales',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
  cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('H1','x','RESTAURANT','active','2026-01-01',1)").run()).lastInsertRowid);
  await ensureWarehouse(db);
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 100 });
  await setPrice(db, { product_id: product, packaging_id: packaging, price_toman: 1000, valid_from: "2026-01-01", organization_id: 1 } as never);
});

describe("a hold on a customer", () => {
  it("sends a new order to the manager's inbox, and a release lets the next one through", async () => {
    const today = tehranTodayIso();
    expect(await placeHold(1, cust, rep, { reason: "چک برگشتی", expiresOn: addDaysIso(today, 7) })).toBeNull();
    expect((await activeHold(1, cust))?.reason).toBe("چک برگشتی");
    expect(await placeHold(1, cust, rep, { reason: "دوباره", expiresOn: addDaysIso(today, 7) })).toMatch(/نگه داشته/);
    expect(await submitOrder(1, await draft(), { id: rep, role: "phone_sales" })).toBe("PENDING_CREDIT");
    const row = (await getDb().prepare("SELECT kind FROM credit_approvals ORDER BY id DESC LIMIT 1").get()) as { kind: string };
    expect(row.kind).toBe("hold");
    expect(await releaseHold(1, cust, { userId: 999, manager: false })).toMatch(/فقط/);
    expect(await releaseHold(1, cust, { userId: rep, manager: false })).toBeNull();
    expect(await submitOrder(1, await draft(), { id: rep, role: "phone_sales" })).toBe("PENDING_REVIEW");
  });
});
