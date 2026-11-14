import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { ClaimError, decideClaim } from "@/lib/repo/expenseClaims";

/** Approve or reject one claim. Who may decide which claim (own group, the limit, never one's own) is `canDecideClaim`, checked in `decideClaim`. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/expense-claims/[id]">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const id = Number((await ctx.params).id);
  const b = (await req.json().catch(() => null)) as { action?: unknown; reason?: unknown } | null;
  if (!Number.isInteger(id) || (b?.action !== "approve" && b?.action !== "reject")) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  try {
    const status = await decideClaim(
      { role: guard.session.role, organizationId: guard.session.organizationId, userId: guard.session.user.id, groupId: guard.session.groupId },
      id,
      b.action,
      typeof b.reason === "string" ? b.reason : null,
    );
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    if (e instanceof ClaimError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
