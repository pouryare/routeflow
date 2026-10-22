import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-purchases-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery } = await import("@/lib/delivery");
const { recordPurchase, readPurchases, stockPosition, advancedStockPosition, stockStatus, PurchaseError } =
  await import("@/lib/purchases");
const { setStockThresholds } = await import("@/lib/catalogue");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = { owner: 0, driver: 0, group: 0, customer: 0, product: 0, packaging: 0, other: 0 };

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  ctx.group = Number(
    db
      .prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run("شرق", "east", "#0ff", now).lastInsertRowid
  );
  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, 'x', ?, ?, ?, 1, ?)"
  );
  ctx.owner = Number(user.run("o", "مالک", "owner", null, now).lastInsertRowid);
  ctx.driver = Number(user.run("d", "راننده", "delivery_driver", ctx.group, now).lastInsertRowid);
  ctx.customer = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)"
      )
      .run("C1", "رستوران نمونه", ctx.group, now).lastInsertRowid
  );

  ctx.product = createProduct(db, { name: "کره گیاهی", kg_per_base_unit: 0.25, organization_id: 1 });
  ctx.packaging = createPackaging(db, { product_id: ctx.product, name: "جعبه", qty_per_pack: 100 });
  setPrice(db, { product_id: ctx.product, price_toman: 440000, valid_from: "2026-01-01" });

  ctx.other = createProduct(db, { name: "دوغ لیوانی", kg_per_base_unit: 0.3, organization_id: 1 });
});

describe("recordPurchase", () => {
  it("stores the receipt and its lines", () => {
    const id = recordPurchase(getDb(), {
      supplier: "کارخانه مرحبا",
      purchase_date: "2026-05-01",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, base_qty: 1000, unit_cost_toman: 3000 }],
    });
    const lines = getDb()
      .prepare("SELECT * FROM purchase_lines WHERE purchase_id = ?")
      .all(id) as unknown as { base_qty: number; unit_cost_toman: number }[];
    expect(lines).toHaveLength(1);
    expect(lines[0].base_qty).toBe(1000);
  });

  it("sets the product's average cost from the first receipt", () => {
    const row = getDb()
      .prepare("SELECT avg_cost_toman FROM products WHERE id = ?")
      .get(ctx.product) as { avg_cost_toman: number };
    expect(row.avg_cost_toman).toBe(3000);
  });

  it("blends the average on the next receipt", () => {
    // 1000 at 3000 plus 1000 at 5000 averages to 4000.
    recordPurchase(getDb(), {
      supplier: "کارخانه مرحبا",
      purchase_date: "2026-05-10",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, base_qty: 1000, unit_cost_toman: 5000 }],
    });
    const row = getDb()
      .prepare("SELECT avg_cost_toman FROM products WHERE id = ?")
      .get(ctx.product) as { avg_cost_toman: number };
    expect(row.avg_cost_toman).toBe(4000);
  });

  it("refuses a receipt with no lines", () => {
    expect(() =>
      recordPurchase(getDb(), {
        supplier: "x",
        purchase_date: "2026-05-01",
        created_by: ctx.owner,
        organization_id: 1,
        lines: [],
      })
    ).toThrow(PurchaseError);
  });

  it("refuses a product that does not exist", () => {
    expect(() =>
      recordPurchase(getDb(), {
        supplier: "x",
        purchase_date: "2026-05-01",
        created_by: ctx.owner,
        organization_id: 1,
        lines: [{ product_id: 999999, base_qty: 1, unit_cost_toman: 1 }],
      })
    ).toThrow(PurchaseError);
  });

  it("refuses a fractional cost rather than rounding it away", () => {
    expect(() =>
      recordPurchase(getDb(), {
        supplier: "x",
        purchase_date: "2026-05-01",
        created_by: ctx.owner,
        organization_id: 1,
        lines: [{ product_id: ctx.product, base_qty: 1, unit_cost_toman: 1.5 }],
      })
    ).toThrow();
  });

  it("leaves nothing behind when a line fails", () => {
    const db = getDb();
    const before = (db.prepare("SELECT COUNT(*) AS n FROM purchases").get() as { n: number }).n;
    expect(() =>
      recordPurchase(db, {
        supplier: "x",
        purchase_date: "2026-05-01",
        created_by: ctx.owner,
        organization_id: 1,
        lines: [
          { product_id: ctx.product, base_qty: 1, unit_cost_toman: 1000 },
          { product_id: 999999, base_qty: 1, unit_cost_toman: 1000 },
        ],
      })
    ).toThrow();
    const after = (db.prepare("SELECT COUNT(*) AS n FROM purchases").get() as { n: number }).n;
    expect(after).toBe(before);
  });
});

