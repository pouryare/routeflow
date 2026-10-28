import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { LedgerError } from "@/lib/repo/ledgerCore";
import { payPartner } from "@/lib/repo/routeAdapters";
import { isToman } from "@/lib/money";

/** Money to a partner: an advance against the year's share, or a payout of dividends already credited. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as {
    party_id?: unknown; kind?: unknown; amount_toman?: unknown; method?: unknown; paid_on?: unknown;
  } | null;
  const kind = body?.kind === "dividend" ? "dividend" : body?.kind === "advance" ? "advance" : null;
  const amount = Number(body?.amount_toman);
  if (!kind || !Number.isInteger(body?.party_id) || !isToman(amount) || amount <= 0 || typeof body?.method !== "string" || typeof body?.paid_on !== "string") {
    return NextResponse.json({ ok: false, error: "اطلاعات پرداخت ناقص است" }, { status: 400 });
  }
  try {
    const id = await payPartner(kind, {
      organizationId: guard.session.organizationId, partyId: body.party_id as number, amountToman: amount,
      method: body.method, paidOn: body.paid_on, createdBy: guard.session.user.id,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
