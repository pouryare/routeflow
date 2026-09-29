import { redirect } from "next/navigation";

/** /sales/deliveries is gone, and its content went in two directions.
 *
 *  `deliveries` is keyed by order_id + seq: it is the history of attempts on ONE order --
 *  status, planned vs actual arrival, fail and delay reasons, receiver, signature, photo,
 *  GPS. That belongs on the order, and the order's own page now carries it.
 *
 *  The cross-order exception queue does NOT move here. It already exists, as the `retry`
 *  panel on the /today briefing, and it answers a different question -- "what needs
 *  attention today" rather than "what happened to this one". Splitting it this way is the
 *  point: one order's history on the order, today's queue on the day. */
export default function DeliveriesPage() {
  redirect("/sales/orders");
}
