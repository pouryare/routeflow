import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-cat-lib-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { readCatalogue, resolvePrice, createProduct, createPackaging, setPrice, setStockThresholds } =
  await import("@/lib/catalogue");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

let marhaba = 0;
let boxOf100 = 0;
let boxOf12 = 0;

beforeAll(async () => {
  const db = getDb();
  marhaba = await createProduct(db, { name: "کره گیاهی مرحبا", kg_per_base_unit: 0.25, organization_id: 1 });
  boxOf100 = await createPackaging(db, { product_id: marhaba, name: "جعبه بچه", qty_per_pack: 100 });
  boxOf12 = await createPackaging(db, { product_id: marhaba, name: "کارتن کوچک", qty_per_pack: 12 });

  // A product-wide price, then a packaging-specific override for the small carton.
  await setPrice(db, { product_id: marhaba, price_toman: 400000, valid_from: "2026-01-01" });
  await setPrice(db, { product_id: marhaba, price_toman: 440000, valid_from: "2026-05-01" });
  await setPrice(db, {
    product_id: marhaba,
    packaging_id: boxOf12,
    price_toman: 60000,
    valid_from: "2026-05-01",
  });
});

describe("readCatalogue", () => {
  it("returns each product with its packagings nested", async () => {
    const rows = await readCatalogue(getDb(), 1, { onDate: "2026-08-26" });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("کره گیاهی مرحبا");
    expect(rows[0].packagings.map((p) => p.name).sort()).toEqual(["جعبه بچه", "کارتن کوچک"]);
  });

  it("attaches the price in force on the day asked for", async () => {
    const now = (await readCatalogue(getDb(), 1, { onDate: "2026-08-26" }))[0];
    const big = now.packagings.find((p) => p.id === boxOf100)!;
    expect(big.price_toman).toBe(440000);

    const earlier = (await readCatalogue(getDb(), 1, { onDate: "2026-02-01" }))[0];
    expect(earlier.packagings.find((p) => p.id === boxOf100)!.price_toman).toBe(400000);
  });

  it("lets a packaging-specific price beat the product-wide one", async () => {
    const rows = (await readCatalogue(getDb(), 1, { onDate: "2026-08-26" }))[0];
    expect(rows.packagings.find((p) => p.id === boxOf12)!.price_toman).toBe(60000);
  });

  it("reports no price rather than zero when nothing has been set", async () => {
    const db = getDb();
    const unpriced = await createProduct(db, { name: "دوغ لیوانی", kg_per_base_unit: 0.3, organization_id: 1 });
    await createPackaging(db, { product_id: unpriced, name: "شیرینک ۶ تایی", qty_per_pack: 6 });
    const row = (await readCatalogue(db, 1, { onDate: "2026-08-26" })).find((p) => p.id === unpriced)!;
    expect(row.packagings[0].price_toman).toBeNull();
  });

  it("hides an inactive product unless asked for it", async () => {
    const db = getDb();
    const gone = await createProduct(db, { name: "محصول بازنشسته", kg_per_base_unit: 1, organization_id: 1 });
    await db.prepare("UPDATE products SET active = 0 WHERE id = ?").run(gone);

    expect((await readCatalogue(db, 1)).some((p) => p.id === gone)).toBe(false);
    expect((await readCatalogue(db, 1, { includeInactive: true })).some((p) => p.id === gone)).toBe(true);
  });
});

