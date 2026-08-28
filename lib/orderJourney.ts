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
  /** Where the order actually IS. Exactly one node is "current": the first thing not yet
   *  done. Without it every unfinished step looks equally pending and the screen answers
   *  "what has happened" but never "what is it waiting on", which is the question anyone
   *  opening this page is actually asking. */
  state: "done" | "current" | "todo";
  /** ISO date, or null when the step has not happened or carries no timestamp. */
  at: string | null;
  /** The person the step belongs to, when the schema records one. */
  person: string | null;
  /** What that person's role is at this step — «فروشنده», «راننده». */
  role: string;
  /** What this step MEANS, in a sentence. The lane titles are jargon to anyone who did
   *  not build the thing. */
  what: string;
  /** The concrete fact this step produced, or what it is waiting for. */
  note: string | null;
}

export interface JourneyInput {
  order_no: string;
  customer_name: string;
  kg: number;
  line_count: number;
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
  const owed = Math.max(0, o.total_toman - o.paid_toman);

  const base: Omit<JourneyNode, "state">[] = [
    {
      key: "placed",
      label: "ثبت سفارش",
      done: true,
      at: o.order_date,
      person: o.created_by_name,
      role: "ثبت‌کننده",
      what: "مشتری سفارش داد و اقلام و مقدارها وارد سیستم شد.",
      note: `${TOMAN(o.line_count)} قلم · ${TOMAN(Math.round(o.kg))} کیلو`,
    },
    {
      key: "confirmed",
      label: "تأیید و قیمت‌گذاری",
      done: confirmed,
      at: null,
      person: o.salesperson_name,
      role: "فروشنده",
      what: "قیمت روز روی سفارش قفل می‌شود. بعد از این، اقلام و قیمت‌ها دیگر ویرایش نمی‌شوند.",
      note: confirmed
        ? `قیمت‌ها قفل شد · ${TOMAN(o.total_toman)} تومان`
        : cancelled
          ? "سفارش لغو شد"
          : "منتظر تأیید — تا تأیید نشود روی هیچ مسیری نمی‌رود",
    },
    {
      key: "loaded",
      label: "بارگیری و مسیر",
      done: o.run !== null,
      at: o.run?.date ?? null,
      person: o.run?.driver_name ?? null,
      role: "راننده",
      what: "سفارش روی یک مسیر تحویل چیده می‌شود تا راننده ببرد.",
      note: o.run
        ? `روی مسیر ${o.run.driver_name ?? "بدون راننده"}`
        : confirmed
          ? "هنوز روی هیچ مسیری نیست — از صفحهٔ «مسیر تحویل» اضافه شود"
          : "اول باید تأیید شود",
    },
    {
      key: "settled",
      label: "تحویل و تسویه",
      done: delivered,
      at: o.delivered_at,
      person: o.delivered_by_name,
      role: "راننده",
      what: "راننده کالا را دم در تحویل می‌دهد و همان‌جا وجه را می‌گیرد. مبلغ دریافتی فقط از همین‌جا ثبت می‌شود.",
      note: delivered
        ? owed > 0
          ? `${TOMAN(o.paid_toman)} از ${TOMAN(o.total_toman)} گرفته شد · ${TOMAN(owed)} تومان مانده`
          : `${TOMAN(o.paid_toman)} تومان تسویه شد`
        : "هنوز تحویل نشده",
    },
  ];

  /* Exactly one "current": the first step not yet done. Everything after it is "todo",
     which is what lets the screen say where the order is stuck rather than only what has
     already happened. */
  const firstOpen = base.findIndex((n) => !n.done);
  return base.map((n, i) => ({
    ...n,
    state: n.done ? "done" : i === firstOpen ? "current" : "todo",
  }));
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
    order_no: order.order_no,
    customer_name: order.customer_name,
    kg: order.kg,
    line_count: order.lines.length,
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
