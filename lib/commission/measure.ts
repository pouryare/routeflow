import {
  orderKg,
  orderMarginToman,
  orderTotalToman,
  effectivePacks,
  type LineSnapshot,
} from "../orderMath";

/** How much of the thing a plan is measured on. The arithmetic in `tiers.ts` is only
 *  correct if this is, so it is a separate pure module with its own tests rather than a
 *  helper inside the accrual path.
 *
 *  Every measure reuses an EXISTING function from `lib/orderMath.ts` — none of these is new
 *  arithmetic. `volume_m3` is the one addition, and the per-unit factor it needs already
 *  exists on `products` (`volume_m3_per_base_unit`, added by ALTER at lib/db.ts:3603) and is
 *  already summed the same way by `lib/repo/routing.ts:183` for vehicle capacity. That is why
 *  "commission on volume" is wiring rather than a schema change.
 *
 *  Everything here goes through `effectivePacks`, so a plan is measured on DELIVERED weight
 *  everywhere and not only in the kg case. The plan's first draft read `packs_delivered`
 *  directly, which made volume, revenue and margin all quietly pay on ORDERED quantities —
 *  and a delivery of zero is not the same as no delivery, since zero means the customer
 *  refused the line at the door. */

export type MeasurableLine = LineSnapshot & { volume_m3_per_base_unit?: number | null };

export interface MeasurableOrder {
  lines: MeasurableLine[];
}

export type Metric = "kg" | "volume_m3" | "revenue_toman" | "margin_toman" | "orders";

function volumeM3(lines: MeasurableLine[]): number {
  // `?? 0` rather than a null-guard that skips the line: a product with no volume recorded
  // contributes nothing, and treating that as "no volume anywhere" would hide real volume
  // on the other lines of the same order.
  return lines.reduce((total, line) => {
    const factor = line.volume_m3_per_base_unit ?? 0;
    return total + effectivePacks(line) * line.qty_per_pack * factor;
  }, 0);
}

export function measureFor(metric: Metric, orders: MeasurableOrder[]): number {
  switch (metric) {
    case "kg":
      return orders.reduce((sum, o) => sum + orderKg(o.lines), 0);
    case "volume_m3":
      return orders.reduce((sum, o) => sum + volumeM3(o.lines), 0);
    case "revenue_toman":
      return orders.reduce((sum, o) => sum + orderTotalToman(o.lines), 0);
    case "margin_toman":
      return orders.reduce((sum, o) => sum + orderMarginToman(o.lines), 0);
    case "orders":
      // An order with no lines is not an order someone sold, so it does not count. A line
      // that was refused at the door still WAS an order, so only the emptiness excludes it.
      return orders.filter((o) => o.lines.length > 0).length;
  }
}