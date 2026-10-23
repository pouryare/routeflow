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

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  // A second organisation, so the tenancy test below is real. `products.organization_id`
  // is a foreign key, so the parent row has to exist before a product can claim it --
  // which is the database refusing to let this test pretend.
  await db.prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)").run(
    "سازمان دوم",
    "second-org",
    now
  );
  product = await createProduct(db, {
    name: "دوغ لیوانی",
    kg_per_base_unit: 0.25,
    organization_id: 1,
  });
  pack = await createPackaging(db, {
    product_id: product,
    name: "جعبه ۲۴ تایی",
    qty_per_pack: 24,
  });
  await db.prepare("UPDATE products SET avg_cost_toman = 40000 WHERE id = ?").run(product);
});

describe("product_costs", () => {
  it("resolves a landed row in force on the day", async () => {
    const db = getDb();
    await setCost(db, {
      product_id: product,
      packaging_id: null,
      method: "landed",
      cost_toman: 50_000,
      valid_from: "2026-01-01",
      created_by: null,
    });
    const basis = await costBasisFor(db, product, null, "2026-06-01");
    expect(basis?.cost_toman).toBe(50_000);
    expect(basis?.method).toBe("landed");
  });

  it("falls back to the moving average when no row is in force", async () => {
    const db = getDb();
    const basis = await costBasisFor(db, product, null, "2025-06-01");
    expect(basis?.method).toBe("weighted_average");
    expect(basis?.cost_toman).toBe(40_000);
  });

  it("reports no cost at all when the product was never purchased", async () => {
    const db = getDb();
    const bare = await createProduct(db, {
      name: "کالای خام",
      kg_per_base_unit: 1,
      organization_id: 1,
    });
    // avg_cost_toman is 0 -- a real zero, not an answer.
    expect(await costBasisFor(db, bare, null, "2026-06-01")).toBeNull();
  });

  it("prefers a packaging-specific row over the product-wide one", async () => {
    const db = getDb();
    await setCost(db, {
      product_id: product,
      packaging_id: pack,
      method: "landed",
      cost_toman: 1_200_000,
      valid_from: "2026-01-01",
      created_by: null,
    });
    expect((await costBasisFor(db, product, pack, "2026-06-01"))?.cost_toman).toBe(1_200_000);
  });

  it("takes the newer row when two start on the same day", async () => {
    const db = getDb();
    await setCost(db, {
      product_id: product,
      packaging_id: null,
      method: "landed",
      cost_toman: 60_000,
      valid_from: "2026-03-01",
      created_by: null,
    });
    await setCost(db, {
      product_id: product,
      packaging_id: null,
      method: "landed",
      cost_toman: 61_000,
      valid_from: "2026-03-01",
      created_by: null,
    });
    expect((await costBasisFor(db, product, null, "2026-06-01"))?.cost_toman).toBe(61_000);
  });

  it("refuses a fractional cost rather than rounding it", async () => {
    const db = getDb();
    await expect((async () =>
      await setCost(db, {
        product_id: product,
        packaging_id: null,
        method: "landed",
        cost_toman: 50_000.5,
        valid_from: "2026-01-01",
        created_by: null,
      }))()).rejects.toThrow(/بدون اعشار/);
  });

  it("reads nothing for a product owned by another organisation", async () => {
    const db = getDb();
    const theirs = await createProduct(db, {
      name: "کالای آن‌ها",
      kg_per_base_unit: 1,
      organization_id: 2,
    });
    await db.prepare("UPDATE products SET avg_cost_toman = 99000 WHERE id = ?").run(theirs);
    expect(await readCostBasis(db, 1, theirs, null, "2026-06-01")).toBeNull();
  });
});
