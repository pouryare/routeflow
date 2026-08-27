import type { DatabaseSync } from "node:sqlite";
import { plain } from "./db";
import { readOrder } from "./orders";

/** The lifecycle of one order, as four steps that already exist in the schema.
 *
 *  Every node is DERIVED from a real column -- created_at, status, a delivery_stops row,
 *  delivered_at. None of them is a checkbox somebody ticks: a journey whose ticks can be
 *  set by hand is a second, contradictory record of whether the goods went out, and the
 *  first thing it would do is disagree with the invoice.
 *
 *  That is also why "تأیید" carries no timestamp of its own. The orders table has
 *  created_at and delivered_at and no confirmed_at, and inventing one from updated_at
 *  would put a date on the screen that moves every time anybody edits a note.
 */
export type JourneyKey = "placed" | "confirmed" | "loaded" | "settled";

export interface JourneyNode {
  key: JourneyKey;
  label: string;
  done: boolean;
  /** ISO date, or null when the step has not happened or carries no timestamp. */
  at: string | null;
  /** The person the step belongs to, when the schema records one. */
  person: string | null;
  note: string | null;
}

export interface JourneyInput {
  status: string;
  created_at: string;
  order_date: string;
  created_by_name: string | null;
  salesperson_name: string | null;
  /** The run this order was loaded onto, if any. */
  run: { date: string; driver_name: string | null } | null;
  delivered_at: string | null;
  delivered_by_name: string | null;
  total_toman: number;
  paid_toman: number;
  payment_status: string;
}

const TOMAN = (n: number) => new Intl.NumberFormat("fa-IR").format(n);

export function buildJourney(o: JourneyInput): JourneyNode[] {
  const cancelled = o.status === "cancelled";
  const confirmed = o.status === "confirmed" || o.status === "delivered";
  const delivered = o.status === "delivered" && o.delivered_at !== null;

  return [
    {
      key: "placed",
      label: "ثبت سفارش",
      done: true,
      at: o.order_date,
      person: o.created_by_name,
      note: null,
    },
    {
      key: "confirmed",
      label: "تأیید و قیمت‌گذاری",
      done: confirmed,
      at: null,
      person: o.salesperson_name,
      note: confirmed ? "قیمت‌ها قفل شد" : cancelled ? "سفارش لغو شد" : "در انتظار تأیید",
    },
    {
      key: "loaded",
      label: "بارگیری و مسیر",
      done: o.run !== null,
      at: o.run?.date ?? null,
      person: o.run?.driver_name ?? null,
      note: o.run ? null : "هنوز روی هیچ مسیری نیست",
    },
    {
      key: "settled",
      label: "تحویل و تسویه",
      done: delivered,
      at: o.delivered_at,
      person: o.delivered_by_name,
      note: delivered
        ? `${TOMAN(o.paid_toman)} از ${TOMAN(o.total_toman)} تومان وصول شد`
        : o.payment_status === "unpaid"
          ? "پرداخت‌نشده"
          : null,
    },
  ];
}

/** Gathers the rows `buildJourney` needs for one order.
 *
 *  Visibility is NOT decided here. Callers hand over an order they have already been
 *  shown -- the same arrangement readOrders has, so there is one definition of
 *  who-sees-what and a detail view cannot show a row its own list hides.
 */
export function readJourney(db: DatabaseSync, orderId: number): JourneyInput | null {
  const order = readOrder(db, orderId);
  if (!order) return null;

  const extra = plain(
    db
      .prepare(
        `SELECT cb.display_name AS created_by_name,
                r.run_date      AS run_date,
                dv.display_name AS driver_name,
                db_.display_name AS delivered_by_name
           FROM orders o
           LEFT JOIN users cb ON cb.id = o.created_by
           LEFT JOIN delivery_stops s ON s.order_id = o.id
           LEFT JOIN delivery_runs r ON r.id = s.run_id
           LEFT JOIN users dv ON dv.id = r.driver_user_id
           LEFT JOIN users db_ ON db_.id = s.delivered_by
          WHERE o.id = ?
          ORDER BY s.id DESC
          LIMIT 1`
      )
      .all(orderId)
  )[0] as
    | {
        created_by_name: string | null;
        run_date: string | null;
        driver_name: string | null;
        delivered_by_name: string | null;
      }
    | undefined;

  return {
    status: order.status,
    created_at: order.created_at,
    order_date: order.order_date,
    created_by_name: extra?.created_by_name ?? null,
    salesperson_name: order.salesperson_name,
    run: extra?.run_date ? { date: extra.run_date, driver_name: extra.driver_name } : null,
    delivered_at: order.delivered_at,
    delivered_by_name: extra?.delivered_by_name ?? null,
    total_toman: order.total_toman,
    paid_toman: order.paid_toman,
    payment_status: order.payment_status,
  };
}
