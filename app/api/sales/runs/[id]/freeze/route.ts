import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { freezeRun, RoutingError } from "@/lib/repo/routing";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/sales/runs/[id]/freeze">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  try {
    freezeRun(guard.session.organizationId, Number(id), {
      id: guard.session.user.id,
      role: guard.session.role === "owner" ? "owner" : "group_manager",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RoutingError) return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    throw e;
  }
}
