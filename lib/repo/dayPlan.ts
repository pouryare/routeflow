import type { DatabaseSync } from "node:sqlite";
import { createRun, addStop } from "@/lib/delivery";
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
  /** The most recent FAILED delivery for this order, or null if it has never failed.
   *  Carried so a card can say WHY it needs re-planning instead of looking like work that
   *  was simply forgotten. Going back to the pool is automatic; going back onto the SAME van
   *  is a decision, so the reason has to travel with the order. */
  lastFailedDeliveryId: number | null;
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
         COALESCE(SUM(ol.packs_ordered * ol.qty_per_pack * p.volume_m3_per_base_unit), 0) AS volume_m3,
         /* NULL for an order that has never been attempted. For one that failed, the
            reason_id and the stop, so the card can say WHY this needs re-planning instead
            of just looking like work that was forgotten. */
         (SELECT fr.id FROM deliveries fr
           WHERE fr.order_id = o.id AND fr.status = 'FAILED'
           ORDER BY fr.id DESC LIMIT 1) AS last_failed_delivery_id
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN order_lines ol ON ol.order_id = o.id
    LEFT JOIN products p ON p.id = ol.product_id
   /* CONFIRMED, plus PLANNED -- and the second one is the fix.
    *
      retryDelivery puts a failed order back to PLANNED, which is the app saying "this needs
      planning again". A pool that only reads CONFIRMED therefore cannot show it: the order
      has been given back by the state machine and is simultaneously invisible to the one
      screen whose job is to notice unassigned work. Nothing anywhere said why.
    *
      PLANNED is included ONLY here. An order sitting in PLANNED is by definition not on a
      van, so it cannot double-book -- and the NOT EXISTS below still holds back one that a
      driver is legitimately part-way through. */
   WHERE o.status IN ('CONFIRMED', 'PLANNED')
     /* A FAILED delivery does not disqualify an order from planning.
      *
        DELIVERY_FAILED transitions back to PLANNED, so the order is genuinely unassigned
        again -- but its delivery_stops row still exists, and this NOT EXISTS was hiding it
        from the one screen whose job is to notice unassigned work. A manager planning the
        week never saw the failed order at all, and nothing anywhere said why.
      *
        Only a stop that is still PENDING means somebody owns it. 'refused' and 'skipped'
        count as driven-to: the driver went, the customer said no, and the goods came back
        on the van. Re-planning those is a separate decision the manager makes deliberately --
        which is why the failure reason rides along on the row rather than being guessed. */
     AND NOT EXISTS (
       SELECT 1 FROM delivery_stops ds
        WHERE ds.order_id = o.id
          /* pending, UNLESS the order itself has been handed back.
           *
           * The stop alone cannot decide this. A failed delivery leaves the stop 'pending' --
           * the driver never got an answer -- while retryDelivery puts the order back to
           * PLANNED. So "a pending stop exists" does NOT mean "somebody owns this": an order
           * the state machine has given back belongs to nobody until it is handed out again.
           *
           * Without the o.status test, the fix in the outer WHERE is inert: PLANNED would be
           * read in, and this NOT EXISTS would throw it straight back out again. */
          AND ds.status = 'pending'
          AND o.status <> 'PLANNED'
     )
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
    last_failed_delivery_id: number | null;
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
    lastFailedDeliveryId: r.last_failed_delivery_id,
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

/** One lane of a proposal being committed: orders going onto a run.
 *
 *  `runId` set means "add these to the run that already exists"; null means "make the run
 *  first", which is why `driverUserId` and `day` are required rather than optional — a new day
 *  with nobody to drive it is not a day. */
export interface CommitLane {
  runId: number | null;
  driverUserId: number | null;
  day: string;
  orderIds: number[];
}

/** What came back, so the board can say what happened rather than only that something did. */
export interface CommitResult {
  createdRuns: number;
  addedStops: number;
  /** Orders the server refused, in Persian, ready to show. A lane that fails leaves its other
   *  lanes committed — the caller says which, rather than the whole plan silently vanishing. */
  refused: string[];
}

/** Whether the caller may touch this run and this driver. Both answers, because a lane needs
 *  them together and a half-checked lane is a lane that books work somewhere unreachable.
 *
 *  Raw SQL lives here, not in the route: the repo-boundary test allows a route to SELECT but
 *  never to INSERT, and a validation SELECT inside the handler is how that boundary erodes one
 *  route at a time. */
export function laneTargetsAreReachable(
  db: DatabaseSync,
  lanes: CommitLane[],
  organizationId: number,
): CommitLane[] {
  const runStmt = db.prepare("SELECT id FROM delivery_runs WHERE id = ? AND organization_id = ?");
  const driverStmt = db.prepare(
    `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.id = ? AND u.active = 1 AND u.organization_id = ?
        AND ur.role = 'delivery_driver'`,
  );

  return lanes.flatMap((lane) => {
    if (lane.runId != null) {
      return runStmt.get(lane.runId, organizationId) ? [lane] : [];
    }
    const driverId = Number(lane.driverUserId);
    return driverId && (driverStmt.get(driverId, organizationId) as unknown) ? [lane] : [];
  });
}

/** Commits a day-split proposal: creates the runs that do not exist, then loads every lane.
 *
 *  ONE transaction for the whole plan, and deliberately so. `createRun` and `addStop` are two
 *  separate endpoints when a manager drags by hand, and a half-applied split is fine there —
 *  they see it. A split of thirty orders is not fine that way: the manager clicked once, and a
 *  failure halfway leaves runs created with three stops each and no record of what was meant to
 *  be on them. `addStop` also calls `planDelivery`, which moves the order's status; rolling that
 *  back is not something the client can do.
 *
 *  `addStop` refuses drafts, credit-held orders and frozen routes, and those refusals are COLLECTED
 *  rather than thrown, because refusing one order should not undo thirty.
 *
 *  Raw SQL lives here, not in the route: the repo-boundary test allows `SELECT` in a route but
 *  not `INSERT`. */
export function commitDaySplit(
  db: DatabaseSync,
  lanes: CommitLane[],
  actor: { userId: number; organizationId: number },
): CommitResult {
  const result: CommitResult = { createdRuns: 0, addedStops: 0, refused: [] };

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const lane of lanes) {
      let runId = lane.runId;

      if (runId == null) {
        if (!lane.driverUserId || !lane.day) {
          result.refused.push(`${lane.day || "روز"}: راننده یا تاریخ انتخاب نشده است`);
          continue;
        }
        // Reuses the domain function rather than repeating its checks: createRun is what refuses
        // a manager, and a second INSERT here would happily create the run it exists to prevent.
        try {
          runId = createRun(db, {
            driver_user_id: lane.driverUserId,
            run_date: lane.day,
            created_by: actor.userId,
            organization_id: actor.organizationId,
          });
          result.createdRuns += 1;
        } catch (e) {
          result.refused.push(e instanceof Error ? e.message : "ساخت مسیر انجام نشد");
          continue;
        }
      }

      lane.orderIds.forEach((orderId, i) => {
        try {
          addStop(db, runId!, orderId, i);
          result.addedStops += 1;
        } catch (e) {
          result.refused.push(e instanceof Error ? e.message : "سفارش قرار نگرفت");
        }
      });
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return result;
}