import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { repHealth } from "@/lib/repo/repHealth";
import { repsRepo, listOnboarding } from "@/lib/repo/representatives";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/reps/[id]">) {
  const guard = requireRole(req, [...MANAGE_ROLES, "rep_manager"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const rep = repsRepo.get(guard.session.organizationId, Number(id));
  if (!rep) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    rep,
    health: repHealth(guard.session.organizationId, Number(id)),
    onboarding: listOnboarding(guard.session.organizationId, Number(id)),
  });
}
