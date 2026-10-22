import { getDb, plain } from "@/lib/db";
import { groupFilter, orderFilter, type Session } from "@/lib/session";
import { readOrder, readOrders, type OrderDetail, type OrderSummary } from "@/lib/orders";
import { customerDebtsForOrg } from "@/lib/repo/payments";
import { readOrderDeliveryHistory } from "@/lib/repo/orderDeliveries";
import { readJourney, buildJourney } from "@/lib/orderJourney";
import { eventsByStep } from "@/lib/orderEvents";
import { buildFunnel } from "@/lib/orderFunnel";
import { readOrderEvents, readFunnelRows } from "@/lib/repo/journey";
import { catalogueFor } from "@/lib/repo/sessionReads";

/* What the orders pages read, as functions of the SESSION: the list, the journey, one order's
 * page and the entry form's inputs. The scope (organisation and group) is decided here once per
 * figure; the pages no longer open the database or assemble a scope by hand. */

export interface OrdersList {
  /** The customer the list is narrowed to, when `?customer=` named one the caller may see. */
  focused: { id: number; business_name: string } | null;
  orders: OrderSummary[];
  /** Ids of the listed orders already loaded onto a van (one query for the page, not per row). */
  onARun: Set<number>;
}

/** The newest 100 orders the session can see, optionally narrowed to one visible customer. */
export function ordersListFor(session: Session, opts: { customerId?: number } = {}): OrdersList {
  const db = getDb();
  const scope = groupFilter(session);
  const focused =
    opts.customerId === undefined
      ? null
      : ((db
          .prepare(`SELECT id, business_name FROM customers WHERE id = ?${scope.sql}`)
          .get(opts.customerId, ...scope.params) as { id: number; business_name: string } | undefined) ?? null);

  const orders = readOrders(db, orderFilter(session), { limit: 100, customerId: focused?.id });
  const onARun = new Set(
    (
      plain(
        db
          .prepare(`SELECT DISTINCT order_id FROM delivery_stops WHERE order_id IN (${orders.map(() => "?").join(",") || "NULL"})`)
          .all(...orders.map((o) => o.id))
      ) as unknown as { order_id: number }[]
    ).map((r) => r.order_id)
  );
  return { focused, orders, onARun };
}

export type JourneyData = {
  focus: OrderSummary | undefined;
  journey: ReturnType<typeof readJourney>;
  nodes: ReturnType<typeof buildJourney>;
  events: ReturnType<typeof eventsByStep> | null;
  funnel: ReturnType<typeof buildFunnel> | null;
};

/** «پیگیری»: one order's life, or the funnel of every visible order.
 *
 *  The order to follow is chosen from `orders`, the list this session can already see, so a
 *  journey cannot be used to probe for an order in another group by its id; the funnel uses the
 *  same scope, so it cannot count an order the list hides. */
export function journeyFor(
  session: Session,
  orders: OrderSummary[],
  mode: "one" | "all",
  askedOrderId: number | undefined
): JourneyData {
  const db = getDb();
  const focus = orders.find((o) => o.id === askedOrderId) ?? orders[0];
  const journey = mode === "one" && focus ? readJourney(db, focus.id) : null;
  return {
    focus,
    journey,
    nodes: journey ? buildJourney(journey) : [],
    events: journey && focus ? eventsByStep(readOrderEvents(db, focus.id)) : null,
    funnel: mode === "all" ? buildFunnel(readFunnelRows(db, orderFilter(session))) : null,
  };
}

export interface OrderPage {
  order: OrderDetail;
  attempts: ReturnType<typeof readOrderDeliveryHistory>;
}

/** One order and its delivery attempts, or null when it does not exist OR the session may not see
 *  it. The same scope fragment as the list and the API, so an order in another group is a 404 here
 *  too rather than a page that renders with an error (which would leak the row's existence). */
export function orderPageFor(session: Session, id: number): OrderPage | null {
  const db = getDb();
  const scope = orderFilter(session);
  const visible = db.prepare(`SELECT o.id FROM orders o WHERE o.id = ?${scope.sql}`).get(id, ...scope.params);
  if (!visible) return null;
  const order = readOrder(db, id);
  if (!order) return null;
  return { order, attempts: readOrderDeliveryHistory(db, session.organizationId, order.id) };
}

export interface OrderEntryData {
  customers: { id: number; customer_code: string; business_name: string; phone: string | null; credit_limit_toman: number | null; debt: number }[];
  products: {
    id: number;
    name: string;
    base_unit: string;
    kg_per_base_unit: number;
    packagings: { id: number; name: string; qty_per_pack: number; price_toman: number | null }[];
  }[];
  /** Whom an order can be credited to; empty for a seller, whose orders are always their own. */
  sellers: { id: number; display_name: string }[];
}

/** The inputs of the order entry forms: the customers the caller may reach (with debt), their
 *  organisation's catalogue, and, for managers and owners, the sellers an order can be credited to. */
export function orderEntryFor(session: Session): OrderEntryData {
  const db = getDb();
  const scope = groupFilter(session);
  const debtByCustomer = customerDebtsForOrg(session.organizationId);
  const customers = (
    plain(
      db
        .prepare(
          `SELECT id, customer_code, business_name, phone, credit_limit_toman
             FROM customers
            WHERE 1 = 1${scope.sql}
            ORDER BY business_name`
        )
        .all(...scope.params)
    ) as unknown as Omit<OrderEntryData["customers"][number], "debt">[]
  ).map((c) => ({ ...c, debt: debtByCustomer.get(c.id)?.total ?? 0 }));

  const products = catalogueFor(session).map((product) => ({
    id: product.id,
    name: product.name,
    base_unit: product.base_unit,
    kg_per_base_unit: product.kg_per_base_unit,
    packagings: product.packagings.map((pack) => ({
      id: pack.id,
      name: pack.name,
      qty_per_pack: pack.qty_per_pack,
      price_toman: pack.price_toman,
    })),
  }));

  const sellers =
    session.role === "phone_sales"
      ? []
      : (plain(
          db
            .prepare(
              `SELECT id, display_name FROM users
                WHERE role = 'phone_sales' AND active = 1${scope.sql}
                ORDER BY display_name`
            )
            .all(...scope.params)
        ) as unknown as { id: number; display_name: string }[]);

  return { customers, products, sellers };
}
