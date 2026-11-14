import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { minQtyWarning, priceRowFor } from "@/lib/supplierPrice";

const testDbPath = path.join(os.tmpdir(), `rf-sprice-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct } = await import("@/lib/catalogue");
const { createSupplier } = await import("@/lib/repo/suppliers");
const { saveSupplierPrice, allSupplierPrices, deleteSupplierPrice } = await import("@/lib/repo/supplierPrices");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("D16 supplier price rows", () => {
  it("saves, changes and removes a row, and refuses another company's product", async () => {
    const db = getDb();
    const supplier = await createSupplier(1, { name: "تأمین‌کنندهٔ نمونه" });
    const product = await createProduct(db, { name: "روغن", kg_per_base_unit: 1, organization_id: 1 });
    expect(await saveSupplierPrice(1, supplier, { product_id: product, price_toman: 120_000, min_qty: 10, delivery_days: 3, supplier_code: "R-1" })).toBe(true);
    expect(await saveSupplierPrice(1, supplier, { product_id: product, price_toman: 125_000, min_qty: null })).toBe(true);
    const rows = await allSupplierPrices(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ price_toman: 125_000, min_qty: null, supplier: "تأمین‌کنندهٔ نمونه" });
    expect(await saveSupplierPrice(2, supplier, { product_id: product, price_toman: 1 })).toBe(false);
    await deleteSupplierPrice(1, supplier, product);
    expect(await allSupplierPrices(1)).toHaveLength(0);
  });
  it("warns only under the minimum", () => {
    const row = { supplier: "الف", product_id: 1, price_toman: 5, min_qty: 10, delivery_days: null, supplier_code: null };
    expect(priceRowFor([row], " الف ", 1)).toBe(row);
    expect(priceRowFor([row], "", 1)).toBeUndefined();
    expect(minQtyWarning(row, 6)).toContain("حداقل");
    expect(minQtyWarning(row, 10)).toBeNull();
    expect(minQtyWarning(undefined, 1)).toBeNull();
  });
});
