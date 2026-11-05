import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { requireRole } from "@/lib/session";
import { isInvoiceVia } from "@/lib/invoiceSent";
import { findOwnedStop, stampInvoiceSent } from "@/lib/repo/driverStops";

/** FB38: the driver printed, shared or saved this stop's receipt. Only the run's own driver, and
 *  only the first time counts; a repeat is answered ok and changes nothing. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const raw = (await ctx.params).id;
  if (!isId(raw)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const owned = await findOwnedStop(Number(raw), guard.session.user.id, guard.session.organizationId);
  if (!owned) return NextResponse.json({ ok: false, error: "توقف پیدا نشد" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { via?: unknown } | null;
  if (!isInvoiceVia(body?.via)) return NextResponse.json({ ok: false, error: "روش ارسال معتبر نیست" }, { status: 400 });
  await stampInvoiceSent(owned.order_id, guard.session.organizationId, body.via);
  return NextResponse.json({ ok: true });
}
