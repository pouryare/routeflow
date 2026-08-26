import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-purchases-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery } = await import("@/lib/delivery");
const { recordPurchase, readPurchases, stockPosition, PurchaseError } = await import(
  "@/lib/purchases"
);

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
  ctx.driver = Number(user.run("d", "راننده", "driver", ctx.group, now).lastInsertRowid);
  ctx.customer = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)"
      )
      .run("C1", "رستوران نمونه", ctx.group, now).lastInsertRowid
  );

  ctx.product = createProduct(db, { name: "کره گیاهی", kg_per_base_unit: 0.25 });
  ctx.packaging = createPackaging(db, { product_id: ctx.product, name: "جعبه", qty_per_pack: 100 });
  setPrice(db, { product_id: ctx.product, price_toman: 440000, valid_from: "2026-01-01" });

  ctx.other = createProduct(db, { name: "دوغ لیوانی", kg_per_base_unit: 0.3 });
});

describe("recordPurchase", () => {
  it("stores the receipt and its lines", () => {
    const id = recordPurchase(getDb(), {
      supplier: "کارخانه مرحبا",
      purchase_date: "2026-05-01",
      created_by: ctx.owner,
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
    const rows = stockPosition(getDb());
    const butter = rows.find((r) => r.product_id === ctx.product)!;
    expect(butter.purchased_qty).toBe(2000);
  });

  it("removes what was actually delivered, not what was ordered", () => {
    const db = getDb();
    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-06-01",
      created_by: ctx.owner,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 5 }],
    });
    confirmOrder(db, order.id);
    const run = createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-06-01",
      created_by: ctx.owner,
    });
    const stopId = addStop(db, run, order.id);
    const stop = readRun(db, run)!.stops.find((s) => s.id === stopId)!;
    // Ordered 5 packs, the customer took 3.
    recordDelivery(db, stopId, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 3 }],
      collected_toman: 0,
      by: ctx.driver,
    });

    const butter = stockPosition(db).find((r) => r.product_id === ctx.product)!;
    expect(butter.delivered_qty).toBe(300); // 3 packs x 100 عدد
    expect(butter.on_hand).toBe(1700);
  });

  it("ignores an order that has not been delivered", () => {
    const db = getDb();
    const before = stockPosition(db).find((r) => r.product_id === ctx.product)!.on_hand;
    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-06-05",
      created_by: ctx.owner,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 4 }],
    });
    confirmOrder(db, order.id);
    expect(stockPosition(db).find((r) => r.product_id === ctx.product)!.on_hand).toBe(before);
  });

  it("shows a product that has never been bought as zero, not missing", () => {
    const dough = stockPosition(getDb()).find((r) => r.product_id === ctx.other)!;
    expect(dough.purchased_qty).toBe(0);
    expect(dough.on_hand).toBe(0);
  });

  it("reports stock value at the current average cost", () => {
    const butter = stockPosition(getDb()).find((r) => r.product_id === ctx.product)!;
    expect(butter.value_toman).toBe(butter.on_hand * butter.avg_cost_toman);
  });

  it("flags a negative position rather than hiding it", () => {
    const db = getDb();
    const bare = createProduct(db, { name: "کالای منفی", kg_per_base_unit: 1 });
    const barePack = createPackaging(db, { product_id: bare, name: "ک", qty_per_pack: 10 });
    setPrice(db, { product_id: bare, price_toman: 1000, valid_from: "2026-01-01" });

    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-07-01",
      created_by: ctx.owner,
      lines: [{ product_id: bare, packaging_id: barePack, packs: 2 }],
    });
    confirmOrder(db, order.id);
    const run = createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-07-01",
      created_by: ctx.owner,
    });
    const stopId = addStop(db, run, order.id);
    const stop = readRun(db, run)!.stops.find((s) => s.id === stopId)!;
    recordDelivery(db, stopId, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 2 }],
      collected_toman: 0,
      by: ctx.driver,
    });

    const row = stockPosition(db).find((r) => r.product_id === bare)!;
    expect(row.on_hand).toBe(-20);
    expect(row.negative).toBe(true);
  });
});

describe("readPurchases", () => {
  it("returns the newest receipt first", () => {
    const rows = readPurchases(getDb());
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].purchase_date >= rows[i].purchase_date).toBe(true);
    }
  });

  it("carries the line count and total", () => {
    const rows = readPurchases(getDb());
    const first = rows.find((r) => r.total_toman > 0)!;
    expect(first.line_count).toBeGreaterThan(0);
  });
});
