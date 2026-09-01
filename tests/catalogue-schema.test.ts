import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-catalogue-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(() => {
  getDb();
});

function cols(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map(
    (c) => c.name
  );
}

function tableSql(table: string): string {
  return (
    getDb()
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table) as { sql: string }
  ).sql;
}

function seedProduct(name = "کره گیاهی مرحبا"): number {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO products (name, base_unit, kg_per_base_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(name, "عدد", 0.25, now, now);
  return (getDb().prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
}

describe("products", () => {
  it("has the columns the sales module needs", () => {
    expect(cols("products").sort()).toEqual(
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
      ].sort()
    );
  });

  it("holds cost as whole Toman, not REAL", () => {
    // The rule from lib/money.ts: the legacy REAL money columns stay as history, but
    // nothing new is allowed to be a float. A cost that drifts is a margin that drifts.
    expect(tableSql("products")).toMatch(/avg_cost_toman\s+INTEGER/);
  });

  it("is company-wide rather than per group", () => {
    // Like facilities, the catalogue is shared: two groups selling different products
    // would be two businesses. A group_id here would only ever be null.
    expect(cols("products")).not.toContain("group_id");
  });
});

describe("packagings", () => {
  it("has the columns the sales module needs", () => {
    expect(cols("packagings").sort()).toEqual(
      ["id", "product_id", "name", "qty_per_pack", "barcode", "active", "created_at"].sort()
    );
  });

  it("allows the same packaging name on different products", () => {
    // «جعبه بچه» is 120 عدد for one brand and 100 for another -- both real rows in the
    // workbook. The quantity belongs to the pair, never to the name.
    const a = seedProduct("کره گیاهی نام آور");
    const b = seedProduct("کره گیاهی مرحبا ۲");
    const db = getDb();
    const insert = db.prepare(
      "INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, ?, ?)"
    );
    expect(() => insert.run(a, "جعبه بچه", 120, new Date().toISOString())).not.toThrow();
    expect(() => insert.run(b, "جعبه بچه", 100, new Date().toISOString())).not.toThrow();
  });

  it("refuses the same packaging name twice on one product", () => {
    const p = seedProduct("محصول تکراری");
    const db = getDb();
    const insert = db.prepare(
      "INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, ?, ?)"
    );
    insert.run(p, "کارتن", 24, new Date().toISOString());
    expect(() => insert.run(p, "کارتن", 24, new Date().toISOString())).toThrow();
  });

  it("refuses to hang off a product that does not exist", () => {
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, ?, ?)"
        )
        .run(999999, "کارتن", 24, new Date().toISOString())
    ).toThrow();
  });

  it("goes away with its product", () => {
    const p = seedProduct("محصول حذفی");
    const db = getDb();
    db.prepare(
      "INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, ?, ?)"
    ).run(p, "کارتن", 24, new Date().toISOString());
    db.prepare("DELETE FROM products WHERE id = ?").run(p);
    const left = db
      .prepare("SELECT COUNT(*) AS n FROM packagings WHERE product_id = ?")
      .get(p) as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("product_prices", () => {
  it("has the columns the sales module needs", () => {
    expect(cols("product_prices").sort()).toEqual(
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

  it("holds price as whole Toman, not REAL", () => {
    expect(tableSql("product_prices")).toMatch(/price_toman\s+INTEGER/);
  });

  it("accepts several prices for one product, which is the whole point", () => {
    const p = seedProduct("محصول قیمت‌دار");
    const db = getDb();
    const insert = db.prepare(
      "INSERT INTO product_prices (product_id, price_toman, valid_from, created_at) VALUES (?, ?, ?, ?)"
    );
    insert.run(p, 400000, "2026-01-01", new Date().toISOString());
    insert.run(p, 440000, "2026-05-01", new Date().toISOString());
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM product_prices WHERE product_id = ?")
      .get(p) as { n: number };
    expect(n.n).toBe(2);
  });

  it("is indexed for the lookup it exists to serve", () => {
    const idx = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='product_prices'")
      .all() as { name: string }[];
    expect(idx.some((i) => i.name.includes("product_prices"))).toBe(true);
  });
});
