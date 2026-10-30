import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { requireRole } from "@/lib/session";
import { repHealth } from "@/lib/repo/repHealth";
import { repsRepo, listOnboarding } from "@/lib/repo/representatives";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/reps/[id]">) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "rep_manager"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const rep = await repsRepo.get(guard.session.organizationId, Number(id));
  if (!rep) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    rep,
    health: await repHealth(guard.session.organizationId, Number(id)),
    onboarding: await listOnboarding(guard.session.organizationId, Number(id)),
  });
}
