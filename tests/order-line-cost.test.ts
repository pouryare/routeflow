import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-order-line-cost-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice, setCost } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const ctx = { group: 0, owner: 0, customer: 0, product: 0, packaging: 0 };

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  ctx.group = Number(
    (await db
      .prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run("گروه شرق", "east", "#0ff", now)).lastInsertRowid
  );
  ctx.owner = Number(
    (await db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'owner', ?)"
      )
      .run("owner", "مالک", now)).lastInsertRowid
  );
  ctx.customer = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)"
      )
      .run("C1", "رستوران نمونه", ctx.group, now)).lastInsertRowid
  );
  ctx.product = await createProduct(db, {
    name: "کره گیاهی مرحبا",
    kg_per_base_unit: 0.25,
    organization_id: 1,
  });
  ctx.packaging = await createPackaging(db, {
    product_id: ctx.product,
    name: "جعبه بچه",
    qty_per_pack: 100,
  });
  await setPrice(db, { product_id: ctx.product, price_toman: 440_000, valid_from: "2026-01-01" });
  // The moving average purchases maintain. Deliberately DIFFERENT from the landed cost
  // below, because a test where the two agree proves nothing.
  await db.prepare("UPDATE products SET avg_cost_toman = 300000 WHERE id = ?").run(ctx.product);
});

const input = (order_date = "2026-08-26") => ({
  customer_id: ctx.customer,
  order_date,
  created_by: ctx.owner,
  organization_id: 1,
  lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 2 }],
});

const lineCost = async (orderId: number): Promise<number> =>
  (
    await getDb().prepare("SELECT unit_cost_toman FROM order_lines WHERE order_id = ?").get(orderId) as {
      unit_cost_toman: number;
    }
  ).unit_cost_toman;

describe("an order line freezes the cost the calculator advised on", () => {
  it("snapshots the moving average when no cost override is in force", async () => {
    const order = await createOrder(getDb(), input());
    expect(await lineCost(order.id)).toBe(300_000);
  });

  it("snapshots the LANDED cost once one is in force, not the moving average", async () => {
    // This is the whole point of the feature. The drawer reads product_costs and tells
    // the owner their margin at 400,000; if the order then books at 300,000 the
    // dashboard reports a BETTER margin than the tool that advised the price, and the
    // two numbers disagree about the same product on the same day.
    await setCost(getDb(), {
      product_id: ctx.product,
      packaging_id: null,
      method: "landed",
      cost_toman: 400_000,
      valid_from: "2026-01-01",
    });
    const order = await createOrder(getDb(), input());
    expect(await lineCost(order.id)).toBe(400_000);
  });

  it("does NOT restate an order line already created before the override", async () => {
    // The backdated-override asymmetry, same as a backdated price. Every reporter reads
    // ol.unit_cost_toman off the line, so history is frozen by the snapshot.
    //
    // On a FRESH cost series, so the only thing that can account for the "before" line
    // is the snapshot itself -- these tests share one database, and an override inserted
    // by an earlier test would otherwise be in force here and quietly prove nothing.
    const other = await createProduct(getDb(), {
      name: "محصول تازه",
      kg_per_base_unit: 1,
      organization_id: 1,
    });
    const otherPack = await createPackaging(getDb(), {
      product_id: other,
      name: "کارتن",
      qty_per_pack: 1,
    });
    await setPrice(getDb(), { product_id: other, price_toman: 100_000, valid_from: "2026-01-01" });
    await getDb()
      .prepare("UPDATE products SET avg_cost_toman = 300000 WHERE id = ?")
      .run(other);

    const before = await createOrder(getDb(), {
      customer_id: ctx.customer,
      order_date: "2026-03-01",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: other, packaging_id: otherPack, packs: 1 }],
    });
    await setCost(getDb(), {
      product_id: other,
      packaging_id: null,
      method: "landed",
      cost_toman: 999_000,
      valid_from: "2026-01-01",
    });
    const after = await createOrder(getDb(), {
      customer_id: ctx.customer,
      order_date: "2026-03-02",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: other, packaging_id: otherPack, packs: 1 }],
    });

    expect(await lineCost(before.id)).toBe(300_000);
    expect(await lineCost(after.id)).toBe(999_000);
  });

  it("takes a packaging-specific cost over the product-wide one", async () => {
    await setCost(getDb(), {
      product_id: ctx.product,
      packaging_id: ctx.packaging,
      method: "landed",
      cost_toman: 4_400_000,
      valid_from: "2026-01-01",
    });
    const order = await createOrder(getDb(), input());
    expect(await lineCost(order.id)).toBe(4_400_000);
  });
});