describe("stockPosition", () => {
  it("counts everything received", () => {
    const rows = stockPosition(getDb(), 1);
    const butter = rows.find((r) => r.product_id === ctx.product)!;
    expect(butter.purchased_qty).toBe(2000);
  });

  it("removes what was actually delivered, not what was ordered", () => {
    const db = getDb();
    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-06-01",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 5 }],
    });
    confirmOrder(db, order.id);
    const run = createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-06-01",
      created_by: ctx.owner,
      organization_id: 1,
    });
    const stopId = addStop(db, run, order.id);
    const stop = readRun(db, run)!.stops.find((s) => s.id === stopId)!;
    // Ordered 5 packs, the customer took 3.
    recordDelivery(db, stopId, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 3 }],
      collected_toman: 0,
      by: ctx.driver,
    });

    const butter = stockPosition(db, 1).find((r) => r.product_id === ctx.product)!;
    expect(butter.delivered_qty).toBe(300); // 3 packs x 100 عدد
    expect(butter.on_hand).toBe(1700);
  });

  it("ignores an order that has not been delivered", () => {
    const db = getDb();
    const before = stockPosition(db, 1).find((r) => r.product_id === ctx.product)!.on_hand;
    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-06-05",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 4 }],
    });
    confirmOrder(db, order.id);
    expect(stockPosition(db, 1).find((r) => r.product_id === ctx.product)!.on_hand).toBe(before);
  });

  it("shows a product that has never been bought as zero, not missing", () => {
    const dough = stockPosition(getDb(), 1).find((r) => r.product_id === ctx.other)!;
    expect(dough.purchased_qty).toBe(0);
    expect(dough.on_hand).toBe(0);
  });

  it("reports stock value at the current average cost", () => {
    const butter = stockPosition(getDb(), 1).find((r) => r.product_id === ctx.product)!;
    expect(butter.value_toman).toBe(butter.on_hand * butter.avg_cost_toman);
  });

  it("flags a negative position rather than hiding it", () => {
    const db = getDb();
    const bare = createProduct(db, { name: "کالای منفی", kg_per_base_unit: 1, organization_id: 1 });
    const barePack = createPackaging(db, { product_id: bare, name: "ک", qty_per_pack: 10 });
    setPrice(db, { product_id: bare, price_toman: 1000, valid_from: "2026-01-01" });

    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-07-01",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: bare, packaging_id: barePack, packs: 2 }],
    });
    confirmOrder(db, order.id);
    const run = createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-07-01",
      created_by: ctx.owner,
      organization_id: 1,
    });
    const stopId = addStop(db, run, order.id);
    const stop = readRun(db, run)!.stops.find((s) => s.id === stopId)!;
    recordDelivery(db, stopId, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 2 }],
      collected_toman: 0,
      by: ctx.driver,
    });

    const row = stockPosition(db, 1).find((r) => r.product_id === bare)!;
    expect(row.on_hand).toBe(-20);
    expect(row.negative).toBe(true);
  });
});

describe("readPurchases", () => {
  it("returns the newest receipt first", () => {
    const rows = readPurchases(getDb(), 1);
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].purchase_date >= rows[i].purchase_date).toBe(true);
    }
  });

  it("carries the line count and total", () => {
    const rows = readPurchases(getDb(), 1);
    const first = rows.find((r) => r.total_toman > 0)!;
    expect(first.line_count).toBeGreaterThan(0);
  });
});

describe("stockStatus", () => {
  it("is سالم for a product with no policy set at all", () => {
    expect(stockStatus(0, null, null)).toBe("ok");
    expect(stockStatus(-40, null, null)).toBe("ok"); // even negative -- see the note above
  });

  it("is بحرانی below the reorder point", () => {
    expect(stockStatus(40, 50, 200)).toBe("crit");
  });

  it("is کم‌موجود within 35% above the reorder point", () => {
    expect(stockStatus(60, 50, 200)).toBe("low"); // 50 x 1.35 = 67.5
    expect(stockStatus(70, 50, 200)).toBe("ok");
  });

  it("is مازاد above the target with no reorder point at all", () => {
    expect(stockStatus(500, null, 200)).toBe("over");
  });

  it("is سالم strictly between the two", () => {
    expect(stockStatus(100, 50, 200)).toBe("ok");
  });
});

