import type { OrderStatus } from "@/lib/orderStateMachine";

/** «همه سفارش‌ها» on /sales/journey: where do orders stall?
 *
 *  Spec D5. The single-order spine answers "what happened to THIS order"; this answers the
 *  manager's question across all of them, as a funnel with drop-off along the main path.
 *
 *  **Reached is a rank, not an event.** The event log is thin: most orders carry a single
 *  `create` event that lands straight on their current status (43 of 45 in production on
 *  2026-09-10, many of them DELIVERED). Counting only statuses an event names would show
 *  orders "delivered" without ever having been confirmed. So each status has a rank on the
 *  main path, an order's furthest rank is the highest it has held (now or in any event),
 *  and it has reached every stage at or below that rank. An order cannot be delivered
 *  without having been confirmed; the funnel says so even when the log does not. */

export type FunnelKey = "placed" | "confirmed" | "planned" | "ready" | "out" | "delivered" | "closed";

export const FUNNEL_STAGES: readonly { key: FunnelKey; label: string }[] = [
  { key: "placed", label: "ثبت" },
  { key: "confirmed", label: "تأیید" },
  { key: "planned", label: "برنامه‌ریزی" },
  { key: "ready", label: "آمادهٔ ارسال" },
  { key: "out", label: "در مسیر" },
  { key: "delivered", label: "تحویل" },
  { key: "closed", label: "تسویه و بستن" },
];

/** Where each status sits on the main path. Every pre-confirmation status is stage 0:
 *  review, credit and hold are gates before confirmation, not steps after it. A failed
 *  delivery reached the road. RETURNED was delivered first. CANCELLED has no rank of its
 *  own: a cancelled order is placed at the furthest stage it held before. */
const RANK: Record<OrderStatus, number | null> = {
  DRAFT: 0,
  PENDING_REVIEW: 0,
  PENDING_CREDIT: 0,
  ON_HOLD: 0,
  CONFIRMED: 1,
  PLANNED: 2,
  READY: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERY_FAILED: 4,
  DELIVERED: 5,
  PARTIALLY_DELIVERED: 5,
  CLOSED: 6,
  RETURNED: 5,
  CANCELLED: null,
};

/** Orders that left the path. They count as having reached their furthest stage and are
 *  reported as exits there, not as waiting. */
const EXITS: ReadonlySet<string> = new Set(["CANCELLED", "RETURNED", "DELIVERY_FAILED"]);

export type FunnelRow = { status: string; seen: string[] };

export type FunnelStage = {
  key: FunnelKey;
  label: string;
  /** Orders that got at least this far. */
  reached: number;
  /** Live orders sitting at this stage right now: the stall. */
  waiting: number;
  /** Orders that left the path here (cancelled, returned, failed). */
  exited: number;
  /** Share of the previous stage's orders that did not get this far, 0..1. Null for the
   *  first stage, and when the previous stage had no orders to lose. */
  drop: number | null;
};

const rankOf = (s: string): number | null => (s in RANK ? RANK[s as OrderStatus] : null);

export function buildFunnel(rows: FunnelRow[]): FunnelStage[] {
  const last = FUNNEL_STAGES.length - 1;
  const reached = new Array<number>(FUNNEL_STAGES.length).fill(0);
  const waiting = new Array<number>(FUNNEL_STAGES.length).fill(0);
  const exited = new Array<number>(FUNNEL_STAGES.length).fill(0);

  for (const row of rows) {
    const ranks = [row.status, ...row.seen].map(rankOf).filter((r): r is number => r !== null);
    const furthest = ranks.length ? Math.max(...ranks) : 0;
    for (let k = 0; k <= furthest; k++) reached[k] += 1;
    if (EXITS.has(row.status)) exited[furthest] += 1;
    else if (furthest < last) waiting[furthest] += 1;
  }

  return FUNNEL_STAGES.map((s, k) => ({
    ...s,
    reached: reached[k],
    waiting: waiting[k],
    exited: exited[k],
    drop: k === 0 || reached[k - 1] === 0 ? null : 1 - reached[k] / reached[k - 1],
  }));
}
