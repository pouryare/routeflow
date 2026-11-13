import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { decideChange, ChangeRequestError } from "@/lib/repo/changeRequests";
import { guardStepUp } from "@/lib/repo/stepUp";

/** F48: the owner approves or rejects a waiting change { verdict, note? }. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/change-requests/[id]/decide">) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const stepUp = await guardStepUp(req, guard.session, "credit_limit");
  if (stepUp) return stepUp;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { verdict?: unknown; note?: unknown } | null;
  if (!isId(id) || (b?.verdict !== "approved" && b?.verdict !== "rejected") || (b.note !== undefined && typeof b.note !== "string")) {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  }
  try {
    await decideChange(guard.session.organizationId, Number(id), b.verdict, guard.session.user.id, (b.note as string | undefined) ?? "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ChangeRequestError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
