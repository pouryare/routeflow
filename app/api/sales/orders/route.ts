import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole, orderFilter, canReachGroup } from "@/lib/session";
import { createOrder, readOrders, productMixFor, OrderError, type LineInput } from "@/lib/orders";
import {
  LeadPromotionError,
  promoteLeadToCustomer,
  unpromoteLead,
  type Promotion,
} from "@/lib/repo/crm/conversion";

/** Who may read and place an order.
 *
 *  A راننده is here because in this app the driver is also the field sales rep, and the
 *  whole point of the lead work is that a sale can be written down at the door rather than
 *  reconstructed from memory later. Reading is safe to open up: `orderFilter` already
 *  scopes a driver to the orders on runs assigned to them, so listing costs them nothing
 *  they should not see.
 *
 *  Worth knowing for the next phase: that scope is runs, not authorship, so an order a
 *  driver places from a lead will not appear in this list until it is on a delivery run.
 *  A van order needs either its own scope rule or a "my orders" read that follows
 *  salesperson_user_id -- deliberately not changed here. */
const CAN_SELL = ["platform_owner", "owner", "group_manager", "phone_sales", "field_rep", "delivery_driver"] as const;

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...CAN_SELL]);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const customerId = url.searchParams.get("customer");
  const status = url.searchParams.get("status");

  const scope = orderFilter(guard.session);
  const orders = readOrders(getDb(), scope, {
    customerId: customerId ? Number(customerId) : undefined,
    status: status ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 200),
  });

  // Additive, and only when a customer is named: what that shop habitually buys is the
  // question the map's customer panel asks, and it is meaningless across all customers.
  const products = customerId
    ? productMixFor(getDb(), scope, Number(customerId))
    : [];

  return NextResponse.json({ ok: true, orders, products });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, [...CAN_SELL]);
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const body = (await req.json().catch(() => null)) as {
    customer_id?: unknown;
    lead_location_id?: unknown;
    order_date?: unknown;
    salesperson_user_id?: unknown;
    notes?: unknown;
    credit_override?: unknown;
    lines?: unknown;
  } | null;

  const orderDate = typeof body?.order_date === "string" ? body.order_date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate) || Number.isNaN(Date.parse(orderDate))) {
    return NextResponse.json({ ok: false, error: "تاریخ سفارش معتبر نیست" }, { status: 400 });
  }

  const lines = Array.isArray(body?.lines) ? (body.lines as LineInput[]) : [];
  if (lines.length === 0) {
    return NextResponse.json({ ok: false, error: "سفارش بدون قلم ثبت نمی‌شود" }, { status: 400 });
  }

  const db = getDb();

  // Rule 1: a lead becomes a customer when it buys. Until this existed, a pin could not
  // receive an order at all -- the route required a customers.id and a lead lives in
  // saved_locations -- so a driver who closed a sale at the door had nowhere to put it.
  //
  // The promotion runs before createOrder, not inside it. createOrder reads the customer for
  // its credit check and then opens its own BEGIN IMMEDIATE, so a customer has to exist
  // first; moving that read inside the transaction would mean restructuring the order core,
  // which also carries commission. So the promotion is its own small step and, if the order
  // then fails, unpromoteLead puts the customer back. That keeps "no customer without a
  // purchase behind it" true without touching how orders are written.
  const leadLocationId = body?.lead_location_id == null ? null : Number(body.lead_location_id);
  let promotion: Promotion | null = null;
  if (leadLocationId !== null) {
    if (!Number.isInteger(leadLocationId)) {
      return NextResponse.json({ ok: false, error: "شناسه مکان نامعتبر است" }, { status: 400 });
    }
    try {
      promotion = promoteLeadToCustomer(session.organizationId, leadLocationId, session);
    } catch (e) {
      if (e instanceof LeadPromotionError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
      }
      throw e;
    }
  }

  const customer = db
    .prepare("SELECT id, group_id FROM customers WHERE id = ?")
    .get(promotion ? promotion.customerId : Number(body?.customer_id)) as { id: number; group_id: number | null } | undefined;

  // 404 rather than 403 for a customer in another group -- a 403 would confirm the row
  // exists, which is the thing being withheld. Same rule as everywhere else here.
  if (!customer || !canReachGroup(session, customer.group_id)) {
    if (promotion) unpromoteLead(session.organizationId, promotion);
    return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  }

  // A فروشنده's order is always credited to them. Commission is paid off this column,
  // so letting the request name someone else would be a way to move money.
  const salespersonId =
    session.role === "phone_sales"
      ? session.user.id
      : body?.salesperson_user_id === undefined || body?.salesperson_user_id === null
        ? null
        : Number(body.salesperson_user_id);

  try {
    const order = createOrder(db, {
      customer_id: customer.id,
      order_date: orderDate,
      created_by: session.user.id,
      organization_id: session.user.organization_id,
      salesperson_user_id: salespersonId,
      credit_override_by: body?.credit_override ? session.user.id : null,
      notes: typeof body?.notes === "string" ? body.notes : null,
      lines: lines.map((line) => ({
        product_id: Number(line.product_id),
        packaging_id: Number(line.packaging_id),
        packs: Number(line.packs),
      })),
    });
    return NextResponse.json({
      ok: true,
      ...order,
      // Echoed back so the caller can tell a fresh promotion from one that already existed,
      // and can refresh the pin instead of adding a second copy of it to the pool.
      ...(promotion ? { customerId: promotion.customerId, promotedFromLead: true, leadCreated: promotion.created } : {}),
    }, { status: 201 });
  } catch (e) {
    // The promotion outlived the order, which would leave a customer who never bought --
    // exactly what rule 1 forbids. Put it back before reporting the failure.
    if (promotion) unpromoteLead(session.organizationId, promotion);
    if (e instanceof OrderError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    throw e;
  }
}
