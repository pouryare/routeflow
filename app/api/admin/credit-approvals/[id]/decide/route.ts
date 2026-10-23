import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { decide, CreditApprovalError } from "@/lib/repo/creditApprovals";
import { MANAGE_ROLES } from "@/lib/roles";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/credit-approvals/[id]/decide">
) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    verdict?: "approved" | "rejected";
    reason?: string;
  } | null;
  if (body?.verdict !== "approved" && body?.verdict !== "rejected") {
    return NextResponse.json({ ok: false, error: "تصمیم نامعتبر است" }, { status: 400 });
  }

  try {
    await decide(guard.session.organizationId, Number(id), body.verdict, guard.session.user.id, body.reason);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof CreditApprovalError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
