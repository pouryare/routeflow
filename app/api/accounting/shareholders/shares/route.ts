import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { LedgerError } from "@/lib/repo/ledgerCore";
import { setSharesIn } from "@/lib/repo/routeAdapters";

/** Record a full set of shares from a date. `percent` is a number with at most two decimals (60, 33.33);
 *  it is turned into basis points here so the repo never sees a float. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as {
    group_id?: unknown;
    valid_from?: unknown;
    shares?: { party_id?: unknown; percent?: unknown }[];
  } | null;
  if (!body || !Array.isArray(body.shares) || typeof body.valid_from !== "string") {
    return NextResponse.json({ ok: false, error: "اطلاعات سهم‌ها ناقص است" }, { status: 400 });
  }
  const shares = body.shares.map((s) => ({ partyId: Number(s.party_id), percentBp: Math.round(Number(s.percent) * 100) }));
  if (shares.some((s) => !Number.isInteger(s.partyId) || !Number.isFinite(s.percentBp))) {
    return NextResponse.json({ ok: false, error: "اطلاعات سهم‌ها نامعتبر است" }, { status: 400 });
  }
  try {
    await setSharesIn({
      organizationId: guard.session.organizationId,
      groupId: Number.isInteger(body.group_id) ? (body.group_id as number) : null,
      validFrom: body.valid_from,
      shares,
      createdBy: guard.session.user.id,
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
