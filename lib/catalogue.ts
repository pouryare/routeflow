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

import type { DatabaseSync } from "node:sqlite";
import { priceAt, type PriceRow } from "./pricing";
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
  opts: { includeInactive?: boolean; onDate?: string } = {}
): CatalogueProduct[] {
  const onDate = opts.onDate ?? new Date().toISOString().slice(0, 10);

  const products = db
    .prepare(
      `SELECT * FROM products ${opts.includeInactive ? "" : "WHERE active = 1"} ORDER BY name`
    )
    .all() as unknown as ProductRow[];

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
    base_unit?: string;
    sku?: string | null;
    notes?: string | null;
  }
): number {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO products (name, sku, base_unit, kg_per_base_unit, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.name.trim(),
    input.sku?.trim() || null,
    input.base_unit?.trim() || "عدد",
    input.kg_per_base_unit,
    input.notes?.trim() || null,
    now,
    now
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
    throw new TypeError(`قیمت باید عدد صحیح تومان باشد: ${input.price_toman}`);
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
