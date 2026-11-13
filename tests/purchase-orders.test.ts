import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isLate, poProblem, statusAfterAction, statusAfterReceipt } from "@/lib/purchaseOrders";

const testDbPath = path.join(os.tmpdir(), `rf-po-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct } = await import("@/lib/catalogue");
const { recordPurchase } = await import("@/lib/purchases");
const po = await import("@/lib/repo/purchaseOrders");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("purchase order rules", () => {
  it("moves status by what arrived and by what the owner does", () => {
    expect(statusAfterReceipt("ordered", [{ base_qty: 100, received_qty: 0 }])).toBe("ordered");
    expect(statusAfterReceipt("ordered", [{ base_qty: 100, received_qty: 40 }])).toBe("partly_received");
    expect(statusAfterReceipt("ordered", [{ base_qty: 100, received_qty: 100 }, { base_qty: 5, received_qty: 5 }])).toBe("received");
    expect(statusAfterAction("draft", "send")).toBe("ordered");
    expect(statusAfterAction("partly_received", "close")).toBe("closed");
    expect(statusAfterAction("received", "cancel")).toBeNull();
  });
  it("is late only when open and past its day, and refuses empty or odd input", () => {
    expect(isLate("ordered", "2026-11-01", "2026-11-13")).toBe(true);
    expect(isLate("received", "2026-11-01", "2026-11-13")).toBe(false);
    expect(isLate("ordered", null, "2026-11-13")).toBe(false);
    expect(poProblem({ expected_date: null, lines: [] })).toMatch(/بدون قلم/);
    expect(poProblem({ expected_date: "فردا", lines: [{ base_qty: 1, unit_cost_toman: 1 }] })).toMatch(/تاریخ/);
    expect(poProblem({ expected_date: null, lines: [{ base_qty: 1, unit_cost_toman: 1.5 }] })).toMatch(/تومان/);
  });
});

describe("F66 receiving against an order", () => {
  let user = 0, supplier = 0, other = 0, butter = 0, cheese = 0;
  beforeAll(async () => {
    const db = getDb();
    const now = new Date().toISOString();
    user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('po-o','x:y','م','owner',1,?,1)").run(now)).lastInsertRowid);
    supplier = Number((await db.prepare("INSERT INTO suppliers (name, organization_id, created_at) VALUES ('تأمین', 1, ?)").run(now)).lastInsertRowid);
    other = Number((await db.prepare("INSERT INTO organizations (name, slug, created_at) VALUES ('دیگر','po-other','2026-01-01')").run()).lastInsertRowid);
    await ensureWarehouse(db);
    butter = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
    cheese = await createProduct(db, { name: "پنیر", kg_per_base_unit: 1, organization_id: 1 });
  });
  const receive = (orderId: number, lines: { product_id: number; base_qty: number }[]) =>
    recordPurchase(getDb(), { supplier_id: supplier, purchase_date: "2026-11-13", created_by: user, organization_id: 1, purchase_order_id: orderId, lines: lines.map((l) => ({ ...l, unit_cost_toman: 1000 })) });

  it("lists the company's active products for the hand-made form", async () => {
    expect((await po.productPickList(1)).map((p) => p.label)).toEqual(expect.arrayContaining(["کره", "پنیر"]));
  });

  it("a draft is not open for goods; sending it opens it; two receipts finish it", async () => {
    const id = await po.createPurchaseOrder(1, { supplier_id: supplier, expected_date: "2026-11-20", created_by: user, lines: [{ product_id: butter, base_qty: 100, unit_cost_toman: 1000 }, { product_id: cheese, base_qty: 50, unit_cost_toman: 2000 }] });
    await expect(receive(id, [{ product_id: butter, base_qty: 10 }])).rejects.toThrow(/منتظر کالا نیست/);
    await po.actOnPurchaseOrder(1, id, "send");
    expect((await po.incomingByProduct(1)).get(butter)).toEqual({ qty: 100, expected: "2026-11-20" });
    await receive(id, [{ product_id: butter, base_qty: 100 }, { product_id: cheese, base_qty: 20 }]);
    let row = (await po.listPurchaseOrders(1)).find((r) => r.id === id)!;
    expect(row.status).toBe("partly_received");
    expect((await po.incomingByProduct(1)).get(cheese)?.qty).toBe(30);
    expect((await po.incomingByProduct(1)).has(butter)).toBe(false);
    await receive(id, [{ product_id: cheese, base_qty: 35 }]); // 5 more than asked: stays on the receipt only
    row = (await po.listPurchaseOrders(1)).find((r) => r.id === id)!;
    expect(row.status).toBe("received");
    expect(row.lines.find((l) => l.product_id === cheese)!.received_qty).toBe(50);
  });

  it("raises one alert when a receipt's price differs from the order's, and none when it matches", async () => {
    const { priceGapPercent } = await import("@/lib/purchaseOrders");
    expect(priceGapPercent(1000, 1100)).toBe(10);
    expect(priceGapPercent(1000, 900)).toBe(-10);
    expect(priceGapPercent(1000, 1000)).toBeNull();
    expect(priceGapPercent(0, 500)).toBeNull();
    expect(priceGapPercent(100000, 100001)).toBe(1);
    const id = await po.createPurchaseOrder(1, { supplier_id: supplier, expected_date: null, created_by: user, send: true, lines: [{ product_id: butter, base_qty: 10, unit_cost_toman: 1000 }] });
    const alerts = async () => Number(((await getDb().prepare("SELECT COUNT(*) AS n FROM alerts WHERE category = 'po_price_diff' AND entity_id = ?").get(id)) as { n: number }).n);
    await recordPurchase(getDb(), { supplier_id: supplier, purchase_date: "2026-11-13", created_by: user, organization_id: 1, purchase_order_id: id, lines: [{ product_id: butter, base_qty: 4, unit_cost_toman: 1000 }] });
    expect(await alerts()).toBe(0);
    await recordPurchase(getDb(), { supplier_id: supplier, purchase_date: "2026-11-13", created_by: user, organization_id: 1, purchase_order_id: id, lines: [{ product_id: butter, base_qty: 6, unit_cost_toman: 1200 }] });
    expect(await alerts()).toBe(1);
    const a = (await getDb().prepare("SELECT title FROM alerts WHERE category = 'po_price_diff' AND entity_id = ?").get(id)) as { title: string };
    expect(a.title).toContain("۲۰٪ بیشتر");
  });

  it("can be closed short, and an order of another company is not found", async () => {
    const id = await po.createPurchaseOrder(1, { supplier_id: supplier, expected_date: null, created_by: user, send: true, lines: [{ product_id: butter, base_qty: 10, unit_cost_toman: 1 }] });
    await receive(id, [{ product_id: butter, base_qty: 4 }]);
    expect(await po.actOnPurchaseOrder(1, id, "close")).toBe("closed");
    expect((await po.incomingByProduct(1)).has(butter)).toBe(false);
    await expect(po.actOnPurchaseOrder(other, id, "cancel")).rejects.toThrow(/پیدا نشد/);
    await expect(po.createPurchaseOrder(other, { supplier_id: supplier, expected_date: null, created_by: user, lines: [{ product_id: butter, base_qty: 1, unit_cost_toman: 1 }] })).rejects.toThrow(/پیدا نشد/);
  });
});
