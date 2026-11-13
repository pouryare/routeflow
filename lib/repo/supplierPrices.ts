import { getDb } from "@/lib/db";
import type { SupplierPriceRow } from "@/lib/supplierPrice";

export interface SupplierPriceView extends SupplierPriceRow {
  supplier_id: number;
  product_name: string;
}

/** Every price row of the company, with names: the purchase form reads it whole (a few hundred rows at most). */
export async function allSupplierPrices(organizationId: number): Promise<SupplierPriceView[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT sp.supplier_id, s.name AS supplier, sp.product_id, p.name AS product_name, sp.price_toman, sp.min_qty, sp.delivery_days, sp.supplier_code
         FROM supplier_prices sp JOIN suppliers s ON s.id = sp.supplier_id JOIN products p ON p.id = sp.product_id
        WHERE sp.organization_id = ? ORDER BY s.name, p.name`
    )
    .all(organizationId)) as unknown as SupplierPriceView[];
  return rows.map((r) => ({ ...r, supplier_id: Number(r.supplier_id), product_id: Number(r.product_id), price_toman: Number(r.price_toman), min_qty: r.min_qty === null ? null : Number(r.min_qty), delivery_days: r.delivery_days === null ? null : Number(r.delivery_days) }));
}

export interface SupplierPriceInput {
  product_id: number;
  price_toman: number;
  min_qty?: number | null;
  delivery_days?: number | null;
  supplier_code?: string | null;
}

/** Add or change a supplier's price for a product. False when the supplier or product is not this company's. */
export async function saveSupplierPrice(organizationId: number, supplierId: number, i: SupplierPriceInput): Promise<boolean> {
  const db = getDb();
  const ok = await db.prepare("SELECT 1 FROM suppliers s, products p WHERE s.id = ? AND s.organization_id = ? AND p.id = ? AND p.organization_id = ?").get(supplierId, organizationId, i.product_id, organizationId);
  if (!ok) return false;
  await db
    .prepare(
      `INSERT INTO supplier_prices (organization_id, supplier_id, product_id, price_toman, min_qty, delivery_days, supplier_code, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (supplier_id, product_id) DO UPDATE SET price_toman = EXCLUDED.price_toman, min_qty = EXCLUDED.min_qty, delivery_days = EXCLUDED.delivery_days, supplier_code = EXCLUDED.supplier_code, updated_at = EXCLUDED.updated_at`
    )
    .run(organizationId, supplierId, i.product_id, i.price_toman, i.min_qty ?? null, i.delivery_days ?? null, i.supplier_code?.trim() || null, new Date().toISOString());
  return true;
}

export async function deleteSupplierPrice(organizationId: number, supplierId: number, productId: number): Promise<void> {
  await getDb().prepare("DELETE FROM supplier_prices WHERE organization_id = ? AND supplier_id = ? AND product_id = ?").run(organizationId, supplierId, productId);
}
