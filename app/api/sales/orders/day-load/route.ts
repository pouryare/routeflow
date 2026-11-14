import { NextRequest, NextResponse } from "next/server";
import { SELL_ROLES } from "@/lib/roles";
import { requireRole } from "@/lib/session";
import { dayTaken } from "@/lib/repo/dayCapacity";
import { thresholdsFor } from "@/lib/repo/thresholds";

/** FB35: GET ?day=YYYY-MM-DD answers { limit, taken }; limit 0 means the company has no limit. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, SELL_ROLES);
  if (!guard.ok) return guard.response;
  const day = req.nextUrl.searchParams.get("day") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ ok: false, error: "روز نامعتبر است" }, { status: 400 });
  const { day_order_limit } = await thresholdsFor(guard.session.organizationId);
  return NextResponse.json({ ok: true, limit: day_order_limit, taken: day_order_limit > 0 ? await dayTaken(guard.session.organizationId, day) : 0 });
}
