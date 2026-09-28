import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { applyDriverVisit } from "@/lib/repo/crm/driverVisits";
import { crmErrorResponse, idParam } from "@/lib/repo/crm/http";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/crm/driver-visits/[taskId]">) {
  const guard = requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const taskId = idParam((await ctx.params).taskId);
  if (taskId === null) return NextResponse.json({ ok: false, error: "بازدید پیدا نشد" }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { answers?: unknown; pos?: { lat: number; lng: number; accuracy: number }; client_uuid?: string } | null;
  try {
    applyDriverVisit(guard.session, taskId, { answers: (b?.answers ?? []) as never, pos: b?.pos ?? null, clientUuid: b?.client_uuid ?? null });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return crmErrorResponse(e);
  }
}
