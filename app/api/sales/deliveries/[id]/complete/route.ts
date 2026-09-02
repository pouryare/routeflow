import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { completeDelivery, DeliveryError } from "@/lib/delivery";
import { readDelivery } from "@/lib/repo/deliveries";

/** The door event. The server owns actual_arrival / completed_at -- a `device_time` in
 *  the body is stored beside them, never used as the time. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/sales/deliveries/[id]/complete">) {
  const guard = requireRole(req, ["owner", "group_manager", "driver"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!readDelivery(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    outcome?: "delivered" | "partial" | "failed";
    lines?: { order_line_id: number; qty_delivered: number }[];
    fail_reason_id?: number | null;
    receiver_name?: string | null;
    gps_lat?: number | null;
    gps_lng?: number | null;
    collected_toman?: number;
    device_time?: string | null;
    notes?: string | null;
  } | null;
  if (!body?.outcome || !["delivered", "partial", "failed"].includes(body.outcome)) {
    return NextResponse.json({ ok: false, error: "نتیجهٔ تحویل نامعتبر است" }, { status: 400 });
  }

  try {
    completeDelivery(
      guard.session.organizationId,
      Number(id),
      { id: guard.session.user.id },
      {
        outcome: body.outcome,
        lines: body.lines,
        fail_reason_id: body.fail_reason_id ?? null,
        receiver_name: body.receiver_name ?? null,
        gps_lat: body.gps_lat ?? null,
        gps_lng: body.gps_lng ?? null,
        collected_toman: body.collected_toman ?? 0,
        device_time: body.device_time ?? null,
        notes: body.notes ?? null,
      }
    );
    return NextResponse.json({
      ok: true,
      delivery: readDelivery(guard.session.organizationId, Number(id)),
    });
  } catch (e) {
    if (e instanceof DeliveryError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
