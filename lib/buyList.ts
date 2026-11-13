/** D17: the buy list. Pure. Example: shelf holds 20, target 100, supplier minimum 50 → ask for 80 (target less shelf),
 *  rounded up to a multiple of 50 only when below it: minimum 100 → ask for 100. A product with no supplier price row
 *  goes in a group of its own, "no supplier yet". */
export interface BuyProduct { productId: number; name: string; unit: string; onHand: number; reorderPoint: number | null; target: number | null; sellOff: boolean }
export interface BuyPrice { supplierId: number; supplier: string; productId: number; price: number; minQty: number | null; deliveryDays: number | null }
interface BuyLine { productId: number; name: string; unit: string; qty: number; price: number | null; deliveryDays: number | null }
export interface BuyGroup { supplierId: number | null; supplier: string; lines: BuyLine[]; totalToman: number }

export function buyQty(p: BuyProduct, minQty: number | null): number {
  const want = Math.max(0, (p.target ?? p.reorderPoint ?? 0) - p.onHand);
  return want === 0 ? 0 : Math.max(want, minQty ?? 0);
}

export function buyList(products: BuyProduct[], prices: BuyPrice[]): BuyGroup[] {
  const groups = new Map<number | null, BuyGroup>();
  for (const p of products) {
    if (p.sellOff || p.reorderPoint === null || p.onHand > p.reorderPoint) continue;
    // cheapest supplier first, the quicker one on a tie
    const best = prices.filter((x) => x.productId === p.productId).sort((a, b) => a.price - b.price || (a.deliveryDays ?? 99) - (b.deliveryDays ?? 99))[0];
    const qty = buyQty(p, best?.minQty ?? null);
    if (qty === 0) continue;
    const key = best?.supplierId ?? null;
    const g = groups.get(key) ?? { supplierId: key, supplier: best?.supplier ?? "بدون تأمین‌کننده", lines: [], totalToman: 0 };
    g.lines.push({ productId: p.productId, name: p.name, unit: p.unit, qty, price: best?.price ?? null, deliveryDays: best?.deliveryDays ?? null });
    g.totalToman += qty * (best?.price ?? 0);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (a.supplierId === null ? 1 : 0) - (b.supplierId === null ? 1 : 0) || a.supplier.localeCompare(b.supplier, "fa"));
}
