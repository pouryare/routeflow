/** U2 «نقشهٔ پول»: what is owed in each district, from the customers the map already holds.
 *  Example: two shops in district 7 owing 20M (all older than 30 days) and 18M → 38M owed, 20M old, 2 shops. */
import { STATUS_COLOR, type MapCustomer } from "./types";

export interface DistrictMoney {
  owed: number;
  old: number;
  shops: number;
}

export function districtMoney(customers: Pick<MapCustomer, "district_id" | "debt">[]): Map<number, DistrictMoney> {
  const out = new Map<number, DistrictMoney>();
  for (const c of customers) {
    if (c.district_id == null || !c.debt || c.debt.total <= 0) continue;
    const m = out.get(c.district_id) ?? { owed: 0, old: 0, shops: 0 };
    m.owed += c.debt.total;
    m.old += c.debt.bucket_30_plus;
    m.shops += 1;
    out.set(c.district_id, m);
  }
  return out;
}

/** Same three colours as the shop pins (red: part older than 30 days, orange: older than a week, green: only fresh debt). */
export function moneyFill(m: DistrictMoney | undefined, unknown: string): string {
  if (!m) return unknown;
  if (m.old > 0) return STATUS_COLOR.not_allowed;
  return m.owed > 0 ? STATUS_COLOR.visited : unknown;
}
