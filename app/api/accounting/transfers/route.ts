import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { LedgerError, recordTransfer } from "@/lib/repo/ledgerPostings";
import { once } from "@/lib/repo/idempotency";

/** A4: move money between own accounts: { from, to, amount_toman, fee_toman?, date, tracking? } (codes 1101, 1102, 1103). */
async function post(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { from?: unknown; to?: unknown; amount_toman?: unknown; fee_toman?: unknown; date?: unknown; tracking?: unknown } | null;
  if (typeof b?.from !== "string" || typeof b.to !== "string" || typeof b.amount_toman !== "number" || typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  }
  try {
    const id = await recordTransfer({
      organizationId: guard.session.organizationId,
        from: b.from as string,
        to: b.to as string,
        amountToman: b.amount_toman as number,
        feeToman: typeof b.fee_toman === "number" ? b.fee_toman : 0,
        postedAt: `${b.date}T12:00:00.000Z`,
        tracking: typeof b.tracking === "string" ? b.tracking.slice(0, 60) : null,
        by: guard.session.user.id,
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}

export const POST = (req: NextRequest) => once(req, () => post(req));
