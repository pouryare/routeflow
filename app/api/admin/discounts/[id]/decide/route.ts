import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { decideDiscount, DiscountError } from "@/lib/repo/discounts";
import { MANAGE_ROLES } from "@/lib/roles";

/** The manager's or owner's answer to a discount. Who may answer which one (own group, never your
 *  own, a group manager's goes to the owner) is decided in lib/discounts.ts and enforced by the
 *  repo, so a card that is not theirs answers 409 here rather than doing anything. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/discounts/[id]/decide">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { verdict?: unknown; note?: unknown } | null;
  if (body?.verdict !== "approved" && body?.verdict !== "rejected") {
    return NextResponse.json({ ok: false, error: "تصمیم نامعتبر است" }, { status: 400 });
  }
  const session = guard.session;
  try {
    const row = await decideDiscount(
      session.organizationId,
      Number(id),
      body.verdict,
      { id: session.user.id, role: session.role, group_id: session.groupId },
      typeof body.note === "string" ? body.note.slice(0, 300) : null
    );
    return NextResponse.json({ ok: true, status: row.status });
  } catch (e) {
    if (e instanceof DiscountError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
