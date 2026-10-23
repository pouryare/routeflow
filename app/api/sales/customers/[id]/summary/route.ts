import { NextRequest, NextResponse } from "next/server";
import { requireRole, orderFilter, groupFilter } from "@/lib/session";
import { customerVisible } from "@/lib/repo/ordersAccess";
import { customerSummaryIn } from "@/lib/repo/routeAdapters";

const CAN_SEE = ["platform_owner", "owner", "group_manager", "phone_sales"] as const;

/** What the customer sheet reads.
 *
 *  No new authorisation surface: visibility is decided by the same two scope fragments
 *  the rest of the app uses -- groupFilter for whether this customer may be seen at all,
 *  orderFilter for which orders count toward the figures. A customer outside the caller's
 *  group is indistinguishable from one that does not exist, so this cannot be used to
 *  probe for ids.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(req, [...CAN_SEE]);
  if (!guard.ok) return guard.response;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ ok: false, error: "شناسه معتبر نیست" }, { status: 400 });
  }

  const visible = await customerVisible(await groupFilter(guard.session), id);
  if (!visible) {
    return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  }

  const summary = await customerSummaryIn(orderFilter(guard.session), id);
  if (!summary) {
    return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, summary });
}
