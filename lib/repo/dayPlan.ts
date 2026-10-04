import type { DatabaseSync } from "node:sqlite";
import type { SplitOrder, DayLimit } from "@/lib/dayCapacity";

/** An order as the board's day-split sees it: where it goes, how heavy it is, and whether the
 *  customer named a day.
 *
 *  Carries `kg` and `volumeM3` because a van's three limits are stops, kilograms and cubic
 *  metres — a plan that only knew the stop count would let the manager promise a day the van
 *  cannot physically carry. Both are also copied onto `weightKg`/`volumeM3`, the names the pure
 *  module reads, so the panel never has to translate between the two shapes. */
export interface PlannableOrder extends SplitOrder {
  orderId: number;
  orderNo: string;
  customerName: string;
  kg: number;
  volumeM3: number;
  weightKg: number;
}

/** A day that already has a run, with how much room is left on it. */
export interface PlannedDay {
  day: string;
  runId: number;
  driverName: string;
  used: number;
  limit: DayLimit;
}

/*  Weight and volume are DERIVED from the frozen line columns rather than read off the order.
 *  `kg_per_base_unit` and `qty_per_pack` are captured when the line is written, so a later price
 *  or packaging change cannot retroactively alter what today's van weighs — the same reason the
 *  order total is computed from lines rather than stored.
 *
 *  `packs_ordered`, not `packs_delivered`: the split plans the LOAD, and the driver's count at
 *  the door is what the run's actual weight becomes afterwards. */
const PLANNABLE_SQL = `
  SELECT o.id,
         o.order_no,
         o.requested_day,
         COALESCE(c.business_name, '—') AS customer_name,
         c.lat,
         c.lng,
         COALESCE(SUM(ol.packs_ordered * ol.kg_per_base_unit * ol.qty_per_pack), 0) AS kg,
         COALESCE(SUM(ol.packs_ordered * ol.qty_per_pack * p.volume_m3_per_base_unit), 0) AS volume_m3
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN order_lines ol ON ol.order_id = o.id
    LEFT JOIN products p ON p.id = ol.product_id
   WHERE o.status = 'CONFIRMED'
     AND NOT EXISTS (SELECT 1 FROM delivery_stops ds WHERE ds.order_id = o.id)
   GROUP BY o.id
   ORDER BY o.id DESC
   LIMIT ?`;

/** Confirmed orders that are not on any run yet — the pool a manager is planning from.
 *
 *  Scoped by the caller, not here: this module reads rows, it decides nothing about who may see
 *  them. `scope` is the fragment `orderFilter` already produced, so scoping stays decided once at
 *  the route rather than per query. */
export function readPlannableOrders(
  db: DatabaseSync,
  scope: { sql: string; params: (number | string)[] },
  limit = 300,
): PlannableOrder[] {
  const rows = db
    .prepare(PLANNABLE_SQL)
    .all(...scope.params, limit) as unknown as {
    id: number;
    order_no: string;
    requested_day: string | null;
    customer_name: string;
    lat: number | null;
    lng: number | null;
    kg: number;
    volume_m3: number;
  }[];

  return rows.map((r) => ({
    // `id` is a string on SplitOrder because the pure module is written against ids that may
    // come from anywhere; the board keys orders by their numeric id, so it is carried
    // separately rather than stringified and parsed back on every render.
    id: String(r.id),
    orderId: r.id,
    orderNo: r.order_no,
    customerName: r.customer_name,
    lat: r.lat,
    lng: r.lng,
    requestedDay: r.requested_day,
    kg: r.kg,
    volumeM3: r.volume_m3,
    // The name planDaySplit reads. Duplicated rather than aliased so the pure module stays
    // ignorant of this table's vocabulary.
    weightKg: r.kg,
  }));
}

/** Days that already have a run, soonest first, each with the limits of the driver's vehicle.
 *
 *  A run with no vehicle attached is limited by stop count alone, so it is still returned —
 *  `max_stops` is what the manager sets per day in the UI, and it applies with or without a van.
 *  Runs in the past are excluded: you cannot add Thursday's work to last Tuesday. */
export function readPlannedDays(
  db: DatabaseSync,
  scope: { sql: string; params: (number | string)[] },
  fromDay: string,
  defaultLimit: DayLimit,
): PlannedDay[] {
  const rows = db
    .prepare(
      `SELECT dr.id AS run_id,
              dr.run_date AS day,
              u.display_name AS driver_name,
              (SELECT COUNT(*) FROM delivery_stops ds WHERE ds.run_id = dr.id) AS used,
              v.max_stops,
              v.max_weight_kg,
              v.max_volume_m3
         FROM delivery_runs dr
         JOIN users u ON u.id = dr.driver_user_id
         LEFT JOIN vehicles v ON v.id = dr.vehicle_id
        WHERE dr.run_date >= ?
          AND dr.status != 'done'
          AND 1 = 1${scope.sql}
        ORDER BY dr.run_date ASC, dr.id ASC`,
    )
    .all(fromDay, ...scope.params) as unknown as {
    run_id: number;
    day: string;
    driver_name: string;
    used: number;
    max_stops: number | null;
    max_weight_kg: number | null;
    max_volume_m3: number | null;
  }[];

  return rows.map((r) => ({
    day: r.day,
    runId: r.run_id,
    driverName: r.driver_name,
    used: r.used,
    limit: {
      // The vehicle's caps win where it has them; the manager's per-day number fills the gaps.
      stops: r.max_stops ?? defaultLimit.stops ?? null,
      weightKg: r.max_weight_kg ?? defaultLimit.weightKg ?? null,
      volumeM3: r.max_volume_m3 ?? defaultLimit.volumeM3 ?? null,
    },
  }));
}

/** Re-exported so the page reads its limits from one place. */