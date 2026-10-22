import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole, orderFilter, orgScopeId } from "@/lib/session";
import { orderVisible } from "@/lib/repo/ordersAccess";
import { packagingOfProduct, productInOrg } from "@/lib/repo/catalogueAdmin";
import { readOrder, confirmOrder, addLine, OrderError } from "@/lib/orders";

/* Was ["owner","group_manager","phone_sales"] — NARROWER than its twin in orders/route.ts,
 * which admits both van roles. So a van role could create an order and then be refused
 * reading it back. Pre-existing bug, found by the sweep; both now carry the same roles. */
const CAN_SELL = ["platform_owner", "owner", "group_manager", "phone_sales", "field_rep", "delivery_driver"] as const;

/** Whether this session may see this order at all.
 *
 *  Answered by running the caller's own scope fragment against the single row, rather
 *  than by re-deriving the rule here. One definition of who-sees-what (orderFilter) that
 *  the list and the detail both go through means the two cannot drift -- the classic
 *  version of this bug is a list that hides a row and a detail page that shows it.
 */
function visible(session: Parameters<typeof orderFilter>[0], orderId: number): boolean {
  return orderVisible(orderFilter(session), orderId);
}

/* A function, not a module-level response: a Response body can be read once, so the second request
   to reach this answer got an empty body. */
const notFound = () => NextResponse.json({ ok: false, error: "سفارش پیدا نشد" }, { status: 404 });

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, [...CAN_SELL]);
  if (!guard.ok) return guard.response;

  const id = Number((await ctx.params).id);
  if (!visible(guard.session, id)) return notFound();

  const order = readOrder(getDb(), id);
  if (!order) return notFound();
  return NextResponse.json({ ok: true, order });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, [...CAN_SELL]);
  if (!guard.ok) return guard.response;

  const id = Number((await ctx.params).id);
  // Checked before anything is read or written, so an order in another group is
  // indistinguishable from one that does not exist -- including on a failed confirm,
  // where a 400 would otherwise confirm it is real.
  if (!visible(guard.session, id)) return notFound();

  const body = (await req.json().catch(() => null)) as {
    status?: unknown;
    line?: unknown;
  } | null;

  try {
    if (body?.status === "confirmed") {
      confirmOrder(getDb(), id);
      return NextResponse.json({ ok: true });
    }

    if (body?.line && typeof body.line === "object") {
      const line = body.line as { product_id: number; packaging_id: number; packs: number };
      // The product (and its packaging) must be this company's: an id alone reaches every tenant's catalogue.
      if (!productInOrg(Number(line.product_id), orgScopeId(guard.session)) || !packagingOfProduct(Number(line.packaging_id), Number(line.product_id))) {
        return NextResponse.json({ ok: false, error: "کالا یا بسته‌بندی پیدا نشد" }, { status: 400 });
      }
      addLine(getDb(), id, {
        product_id: Number(line.product_id),
        packaging_id: Number(line.packaging_id),
        packs: Number(line.packs),
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "تغییری مشخص نشده" }, { status: 400 });
  } catch (e) {
    if (e instanceof OrderError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    throw e;
  }
}
