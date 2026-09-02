/** The inventory engine from source §6 — a pure module, no `db` import.
 *
 *  `Reorder Point = avg_daily_sales × lead_time + safety_stock`. `avg_daily_sales` is
 *  where Phase 10 plugs in: `lib/repo/forecast.avgDailySalesFor` hands this the
 *  forecast run-rate instead of a raw trailing average.
 */

export function reorderPoint(
  avgDailySales: number,
  leadTimeDays: number,
  safetyStock: number
): number {
  return avgDailySales * leadTimeDays + safetyStock;
}

/** Days of cover at the current sales rate. Infinite when nothing is selling. */
export function stockDays(available: number, avgDailySales: number): number {
  return avgDailySales > 0 ? available / avgDailySales : Infinity;
}

export type InvState = "healthy" | "overstock" | "low" | "stockout_risk" | "dead";

/** 🟢 healthy · 🟡 overstock · 🟠 low · 🔴 stockout_risk · ⚫ dead.
 *  Dead stock wins first (source: "no sales > 60 days AND stock > 0"). */
export function inventoryState(
  available: number,
  avgDailySales: number,
  reorder: number,
  daysSinceLastSale: number
): InvState {
  if (daysSinceLastSale > 60 && available > 0) return "dead";
  if (available <= 0 || available < reorder * 0.5) return "stockout_risk";
  if (available < reorder) return "low";
  if (stockDays(available, avgDailySales) > 60) return "overstock";
  return "healthy";
}
