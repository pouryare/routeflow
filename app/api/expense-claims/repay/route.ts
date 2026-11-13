import { NextRequest, NextResponse } from "next/server";
import { once } from "@/lib/repo/idempotency";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { ClaimError, repayStaff } from "@/lib/repo/expenseClaims";

/** F88, owner only: pay back everything approved for one person, from the cash box or the bank. `deduct_toman` (optional) is how much of that person's loan to take off the payment. */
async function post(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { user_id?: unknown; method?: unknown; deduct_toman?: unknown } | null;
  if (!Number.isInteger(b?.user_id) || (b?.method !== "CASH" && b?.method !== "TRANSFER")) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  try {
    const total = await repayStaff(guard.session.organizationId, b!.user_id as number, b!.method as "CASH" | "TRANSFER", guard.session.user.id, Number.isInteger(b?.deduct_toman) ? (b!.deduct_toman as number) : 0);
    return NextResponse.json({ ok: true, total });
  } catch (e) {
    if (e instanceof ClaimError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
export const POST = (req: NextRequest) => once(req, () => post(req));
