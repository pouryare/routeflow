import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole, orderFilter, canReachGroup } from "@/lib/session";
import { createOrder, readOrders, productMixFor, OrderError, type LineInput } from "@/lib/orders";

const CAN_SELL = ["owner", "group_manager", "salesperson"] as const;

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
  const customer = db
    .prepare("SELECT id, group_id FROM customers WHERE id = ?")
    .get(Number(body?.customer_id)) as { id: number; group_id: number | null } | undefined;

  // 404 rather than 403 for a customer in another group -- a 403 would confirm the row
  // exists, which is the thing being withheld. Same rule as everywhere else here.
  if (!customer || !canReachGroup(session, customer.group_id)) {
    return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  }

  // A فروشنده's order is always credited to them. Commission is paid off this column,
  // so letting the request name someone else would be a way to move money.
  const salespersonId =
    session.role === "salesperson"
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
    return NextResponse.json({ ok: true, ...order }, { status: 201 });
  } catch (e) {
    if (e instanceof OrderError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    throw e;
  }
}
