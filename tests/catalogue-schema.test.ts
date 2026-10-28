import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { indexesOn, tableInfo } from "./helpers/schema";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-catalogue-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, dbReady } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(async () => {
  await dbReady();
});

async function cols(table: string): Promise<string[]> {
  return (await tableInfo(table) as unknown as { name: string }[]).map(
    (c) => c.name
  );
}

async function seedProduct(name = "کره گیاهی مرحبا"): Promise<number> {
  const now = new Date().toISOString();
  const r = await getDb()
    .prepare(
      "INSERT INTO products (name, base_unit, kg_per_base_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(name, "عدد", 0.25, now, now);
  return Number(r.lastInsertRowid);
}

describe("products", () => {
  it("has the columns the sales module needs", async () => {
    expect((await cols("products")).sort()).toEqual(
      [
        // organization_id joined every tenant table once RouteFlow became multi-tenant.
        "organization_id",
        "id",
        "name",
        "sku",
        "base_unit",
        "kg_per_base_unit",
        "avg_cost_toman",
        "active",
        "notes",
        "created_at",
        "updated_at",
        "reorder_point",
        "target_stock",
        // Phase 2 (Stock & Batches): shelf life in days, for batch expiry defaulting.
        "shelf_life_days",
        // Phase 5 (Routing): m³ per base unit, for vehicle volume capacity.
        "volume_m3_per_base_unit",
      ].sort()
    );
  });


  it("is company-wide rather than per group", async () => {
    // Like facilities, the catalogue is shared: two groups selling different products
    // would be two businesses. A group_id here would only ever be null.
    expect(await cols("products")).not.toContain("group_id");
  });
});

describe("packagings", () => {
  it("has the columns the sales module needs", async () => {
    expect((await cols("packagings")).sort()).toEqual(
      ["id", "product_id", "name", "qty_per_pack", "barcode", "active", "created_at"].sort()
    );
  });

  it("allows the same packaging name on different products", async () => {
    // «جعبه بچه» is 120 عدد for one brand and 100 for another -- both real rows in the
    // workbook. The quantity belongs to the pair, never to the name.
    const a = await seedProduct("کره گیاهی نام آور");
    const b = await seedProduct("کره گیاهی مرحبا ۲");
    const db = getDb();
    const insert = db.prepare(
      "INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, ?, ?)"
    );
    await (async () => await insert.run(a, "جعبه بچه", 120, new Date().toISOString()))();
    await (async () => await insert.run(b, "جعبه بچه", 100, new Date().toISOString()))();
  });

  it("refuses the same packaging name twice on one product", async () => {
    const p = await seedProduct("محصول تکراری");
    const db = getDb();
    const insert = db.prepare(
      "INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, ?, ?)"
    );
    await insert.run(p, "کارتن", 24, new Date().toISOString());
    await expect((async () => await insert.run(p, "کارتن", 24, new Date().toISOString()))()).rejects.toThrow();
  });

  it("refuses to hang off a product that does not exist", async () => {
    await expect((async () =>
      await getDb()
        .prepare(
          "INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, ?, ?)"
        )
        .run(999999, "کارتن", 24, new Date().toISOString()))()).rejects.toThrow();
  });

  it("goes away with its product", async () => {
    const p = await seedProduct("محصول حذفی");
    const db = getDb();
    await db.prepare(
      "INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, ?, ?)"
    ).run(p, "کارتن", 24, new Date().toISOString());
    await db.prepare("DELETE FROM products WHERE id = ?").run(p);
    const left = await db
      .prepare("SELECT COUNT(*) AS n FROM packagings WHERE product_id = ?")
      .get(p) as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("product_prices", () => {
  it("has the columns the sales module needs", async () => {
    expect((await cols("product_prices")).sort()).toEqual(
      [
        "id",
        "product_id",
        "packaging_id",
        "price_toman",
        "valid_from",
        "created_by",
        "created_at",
      ].sort()
    );
  });


  it("accepts several prices for one product, which is the whole point", async () => {
    const p = await seedProduct("محصول قیمت‌دار");
    const db = getDb();
    const insert = db.prepare(
      "INSERT INTO product_prices (product_id, price_toman, valid_from, created_at) VALUES (?, ?, ?, ?)"
    );
    await insert.run(p, 400000, "2026-01-01", new Date().toISOString());
    await insert.run(p, 440000, "2026-05-01", new Date().toISOString());
    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM product_prices WHERE product_id = ?")
      .get(p) as { n: number };
    expect(n.n).toBe(2);
  });

  it("is indexed for the lookup it exists to serve", async () => {
    expect((await indexesOn("product_prices")).some((name) => name.includes("product_prices"))).toBe(true);
  });
});
