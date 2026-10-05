import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-orders-lib-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, readOrder, readOrders, confirmOrder, addLine, productMixFor, OrderError } =
  await import("@/lib/orders");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = {
  customer: 0,
  customerNoGroup: 0,
  group: 0,
  owner: 0,
  seller: 0,
  product: 0,
  packaging: 0,
  unpriced: 0,
  unpricedPack: 0,
};

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();

  ctx.group = Number(
    db
      .prepare(
        "INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)"
      )
      .run("گروه شرق", "east", "#0ff", now).lastInsertRowid
  );
  ctx.owner = Number(
    db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'owner', ?)"
      )
      .run("owner", "مالک", now).lastInsertRowid
  );
  ctx.seller = Number(
    db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, group_id, created_at) VALUES (?, 'x', ?, 'phone_sales', ?, ?)"
      )
      .run("nazanin", "نازنین", ctx.group, now).lastInsertRowid
  );
  ctx.customer = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)"
      )
      .run("C1", "رستوران نمونه", ctx.group, now).lastInsertRowid
  );
  ctx.customerNoGroup = Number(
    db
      .prepare("INSERT INTO customers (customer_code, business_name, synced_at) VALUES (?, ?, ?)")
      .run("C2", "کافه بی‌منطقه", now).lastInsertRowid
  );

  ctx.product = createProduct(db, { name: "کره گیاهی مرحبا", kg_per_base_unit: 0.25, organization_id: 1 });
  ctx.packaging = createPackaging(db, {
    product_id: ctx.product,
    name: "جعبه بچه",
    qty_per_pack: 100,
  });
  setPrice(db, { product_id: ctx.product, price_toman: 440000, valid_from: "2026-01-01" });
  db.prepare("UPDATE products SET avg_cost_toman = 300000 WHERE id = ?").run(ctx.product);

  ctx.unpriced = createProduct(db, { name: "بدون قیمت", kg_per_base_unit: 1, organization_id: 1 });
  ctx.unpricedPack = createPackaging(db, {
    product_id: ctx.unpriced,
    name: "کارتن",
    qty_per_pack: 1,
  });
});

const draftInput = (over: Record<string, unknown> = {}) => ({
  customer_id: ctx.customer,
  order_date: "2026-08-26",
  created_by: ctx.owner,
  organization_id: 1,
  salesperson_user_id: ctx.seller,
  lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 2 }],
  ...over,
});

