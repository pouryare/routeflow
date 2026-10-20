import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-product-costs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setCost, costBasisFor, readCostBasis } =
  await import("@/lib/catalogue");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let product = 0;
let pack = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  // A second organisation, so the tenancy test below is real. `products.organization_id`
  // is a foreign key, so the parent row has to exist before a product can claim it --
  // which is the database refusing to let this test pretend.
  db.prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)").run(
    "سازمان دوم",
    "second-org",
    now
  );
  product = createProduct(db, {
    name: "دوغ لیوانی",
    kg_per_base_unit: 0.25,
    organization_id: 1,
  });
  pack = createPackaging(db, {
    product_id: product,
    name: "جعبه ۲۴ تایی",
    qty_per_pack: 24,
  });
  db.prepare("UPDATE products SET avg_cost_toman = 40000 WHERE id = ?").run(product);
});

describe("product_costs", () => {
  it("resolves a landed row in force on the day", () => {
    const db = getDb();
    setCost(db, {
      product_id: product,
      packaging_id: null,
      method: "landed",
      cost_toman: 50_000,
      valid_from: "2026-01-01",
      created_by: null,
    });
    const basis = costBasisFor(db, product, null, "2026-06-01");
    expect(basis?.cost_toman).toBe(50_000);
    expect(basis?.method).toBe("landed");
  });

  it("falls back to the moving average when no row is in force", () => {
    const db = getDb();
    const basis = costBasisFor(db, product, null, "2025-06-01");
    expect(basis?.method).toBe("weighted_average");
    expect(basis?.cost_toman).toBe(40_000);
  });

  it("reports no cost at all when the product was never purchased", () => {
    const db = getDb();
    const bare = createProduct(db, {
      name: "کالای خام",
      kg_per_base_unit: 1,
      organization_id: 1,
    });
    // avg_cost_toman is 0 -- a real zero, not an answer.
    expect(costBasisFor(db, bare, null, "2026-06-01")).toBeNull();
  });

  it("prefers a packaging-specific row over the product-wide one", () => {
    const db = getDb();
    setCost(db, {
      product_id: product,
      packaging_id: pack,
      method: "landed",
      cost_toman: 1_200_000,
      valid_from: "2026-01-01",
      created_by: null,
    });
    expect(costBasisFor(db, product, pack, "2026-06-01")?.cost_toman).toBe(1_200_000);
  });

  it("takes the newer row when two start on the same day", () => {
    const db = getDb();
    setCost(db, {
      product_id: product,
      packaging_id: null,
      method: "landed",
      cost_toman: 60_000,
      valid_from: "2026-03-01",
      created_by: null,
    });
    setCost(db, {
      product_id: product,
      packaging_id: null,
      method: "landed",
      cost_toman: 61_000,
      valid_from: "2026-03-01",
      created_by: null,
    });
    expect(costBasisFor(db, product, null, "2026-06-01")?.cost_toman).toBe(61_000);
  });

  it("refuses a fractional cost rather than rounding it", () => {
    const db = getDb();
    expect(() =>
      setCost(db, {
        product_id: product,
        packaging_id: null,
        method: "landed",
        cost_toman: 50_000.5,
        valid_from: "2026-01-01",
        created_by: null,
      })
    ).toThrow(/بدون اعشار/);
  });

  it("reads nothing for a product owned by another organisation", () => {
    const db = getDb();
    const theirs = createProduct(db, {
      name: "کالای آن‌ها",
      kg_per_base_unit: 1,
      organization_id: 2,
    });
    db.prepare("UPDATE products SET avg_cost_toman = 99000 WHERE id = ?").run(theirs);
    expect(readCostBasis(db, 1, theirs, null, "2026-06-01")).toBeNull();
  });
});
