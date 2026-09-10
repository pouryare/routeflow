import type { JourneyKey } from "@/lib/orderJourney";

/** One order's status log (`order_events`), for the vertical spine on /sales/journey.
 *
 *  The spine is the four milestones buildJourney derives from the order's own columns;
 *  these events hang under the milestone they belong to, so a review, a credit hold or a
 *  failed attempt shows up where it happened instead of vanishing into "confirmed". Most
 *  orders carry a single `create` event today, so the milestones stay the backbone and
 *  the log adds detail where there is some.
 *
 *  The reader is readOrderEvents in lib/repo/journey.ts; this file is the pure half. */

export type OrderEventRow = {
  id: number;
  from_status: string | null;
  to_status: string;
  action: string;
  actor_name: string | null;
  note: string | null;
  at: string;
};

/** Which milestone a status belongs under. Gates before confirmation (review, credit,
 *  hold) are part of placing the order; planning and loading are the run; everything on
 *  the road or after it is delivery and settlement. */
export function stepOfStatus(status: string): JourneyKey {
  switch (status) {
    case "CONFIRMED":
      return "confirmed";
    case "PLANNED":
    case "READY":
      return "loaded";
    case "OUT_FOR_DELIVERY":
    case "DELIVERED":
    case "PARTIALLY_DELIVERED":
    case "DELIVERY_FAILED":
    case "CLOSED":
    case "RETURNED":
      return "settled";
    default:
      return "placed";
  }
}

/** The events grouped under their milestone, oldest first within each. */
export function eventsByStep(events: OrderEventRow[]): Record<JourneyKey, OrderEventRow[]> {
  const out: Record<JourneyKey, OrderEventRow[]> = { placed: [], confirmed: [], loaded: [], settled: [] };
  for (const e of events) out[stepOfStatus(e.to_status)].push(e);
  return out;
}
