/** Reading and writing the product catalogue.
 *
 *  The catalogue is the one part of the workbook that has to move across before anything
 *  else can be recorded, and it is the part that was left half done -- four products in a
 *  sheet provisioned for thirteen, with دوغ لیوانی and ماست موسیر زیتون sold but never
 *  entered. So this is deliberately the first thing built.
 *
 *  Prices are not a column on the product. See lib/pricing.ts for the reasoning; the
 *  short version is that one price cell means editing today's price rewrites last
 *  month's revenue, silently, which is exactly the thing a spreadsheet cannot avoid.
 */

import { tehranTodayIso } from "@/lib/jalali";
import type { DatabaseSync } from "node:sqlite";
import { priceAt, type PriceRow } from "./pricing";
import { avgCostFor, costRowsFor, effectiveCost } from "./repo/productCosts";
import { isToman } from "./money";

export interface ProductRow {
  id: number;
  name: string;
  sku: string | null;
  base_unit: string;
  kg_per_base_unit: number;
  avg_cost_toman: number;
  active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Reorder policy, in base_unit -- both null until an owner sets them. See
   *  lib/purchases.ts's advancedStockPosition for what a null one means on screen. */
  reorder_point: number | null;
  target_stock: number | null;
}

export interface PackagingRow {
  id: number;
  product_id: number;
  name: string;
  qty_per_pack: number;
  barcode: string | null;
  active: number;
  created_at: string;
}

export interface PricedPackaging extends PackagingRow {
  /** Null means no price has been set that applies on the date asked for. Null rather
   *  than 0, because 0 is a real price and a free order is a real thing. */
  price_toman: number | null;
  price_id: number | null;
}

export interface CatalogueProduct extends ProductRow {
  packagings: PricedPackaging[];
}

/** Every price row for a product, both product-wide and packaging-specific. */
function pricesFor(db: DatabaseSync, productId: number) {
  return db
    .prepare(
      "SELECT id, packaging_id, price_toman, valid_from FROM product_prices WHERE product_id = ?"
    )
    .all(productId) as unknown as (PriceRow & { packaging_id: number | null })[];
}

/** The price to charge for one packaging on one day.
 *
 *  A price attached to the packaging wins over one attached to the whole product, but
 *  only where such a row is actually in force -- so a product-wide price set in January
 *  still applies to a carton whose own price does not start until May, rather than the
 *  carton having no price for four months.
 */
export function resolvePrice(
  db: DatabaseSync,
  productId: number,
  packagingId: number | null,
  onDate: string
): PriceRow | null {
  const rows = pricesFor(db, productId);
  const specific = packagingId === null ? [] : rows.filter((r) => r.packaging_id === packagingId);
  return priceAt(specific, onDate) ?? priceAt(rows.filter((r) => r.packaging_id === null), onDate);
}

export function readCatalogue(
  db: DatabaseSync,
  organizationId: number,
  opts: { includeInactive?: boolean; onDate?: string } = {}
): CatalogueProduct[] {
  const onDate = opts.onDate ?? tehranTodayIso();

  const products = db
    .prepare(
      `SELECT * FROM products WHERE organization_id = ? ${
        opts.includeInactive ? "" : "AND active = 1"
      } ORDER BY name`
    )
    .all(organizationId) as unknown as ProductRow[];

  return products.map((product) => {
    const packagings = db
      .prepare(
        `SELECT * FROM packagings WHERE product_id = ? ${
          opts.includeInactive ? "" : "AND active = 1"
        } ORDER BY qty_per_pack DESC`
      )
      .all(product.id) as unknown as PackagingRow[];

    return {
      ...product,
      packagings: packagings.map((packaging) => {
        const hit = resolvePrice(db, product.id, packaging.id, onDate);
        return { ...packaging, price_toman: hit?.price_toman ?? null, price_id: hit?.id ?? null };
      }),
    };
  });
}

