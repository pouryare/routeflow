import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { freezeRun, RoutingError } from "@/lib/repo/routing";
import { MANAGE_ROLES, isOwner } from "@/lib/roles";


export async function POST(req: NextRequest, ctx: RouteContext<"/api/sales/runs/[id]/freeze">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  try {
    await freezeRun(guard.session.organizationId, Number(id), {
      id: guard.session.user.id,
      role: isOwner(guard.session.role) ? "owner" : "group_manager",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RoutingError) return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    throw e;
  }
}