describe("createOrder", () => {
  it("allocates a sequential number within the Jalali year", () => {
    const a = createOrder(getDb(), draftInput());
    const b = createOrder(getDb(), draftInput());
    expect(a.order_no).toBe("1405-00001");
    expect(b.order_no).toBe("1405-00002");
  });

  it("stamps the group from the customer", () => {
    const order = createOrder(getDb(), draftInput());
    const row = getDb().prepare("SELECT group_id FROM orders WHERE id = ?").get(order.id) as {
      group_id: number;
    };
    expect(row.group_id).toBe(ctx.group);
  });

  it("leaves the group null for a customer not yet in a territory", () => {
    const order = createOrder(getDb(), draftInput({ customer_id: ctx.customerNoGroup }));
    const row = getDb().prepare("SELECT group_id FROM orders WHERE id = ?").get(order.id) as {
      group_id: number | null;
    };
    expect(row.group_id).toBeNull();
  });

  it("snapshots the price, cost and both conversion factors onto the line", () => {
    const order = createOrder(getDb(), draftInput());
    const line = getDb()
      .prepare("SELECT * FROM order_lines WHERE order_id = ?")
      .get(order.id) as Record<string, number>;

    expect(line.unit_price_toman).toBe(440000);
    expect(line.unit_cost_toman).toBe(300000);
    expect(line.qty_per_pack).toBe(100);
    expect(line.kg_per_base_unit).toBe(0.25);
    expect(line.price_id).toBeGreaterThan(0);
  });

  it("keeps the snapshot when the catalogue changes afterwards", () => {
    const db = getDb();
    const order = createOrder(db, draftInput());
    setPrice(db, { product_id: ctx.product, price_toman: 999999, valid_from: "2026-08-01" });
    db.prepare("UPDATE packagings SET qty_per_pack = 120 WHERE id = ?").run(ctx.packaging);

    const line = db
      .prepare("SELECT unit_price_toman, qty_per_pack FROM order_lines WHERE order_id = ?")
      .get(order.id) as { unit_price_toman: number; qty_per_pack: number };
    expect(line.unit_price_toman).toBe(440000);
    expect(line.qty_per_pack).toBe(100);

    // Put it back so later tests price at the original figure.
    db.prepare("UPDATE packagings SET qty_per_pack = 100 WHERE id = ?").run(ctx.packaging);
    db.prepare("DELETE FROM product_prices WHERE price_toman = 999999").run();
  });

  it("prices against the order's date, not today", () => {
    // Its own product on purpose. Adding a second price to the shared one would leak
    // into every later test in this file, and the first version of this test did.
    const db = getDb();
    const product = createProduct(db, { name: "کالای تاریخ‌دار", kg_per_base_unit: 1, organization_id: 1 });
    const packaging = createPackaging(db, {
      product_id: product,
      name: "کارتن",
      qty_per_pack: 1,
    });
    setPrice(db, { product_id: product, price_toman: 100000, valid_from: "2026-01-01" });
    setPrice(db, { product_id: product, price_toman: 500000, valid_from: "2026-06-01" });

    const order = createOrder(
      db,
      draftInput({
        order_date: "2026-02-01",
        lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
      })
    );
    const line = db
      .prepare("SELECT unit_price_toman FROM order_lines WHERE order_id = ?")
      .get(order.id) as { unit_price_toman: number };
    expect(line.unit_price_toman).toBe(100000);
  });

  it("refuses a product with no price rather than recording it as free", () => {
    expect(() =>
      createOrder(
        getDb(),
        draftInput({
          lines: [{ product_id: ctx.unpriced, packaging_id: ctx.unpricedPack, packs: 1 }],
        })
      )
    ).toThrow(OrderError);
  });

  it("leaves no order behind when a line fails", () => {
    const db = getDb();
    const before = (db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n;
    expect(() =>
      createOrder(
        db,
        draftInput({
          lines: [
            { product_id: ctx.product, packaging_id: ctx.packaging, packs: 1 },
            { product_id: ctx.unpriced, packaging_id: ctx.unpricedPack, packs: 1 },
          ],
        })
      )
    ).toThrow();
    const after = (db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it("refuses an order with no lines", () => {
    expect(() => createOrder(getDb(), draftInput({ lines: [] }))).toThrow(OrderError);
  });

  it("refuses a customer that does not exist", () => {
    expect(() => createOrder(getDb(), draftInput({ customer_id: 999999 }))).toThrow(OrderError);
  });

  it("records who overrode a credit limit", () => {
    const db = getDb();
    const order = createOrder(db, draftInput({ credit_override_by: ctx.owner }));
    const row = db.prepare("SELECT credit_override_by FROM orders WHERE id = ?").get(order.id) as {
      credit_override_by: number;
    };
    expect(row.credit_override_by).toBe(ctx.owner);
  });

  it("never issues the same number twice", () => {
    const db = getDb();
    for (let i = 0; i < 5; i++) createOrder(db, draftInput());
    const dupes = db
      .prepare("SELECT order_no, COUNT(*) AS n FROM orders GROUP BY order_no HAVING n > 1")
      .all();
    expect(dupes).toEqual([]);
  });
});

describe("readOrder", () => {
  it("returns the order with its lines and computed totals", () => {
    const order = createOrder(getDb(), draftInput());
    const read = readOrder(getDb(), order.id)!;
    expect(read.lines).toHaveLength(1);
    expect(read.total_toman).toBe(880000); // 2 packs x 440000
    expect(read.kg).toBe(50); // 2 x 100 x 0.25
    expect(read.customer_name).toBe("رستوران نمونه");
  });

  it("returns null for an order that is not there", () => {
    expect(readOrder(getDb(), 999999)).toBeNull();
  });
});

describe("confirmOrder", () => {
  it("moves a draft to confirmed", () => {
    const order = createOrder(getDb(), draftInput());
    confirmOrder(getDb(), order.id);
    const row = getDb().prepare("SELECT status FROM orders WHERE id = ?").get(order.id) as {
      status: string;
    };
    expect(row.status).toBe("CONFIRMED");
  });

  /** A customer nobody else in this file has ordered for. The first version of these
   *  two tests shared ctx.customer and read a date stamped by an earlier test. */
  function freshCustomer(code: string): number {
    return Number(
      getDb()
        .prepare("INSERT INTO customers (customer_code, business_name, synced_at) VALUES (?, ?, ?)")
        .run(code, `مشتری ${code}`, new Date().toISOString()).lastInsertRowid
    );
  }

  it("stamps the customer's last purchase date, which is what the map reads", () => {
    // daysSinceLastPurchase drives inactivityColor on the map and the dormant-customer
    // count on analytics. Nothing has written this column since the workbook import, so
    // every one of those features currently renders nothing.
    const db = getDb();
    const customer = freshCustomer("LP1");
    const order = createOrder(db, draftInput({ customer_id: customer, order_date: "2026-08-20" }));
    confirmOrder(db, order.id);
    const row = db
      .prepare("SELECT last_purchase_date FROM customers WHERE id = ?")
      .get(customer) as { last_purchase_date: string };
    expect(row.last_purchase_date).toBe("2026-08-20");
  });

  it("does not move the last purchase date backwards", () => {
    // Recording an older order after a newer one is normal when someone is catching up
    // on a week of paper slips. It must not make an active customer look dormant.
    const db = getDb();
    const customer = freshCustomer("LP2");
    const recent = createOrder(db, draftInput({ customer_id: customer, order_date: "2026-08-25" }));
    confirmOrder(db, recent.id);
    const older = createOrder(db, draftInput({ customer_id: customer, order_date: "2026-07-01" }));
    confirmOrder(db, older.id);

    const row = db
      .prepare("SELECT last_purchase_date FROM customers WHERE id = ?")
      .get(customer) as { last_purchase_date: string };
    expect(row.last_purchase_date).toBe("2026-08-25");
  });

  it("stamps a customer who has never bought before", () => {
    const db = getDb();
    const customer = freshCustomer("LP3");
    const order = createOrder(db, draftInput({ customer_id: customer, order_date: "2026-03-15" }));
    confirmOrder(db, order.id);
    const row = db
      .prepare("SELECT last_purchase_date FROM customers WHERE id = ?")
      .get(customer) as { last_purchase_date: string };
    expect(row.last_purchase_date).toBe("2026-03-15");
  });

  it("refuses to confirm an order twice", () => {
    const order = createOrder(getDb(), draftInput());
    confirmOrder(getDb(), order.id);
    expect(() => confirmOrder(getDb(), order.id)).toThrow(OrderError);
  });
});

describe("addLine", () => {
  it("adds a line to a draft", () => {
    const order = createOrder(getDb(), draftInput());
    addLine(getDb(), order.id, { product_id: ctx.product, packaging_id: ctx.packaging, packs: 1 });
    expect(readOrder(getDb(), order.id)!.lines).toHaveLength(2);
  });

  it("refuses to add a line to a confirmed order", () => {
    // Confirmed is append-only through reversal lines, not through editing. Commission
    // is paid off these numbers and a total that can move afterwards costs real money.
    const order = createOrder(getDb(), draftInput());
    confirmOrder(getDb(), order.id);
    expect(() =>
      addLine(getDb(), order.id, { product_id: ctx.product, packaging_id: ctx.packaging, packs: 1 })
    ).toThrow(OrderError);
  });
});

describe("readOrders", () => {
  it("applies the scope fragment it is given", () => {
    const all = readOrders(getDb(), { sql: "", params: [] });
    const none = readOrders(getDb(), { sql: " AND 1 = 0", params: [] });
    expect(all.length).toBeGreaterThan(0);
    expect(none).toHaveLength(0);
  });

  it("returns the newest order first", () => {
    const rows = readOrders(getDb(), { sql: "", params: [] });
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].id).toBeGreaterThan(rows[i].id);
    }
  });
});

describe("productMixFor", () => {
  it("sums what one customer has bought, by product", () => {
    const db = getDb();
    const customer = Number(
      db
        .prepare("INSERT INTO customers (customer_code, business_name, synced_at) VALUES (?, ?, ?)")
        .run("MIX1", "مشتری ترکیب", new Date().toISOString()).lastInsertRowid
    );
    const a = createOrder(db, draftInput({ customer_id: customer }));
    confirmOrder(db, a.id);
    const b = createOrder(db, draftInput({ customer_id: customer }));
    confirmOrder(db, b.id);

    const mix = productMixFor(db, { sql: "", params: [] }, customer);
    expect(mix).toHaveLength(1);
    expect(mix[0].product_name).toBe("کره گیاهی مرحبا");
    // Two orders of 2 packs each.
    expect(mix[0].packs).toBe(4);
  });

  it("counts only the customer asked for", () => {
    const db = getDb();
    const other = Number(
      db
        .prepare("INSERT INTO customers (customer_code, business_name, synced_at) VALUES (?, ?, ?)")
        .run("MIX2", "مشتری دیگر", new Date().toISOString()).lastInsertRowid
    );
    expect(productMixFor(db, { sql: "", params: [] }, other)).toEqual([]);
  });

  it("honours the scope fragment, so it cannot leak across groups", () => {
    const db = getDb();
    expect(productMixFor(db, { sql: " AND 1 = 0", params: [] }, ctx.customer)).toEqual([]);
  });

  it("ignores a draft, which nobody has agreed to yet", () => {
    const db = getDb();
    const customer = Number(
      db
        .prepare("INSERT INTO customers (customer_code, business_name, synced_at) VALUES (?, ?, ?)")
        .run("MIX3", "فقط پیش‌نویس", new Date().toISOString()).lastInsertRowid
    );
    createOrder(db, draftInput({ customer_id: customer }));
    expect(productMixFor(db, { sql: "", params: [] }, customer)).toEqual([]);
  });

  it("puts the biggest spend first", () => {
    const mix = productMixFor(getDb(), { sql: "", params: [] }, ctx.customer);
    for (let i = 1; i < mix.length; i++) {
      expect(mix[i - 1].total_toman).toBeGreaterThanOrEqual(mix[i].total_toman);
    }
  });
});
