import { getDb } from "@/lib/db";

/** D32: mark a product «تصفیه» or take the mark off. The caller has already checked the product is
 *  in the company. */
export async function setSellOff(productId: number, on: boolean): Promise<void> {
  await getDb()
    .prepare("UPDATE products SET sell_off = ?, updated_at = ? WHERE id = ?")
    .run(on ? 1 : 0, new Date().toISOString(), productId);
}

/** D32, from the periodic sweep: every «تصفیه» product with nothing left on hand anywhere (warehouse
 *  and vans) is switched inactive, so it leaves the order pickers by itself. Returns how many. */
export async function retireSoldOut(organizationId: number): Promise<number> {
  const r = await getDb()
    .prepare(
      `UPDATE products p SET active = 0, updated_at = ?
        WHERE p.organization_id = ? AND p.sell_off = 1 AND p.active = 1
          AND COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m WHERE m.product_id = p.id), 0) <= 0`
    )
    .run(new Date().toISOString(), organizationId);
  return Number(r.changes ?? 0);
}
