import { getDb } from "@/lib/db";
import { quantitiesOn } from "@/lib/stockOnDate";

export interface StockOnDateRow { productId: number; name: string; baseUnit: string; qty: number; valueToman: number }

/** D9: quantity (and value) of every product at the end of a day, all facilities together.
 *  shortcut: value uses today's average cost, because past costs are not stored; say so on the page, and
 *  upgrade when cost history exists. */
export async function stockOnDate(organizationId: number, isoDay: string): Promise<StockOnDateRow[]> {
  const db = getDb();
  const moves = (await db
    .prepare("SELECT product_id AS \"productId\", base_qty AS \"baseQty\", occurred_at AS \"occurredAt\" FROM stock_movements WHERE organization_id = ? AND substr(occurred_at, 1, 10) <= ?")
    .all(organizationId, isoDay)) as { productId: number; baseQty: number; occurredAt: string }[];
  const qty = quantitiesOn(moves.map((m) => ({ productId: Number(m.productId), baseQty: Number(m.baseQty), occurredAt: m.occurredAt })), isoDay);
  const products = (await db
    .prepare("SELECT id, name, base_unit, avg_cost_toman FROM products WHERE organization_id = ? ORDER BY name")
    .all(organizationId)) as { id: number; name: string; base_unit: string; avg_cost_toman: number }[];
  return products
    .filter((p) => (qty.get(Number(p.id)) ?? 0) !== 0)
    .map((p) => ({ productId: Number(p.id), name: p.name, baseUnit: p.base_unit, qty: qty.get(Number(p.id)) ?? 0, valueToman: Math.round((qty.get(Number(p.id)) ?? 0) * Number(p.avg_cost_toman)) }));
}
