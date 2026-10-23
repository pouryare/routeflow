import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { buildPlan } from "@/lib/repo/routing";
import { MANAGE_ROLES } from "@/lib/roles";
import { isDayWithin } from "@/lib/inputChecks";

/** Build a delivery-route proposal for a date. Read-only. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as {
    date?: string;
    group_id?: number | null;
    template_id?: number | null;
  } | null;
  if (!b?.date) return NextResponse.json({ ok: false, error: "تاریخ لازم است" }, { status: 400 });
  // A route is planned for a real day close to today; "zzz", 1900 and 2999 were all planned.
  if (!isDayWithin(b.date, 30, 120)) {
    return NextResponse.json({ ok: false, error: "تاریخ مسیر معتبر نیست" }, { status: 400 });
  }
  const plan = await buildPlan(guard.session.organizationId, {
    date: b.date.slice(0, 10),
    group_id: b.group_id ?? null,
    template_id: b.template_id ?? null,
  });
  return NextResponse.json({ ok: true, plan });
}
