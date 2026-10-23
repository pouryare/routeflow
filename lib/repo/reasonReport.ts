import { getDb } from "@/lib/db";
import { orderFilter } from "@/lib/session";
import type { Session } from "@/lib/session";
import type { ReasonDomain } from "./reasonCodes";
import { orderFiguresOf } from "./orderFigures";
import type { LineSnapshot } from "../orderMath";

/** F144, first slice: why orders failed, were cancelled, came back or ran late, counted by
 *  reason over a recent window.
 *
 *  Failures, cancellations and returns are read from the order's history (`order_events`),
 *  which is where the action sheet stores the reason; a delay is read from the delivery's
 *  `delay_reason_id`. Counting the delivery's `fail_reason_id` as well would count a failed
 *  delivery twice, once per table.
 *
 *  An event with no reason is counted as its own row, «بدون دلیل», rather than dropped: a
 *  report that only shows the reasons people chose looks more certain than the data is. */

const REASON_DOMAINS: readonly ReasonDomain[] = ["delivery_fail", "order_cancel", "order_return", "delivery_delay"];

/** The order status each reasoned action lands in, so an event with no reason still finds
 *  its area. */
const STATUS_DOMAIN: Record<string, ReasonDomain> = {
  DELIVERY_FAILED: "delivery_fail",
  CANCELLED: "order_cancel",
  RETURNED: "order_return",
};

export interface ReasonEvent {
  domain: ReasonDomain;
  /** Null when nobody chose a reason. */
  reasonLabel: string | null;
  orderId: number;
  valueToman: number;
}

interface ReasonRow {
  label: string | null;
  count: number;
  valueToman: number;
  /** Share of this area's events, 0..1. */
  share: number;
}

export interface ReasonArea {
  domain: ReasonDomain;
  total: number;
  valueToman: number;
  /** How many events carry no reason. */
  unexplained: number;
  rows: ReasonRow[];
}

/** Group events into one area per domain, each sorted by count (then value). An order counts
 *  once per event: an order cancelled, restored and cancelled again is two cancellations. */
export function foldReasons(events: readonly ReasonEvent[]): ReasonArea[] {
  return REASON_DOMAINS.map((domain) => {
    const mine = events.filter((e) => e.domain === domain);
    const byLabel = new Map<string | null, { count: number; valueToman: number }>();
    for (const e of mine) {
      const cur = byLabel.get(e.reasonLabel) ?? { count: 0, valueToman: 0 };
      cur.count += 1;
      cur.valueToman += e.valueToman;
      byLabel.set(e.reasonLabel, cur);
    }
    const total = mine.length;
    const rows = [...byLabel.entries()]
      .map(([label, v]) => ({ label, ...v, share: total ? v.count / total : 0 }))
      .sort((a, b) => b.count - a.count || b.valueToman - a.valueToman);
    return {
      domain,
      total,
      valueToman: mine.reduce((s, e) => s + e.valueToman, 0),
      unexplained: byLabel.get(null)?.count ?? 0,
      rows,
    };
  });
}

const LINE_COLUMNS = `order_id, packs_ordered, packs_delivered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit`;

/** Every reasoned event in the window this session may see. `days` counts back from `now`. */
function reasonEvents(session: Session, days: number, now: Date = new Date()): ReasonEvent[] {
  const db = getDb();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const scope = orderFilter(session, "o");
  const statuses = Object.keys(STATUS_DOMAIN);

  const fromHistory = db
    .prepare(
      `SELECT e.to_status, rc.domain, rc.label_fa, o.id AS order_id, o.total_toman
         FROM order_events e
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN reason_codes rc ON rc.id = e.reason_code_id
        WHERE e.organization_id = ? AND e.created_at >= ?
          AND e.to_status IN (${statuses.map(() => "?").join(", ")})${scope.sql}`
    )
    .all(session.organizationId, since, ...statuses, ...scope.params) as unknown as Array<{
    to_status: string;
    domain: ReasonDomain | null;
    label_fa: string | null;
    order_id: number;
    total_toman: number | null;
  }>;

  const delays = db
    .prepare(
      `SELECT rc.label_fa, o.id AS order_id, o.total_toman
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         JOIN reason_codes rc ON rc.id = d.delay_reason_id
        WHERE d.organization_id = ? AND COALESCE(d.completed_at, d.created_at) >= ?${scope.sql}`
    )
    .all(session.organizationId, since, ...scope.params) as unknown as Array<{
    label_fa: string;
    order_id: number;
    total_toman: number | null;
  }>;

  // A stored total is a cache that a line edit empties; work those few out from the lines.
  const missing = [...new Set([...fromHistory, ...delays].filter((r) => r.total_toman === null).map((r) => r.order_id))];
  const computed = new Map<number, number>();
  if (missing.length) {
    const lines = db
      .prepare(`SELECT ${LINE_COLUMNS} FROM order_lines WHERE order_id IN (${missing.map(() => "?").join(", ")}) ORDER BY id`)
      .all(...missing) as unknown as Array<LineSnapshot & { order_id: number }>;
    for (const id of missing) computed.set(id, orderFiguresOf(lines.filter((l) => l.order_id === id)).total_toman);
  }
  const valueOf = (r: { order_id: number; total_toman: number | null }) => r.total_toman ?? computed.get(r.order_id) ?? 0;

  return [
    ...fromHistory.map((r) => ({
      // The reason's own domain wins; a reason-less event falls back to the status it reached.
      domain: r.domain ?? STATUS_DOMAIN[r.to_status],
      reasonLabel: r.label_fa,
      orderId: r.order_id,
      valueToman: valueOf(r),
    })),
    ...delays.map((r) => ({
      domain: "delivery_delay" as const,
      reasonLabel: r.label_fa,
      orderId: r.order_id,
      valueToman: valueOf(r),
    })),
  ];
}

export function reasonReport(session: Session, days: number, now?: Date): ReasonArea[] {
  return foldReasons(reasonEvents(session, days, now));
}
