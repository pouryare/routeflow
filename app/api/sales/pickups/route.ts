import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { addPickup } from "@/lib/repo/pickups";

/** F118: { run_id, facility_id, purchase_order_id? } sends the run's driver to collect goods at a place. Managers only. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { run_id?: unknown; facility_id?: unknown; purchase_order_id?: unknown } | null;
  if (typeof b?.run_id !== "number" || typeof b.facility_id !== "number" || (b.purchase_order_id != null && typeof b.purchase_order_id !== "number")) {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  }
  const refused = await addPickup(guard.session.organizationId, b.run_id, b.facility_id, (b.purchase_order_id as number | null | undefined) ?? null);
  return refused ? NextResponse.json({ ok: false, error: refused }, { status: 400 }) : NextResponse.json({ ok: true });
}
