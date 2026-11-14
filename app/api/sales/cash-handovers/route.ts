import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { confirmHandover, HandoverError } from "@/lib/repo/cashInHand";

/** D1: { holder, through, counted, reason? } the office confirms the cash it counted from one person. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { holder?: unknown; through?: unknown; counted?: unknown; reason?: unknown } | null;
  if (!Number.isSafeInteger(b?.holder) || typeof b?.through !== "string" || b.through.length > 40 || !Number.isSafeInteger(b.counted) || (b.counted as number) < 0 || (b.reason !== undefined && typeof b.reason !== "string")) {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  }
  try {
    await confirmHandover(guard.session.organizationId, b.holder as number, b.through, b.counted as number, (b.reason as string | undefined) ?? "", guard.session.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HandoverError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
