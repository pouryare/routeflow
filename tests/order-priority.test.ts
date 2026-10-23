import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { canSetPriority, isSettablePriority, priorityLabel, priorityTagged } from "@/lib/orderPriority";

describe("order priority rules", () => {
  it("only NORMAL and URGENT can be set by hand", () => {
    expect(isSettablePriority("URGENT")).toBe(true);
    expect(isSettablePriority("KEY_ACCOUNT")).toBe(false);
    expect(isSettablePriority(1)).toBe(false);
  });

  it("tags urgent and key-account orders and stays quiet otherwise", () => {
    expect(priorityTagged("URGENT")).toBe(true);
    expect(priorityTagged("KEY_ACCOUNT")).toBe(true);
    expect(priorityTagged("NORMAL")).toBe(false);
    expect(priorityTagged(undefined)).toBe(false);
    expect(priorityLabel("URGENT")).toBe("فوری");
    expect(priorityLabel("nonsense")).toBe("عادی");
  });

  it("refuses finished orders", () => {
    expect(canSetPriority("CONFIRMED")).toBe(true);
    expect(canSetPriority("DELIVERED")).toBe(false);
    expect(canSetPriority("CANCELLED")).toBe(false);
  });
});

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-priority-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";

describe("setOrderPriority", async () => {
  const { getDb } = await import("@/lib/db");
  const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
  const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
  const { createOrder, readOrder } = await import("@/lib/orders");
  const { setOrderPriority } = await import("@/lib/repo/orderPriority");

  afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

  it("sets an open order urgent, and not another company's order", async () => {
    const db = getDb();
    await ensureWarehouse(db);
    const now = new Date().toISOString();
    const owner = Number(
      (await db
        .prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('p1','x','م','owner',1,?,1)")
        .run(now)).lastInsertRowid
    );
    const cust = Number(
      (await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('P1','x','active',?,1)").run(now))
        .lastInsertRowid
    );
    const product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
    const packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
    await setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
    const o = await createOrder(db, {
      customer_id: cust,
      order_date: "2026-01-01",
      created_by: owner,
      organization_id: 1,
      salesperson_user_id: owner,
      lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
    });

    expect(await setOrderPriority(2, o.id, "URGENT")).toBe(false);
    expect(await setOrderPriority(1, o.id, "URGENT")).toBe(true);
    expect((await readOrder(db, o.id))?.priority).toBe("URGENT");
  });
});