export function createProduct(
  db: DatabaseSync,
  input: {
    name: string;
    kg_per_base_unit: number;
    /** Required, not optional: the catalogue is per-tenant now, and a product inserted
     *  with a NULL organisation is invisible to readCatalogue and impossible to spot on
     *  screen. A missing stamp should fail to compile, not fail silently. */
    organization_id: number;
    base_unit?: string;
    sku?: string | null;
    notes?: string | null;
  }
): number {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO products (name, sku, base_unit, kg_per_base_unit, notes, created_at, updated_at, organization_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.name.trim(),
    input.sku?.trim() || null,
    input.base_unit?.trim() || "عدد",
    input.kg_per_base_unit,
    input.notes?.trim() || null,
    now,
    now,
    input.organization_id
  );
  return (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
}

export function createPackaging(
  db: DatabaseSync,
  input: { product_id: number; name: string; qty_per_pack: number; barcode?: string | null }
): number {
  db.prepare(
    "INSERT INTO packagings (product_id, name, qty_per_pack, barcode, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(
    input.product_id,
    input.name.trim(),
    input.qty_per_pack,
    input.barcode?.trim() || null,
    new Date().toISOString()
  );
  return (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
}

/** Records a new price. Always an INSERT -- there is no updatePrice, on purpose.
 *
 *  Rejects a fractional amount rather than rounding it. A fraction arriving here means a
 *  float got into a money path upstream, and rounding it away hides the bug at the one
 *  moment it is cheap to find.
 */
export function setPrice(
  db: DatabaseSync,
  input: {
    product_id: number;
    packaging_id?: number | null;
    price_toman: number;
    valid_from: string;
    created_by?: number | null;
  }
): number {
  if (!isToman(input.price_toman)) {
    throw new TypeError("قیمت را به تومان و بدون اعشار وارد کنید");
  }
  db.prepare(
    `INSERT INTO product_prices (product_id, packaging_id, price_toman, valid_from, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.product_id,
    input.packaging_id ?? null,
    input.price_toman,
    input.valid_from.slice(0, 10),
    input.created_by ?? null,
    new Date().toISOString()
  );
  return (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
}

/** One effective-dated cost row. */
export interface CostRow {
  id: number;
  product_id: number;
  packaging_id: number | null;
  method: "weighted_average" | "landed";
  cost_toman: number;
  valid_from: string;
}

/** What the calculator treats as the cost of one unit. */
export interface CostBasis {
  cost_toman: number;
  method: "weighted_average" | "landed";
  /** null when it came from products.avg_cost_toman rather than a product_costs row. */
  cost_id: number | null;
}

/** Records a cost override. Always an INSERT -- there is no updateCost, on purpose.
 *
 *  Rejects a fractional amount rather than rounding it, for the reason `setPrice` does:
 *  a fraction arriving here means a float got into a money path upstream, and rounding
 *  it away hides the bug at the moment it is cheapest to find.
 */
export function setCost(
  db: DatabaseSync,
  input: {
    product_id: number;
    packaging_id?: number | null;
    method: "weighted_average" | "landed";
    cost_toman: number;
    valid_from: string;
    created_by?: number | null;
  }
): number {
  if (!isToman(input.cost_toman)) {
    throw new TypeError("بهای تمام‌شده را به تومان و بدون اعشار وارد کنید");
  }
  db.prepare(
    `INSERT INTO product_costs (product_id, packaging_id, method, cost_toman, valid_from, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.product_id,
    input.packaging_id ?? null,
    input.method,
    input.cost_toman,
    input.valid_from.slice(0, 10),
    input.created_by ?? null,
    new Date().toISOString()
  );
  return (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
}

/** The cost of one unit on a date, or null when nothing is known.
 *
 *  Packaging-specific beats product-wide, exactly as `resolvePrice` does -- the same
 *  precedence, because a box of 24 and a single unit genuinely cost different amounts and
 *  picking the wrong one is a real margin error.
 *
 *  THREE outcomes, and the third is the one that matters:
 *
 *    1. a product_costs row in force          -> that row, labelled with its method
 *    2. no row in force, avg_cost_toman > 0  -> the moving average
 *    3. no row in force, avg_cost_toman == 0 -> null
 *
 *  Case 3 is NOT a cost of zero. `priceAt()` returns null rather than falling back to
 *  the earliest price because "a product with no price on the day of sale is a data
 *  problem the person recording the order has to see, not something to paper over with
 *  a number that was never charged" -- and the arithmetic here is worse, because
 *  P = (C + F) / (1 - a - m) will happily return a confident price built from overheads
 *  alone for a product nobody ever purchased. Same distinction order_lines draws when it
 *  says a null `packs_delivered` is not the same thing as a delivered zero.
 *
 *  The queries live in `lib/repo/productCosts.ts`: this file predates the raw-SQL rule and
 *  is grandfathered, but the reads are new code and the rule is a ratchet, not a
 *  grandfathering of everything anyone adds to an old file.
 */
export function costBasisFor(
  db: DatabaseSync,
  productId: number,
  packagingId: number | null,
  onDate: string
): CostBasis | null {
  const hit = effectiveCost(costRowsFor(db, productId), packagingId, onDate);
  if (hit) {
    return { cost_toman: hit.cost_toman, method: hit.method, cost_id: hit.id };
  }

  const avg = avgCostFor(db, productId);
  if (avg === null || avg <= 0) return null;
  return { cost_toman: avg, method: "weighted_average", cost_id: null };
}

/** `costBasisFor` scoped to one organisation.
 *
 *  The tenancy filter lives here and not in the caller, so no route or repo function can
 *  forget it. The join through products is what makes scoping possible at all --
 *  product_costs carries no tenant column of its own.
 */
export function readCostBasis(
  db: DatabaseSync,
  organizationId: number,
  productId: number,
  packagingId: number | null,
  onDate: string
): CostBasis | null {
  const owned = db
    .prepare("SELECT id FROM products WHERE id = ? AND organization_id = ?")
    .get(productId, organizationId);
  if (!owned) return null;
  return costBasisFor(db, productId, packagingId, onDate);
}

/** Sets a product's reorder policy. A plain UPDATE, unlike setPrice and setRate --
 *  there is no invoice or commission statement that has to keep reading yesterday's
 *  reorder point, so there is nothing an INSERT-only history would protect here that a
 *  live value does not already give for free.
 *
 *  Either field passed as null CLEARS it -- undefined leaves it alone. That distinction
 *  is what lets an owner clear a threshold without the API forcing a bogus value into
 *  the other one just to keep the call shaped the same.
 */
export function setStockThresholds(
  db: DatabaseSync,
  productId: number,
  input: { reorder_point?: number | null; target_stock?: number | null }
): void {
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new TypeError(`${key} باید عددی نامنفی یا خالی باشد: ${value}`);
    }
  }
  const sets: string[] = [];
  const params: (number | null)[] = [];
  if ("reorder_point" in input) {
    sets.push("reorder_point = ?");
    params.push(input.reorder_point ?? null);
  }
  if ("target_stock" in input) {
    sets.push("target_stock = ?");
    params.push(input.target_stock ?? null);
  }
  if (sets.length === 0) return;
  db.prepare(`UPDATE products SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(
    ...params,
    new Date().toISOString(),
    productId
  );
}