describe("resolvePrice", () => {
  it("finds the product-wide price for a packaging with no override", async () => {
    expect((await resolvePrice(getDb(), marhaba, boxOf100, "2026-08-26"))?.price_toman).toBe(440000);
  });

  it("prefers the override where one exists", async () => {
    expect((await resolvePrice(getDb(), marhaba, boxOf12, "2026-08-26"))?.price_toman).toBe(60000);
  });

  it("falls back to the product-wide price before the override started", async () => {
    expect((await resolvePrice(getDb(), marhaba, boxOf12, "2026-02-01"))?.price_toman).toBe(400000);
  });

  it("returns the row id, so an order line can record which price it used", async () => {
    const hit = await resolvePrice(getDb(), marhaba, boxOf12, "2026-08-26");
    expect(typeof hit?.id).toBe("number");
  });

  it("returns null for a product with no price at all", async () => {
    const db = getDb();
    const p = await createProduct(db, { name: "بدون قیمت", kg_per_base_unit: 1, organization_id: 1 });
    expect(await resolvePrice(db, p, null, "2026-08-26")).toBeNull();
  });
});

describe("setPrice", () => {
  it("inserts rather than updating, so history survives", async () => {
    const db = getDb();
    const p = await createProduct(db, { name: "ماست موسیر زیتون", kg_per_base_unit: 0.5, organization_id: 1 });
    await setPrice(db, { product_id: p, price_toman: 100000, valid_from: "2026-01-01" });
    await setPrice(db, { product_id: p, price_toman: 120000, valid_from: "2026-06-01" });

    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM product_prices WHERE product_id = ?")
      .get(p) as { n: number };
    expect(n.n).toBe(2);

    // The old order's price is still there to be read.
    expect((await resolvePrice(db, p, null, "2026-03-01"))?.price_toman).toBe(100000);
    expect((await resolvePrice(db, p, null, "2026-08-01"))?.price_toman).toBe(120000);
  });

  it("refuses a fractional price rather than rounding it silently", async () => {
    const db = getDb();
    const p = await createProduct(db, { name: "قیمت اعشاری", kg_per_base_unit: 1, organization_id: 1 });
    await expect((async () =>
      await setPrice(db, { product_id: p, price_toman: 12500.5, valid_from: "2026-01-01" }))()).rejects.toThrow();
  });
});

describe("setStockThresholds", () => {
  it("is null on a freshly created product -- no policy set, not zero", async () => {
    const db = getDb();
    const p = await createProduct(db, { name: "کالای بدون آستانه", kg_per_base_unit: 1, organization_id: 1 });
    const row = await db.prepare("SELECT reorder_point, target_stock FROM products WHERE id = ?").get(p) as {
      reorder_point: number | null;
      target_stock: number | null;
    };
    expect(row.reorder_point).toBeNull();
    expect(row.target_stock).toBeNull();
  });

  it("sets one field without disturbing the other", async () => {
    const db = getDb();
    const p = await createProduct(db, { name: "آستانهٔ جزئی", kg_per_base_unit: 1, organization_id: 1 });
    await setStockThresholds(db, p, { reorder_point: 50 });
    await setStockThresholds(db, p, { target_stock: 200 });
    const row = await db.prepare("SELECT reorder_point, target_stock FROM products WHERE id = ?").get(p) as {
      reorder_point: number;
      target_stock: number;
    };
    expect(row.reorder_point).toBe(50);
    expect(row.target_stock).toBe(200);
  });

  it("clears a threshold when passed null explicitly", async () => {
    const db = getDb();
    const p = await createProduct(db, { name: "آستانهٔ پاک‌شدنی", kg_per_base_unit: 1, organization_id: 1 });
    await setStockThresholds(db, p, { reorder_point: 30, target_stock: 100 });
    await setStockThresholds(db, p, { reorder_point: null });
    const row = await db.prepare("SELECT reorder_point, target_stock FROM products WHERE id = ?").get(p) as {
      reorder_point: number | null;
      target_stock: number;
    };
    expect(row.reorder_point).toBeNull();
    expect(row.target_stock).toBe(100); // untouched -- reorder_point was the only key passed
  });

  it("rejects a negative threshold", async () => {
    const db = getDb();
    const p = await createProduct(db, { name: "آستانهٔ منفی", kg_per_base_unit: 1, organization_id: 1 });
    await expect((async () => await setStockThresholds(db, p, { reorder_point: -5 }))()).rejects.toThrow(TypeError);
  });
});