describe("advancedStockPosition", () => {
  it("carries stockPosition's own figures untouched", () => {
    const advanced = advancedStockPosition(getDb(), 1).find((r) => r.product_id === ctx.product)!;
    const plain = stockPosition(getDb(), 1).find((r) => r.product_id === ctx.product)!;
    expect(advanced.on_hand).toBe(plain.on_hand);
    expect(advanced.value_toman).toBe(plain.value_toman);
  });

  it("reflects the reorder policy an owner has set, and reacts to on-hand changes", () => {
    const db = getDb();
    const p = createProduct(db, { name: "کالای آستانه‌دار", kg_per_base_unit: 1, organization_id: 1 });
    setStockThresholds(db, p, { reorder_point: 100, target_stock: 500 });
    // Never purchased, so on_hand is 0 -- below its own reorder point.
    expect(advancedStockPosition(db, 1).find((r) => r.product_id === p)!.status).toBe("crit");

    recordPurchase(db, {
      purchase_date: "2026-08-01",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: p, base_qty: 300, unit_cost_toman: 1000 }],
    });
    expect(advancedStockPosition(db, 1).find((r) => r.product_id === p)!.status).toBe("ok");
  });

  it("is null-thresholded and سالم for a product nobody has configured", () => {
    const row = advancedStockPosition(getDb(), 1).find((r) => r.product_id === ctx.other)!;
    expect(row.reorder_point).toBeNull();
    expect(row.target_stock).toBeNull();
    expect(row.status).toBe("ok");
  });

  it("counts today's delivery into the velocity window and gives a finite days_left", () => {
    const db = getDb();
    const p = createProduct(db, { name: "کالای سرعت‌دار", kg_per_base_unit: 1, organization_id: 1 });
    const pack = createPackaging(db, { product_id: p, name: "ک", qty_per_pack: 50 });
    setPrice(db, { product_id: p, price_toman: 1000, valid_from: "2026-01-01" });
    recordPurchase(db, {
      purchase_date: "2026-08-01",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: p, base_qty: 1000, unit_cost_toman: 500 }],
    });

    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-08-01",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: p, packaging_id: pack, packs: 2 }],
    });
    confirmOrder(db, order.id);
    const run = createRun(db, { driver_user_id: ctx.driver, run_date: "2026-08-01", created_by: ctx.owner, organization_id: 1 });
    const stopId = addStop(db, run, order.id);
    const stop = readRun(db, run)!.stops.find((s) => s.id === stopId)!;
    // recordDelivery stamps delivered_at with the real current instant, which always
    // falls inside advancedStockPosition's own trailing window -- no need to control it.
    recordDelivery(db, stopId, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 2 }],
      collected_toman: 0,
      by: ctx.driver,
    });

    const row = advancedStockPosition(db, 1).find((r) => r.product_id === p)!;
    expect(row.spark).toHaveLength(14);
    expect(row.spark[13]).toBe(100); // today, the last entry -- 2 packs x 50
    expect(row.daily_rate).toBeCloseTo(100 / 14, 5);
    expect(row.days_left).not.toBeNull();
    expect(row.days_left!).toBeCloseTo(900 / (100 / 14), 5); // on_hand 900 / daily_rate
  });

  it("is null, not Infinity, when nothing has moved recently", () => {
    const row = advancedStockPosition(getDb(), 1).find((r) => r.product_id === ctx.other)!;
    expect(row.daily_rate).toBe(0);
    expect(row.days_left).toBeNull();
  });

  it("carries the date of the most recent purchase", () => {
    const db = getDb();
    const p = createProduct(db, { name: "کالای خرید اخیر", kg_per_base_unit: 1, organization_id: 1 });
    recordPurchase(db, {
      purchase_date: "2026-06-01",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: p, base_qty: 10, unit_cost_toman: 1000 }],
    });
    recordPurchase(db, {
      purchase_date: "2026-07-15",
      created_by: ctx.owner,
      organization_id: 1,
      lines: [{ product_id: p, base_qty: 10, unit_cost_toman: 1200 }],
    });
    const row = advancedStockPosition(db, 1).find((r) => r.product_id === p)!;
    expect(row.last_purchase_date).toBe("2026-07-15");
  });

  it("is null for a product that has never been bought", () => {
    const row = advancedStockPosition(getDb(), 1).find((r) => r.product_id === ctx.other)!;
    expect(row.last_purchase_date).toBeNull();
  });
});
