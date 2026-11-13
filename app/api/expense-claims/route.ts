import { NextRequest, NextResponse } from "next/server";
import { once } from "@/lib/repo/idempotency";
import { requireRole } from "@/lib/session";
import { CLAIM_ROLES } from "@/lib/expenseRoles";
import { ClaimError, myClaims, submitClaim } from "@/lib/repo/expenseClaims";

/** F26/F88: a staff member's own claims, and a new one. Scoped to the caller: nobody reads another person's claims here. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, CLAIM_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, claims: await myClaims(guard.session.organizationId, guard.session.user.id) });
}

async function post(req: NextRequest) {
  const guard = await requireRole(req, CLAIM_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { account_id?: unknown; amount_toman?: unknown; incurred_at?: unknown; note?: unknown } | null;
  if (!Number.isInteger(b?.account_id)) return NextResponse.json({ ok: false, error: "دستهٔ هزینه را انتخاب کنید" }, { status: 400 });
  try {
    const id = await submitClaim(
      { organizationId: guard.session.organizationId, userId: guard.session.user.id, groupId: guard.session.groupId },
      {
        account_id: b!.account_id as number,
        amount_toman: Number(b?.amount_toman),
        incurred_at: typeof b?.incurred_at === "string" && b.incurred_at ? b.incurred_at : null,
        note: typeof b?.note === "string" ? b.note : null,
      },
    );
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof ClaimError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
export const POST = (req: NextRequest) => once(req, () => post(req));
