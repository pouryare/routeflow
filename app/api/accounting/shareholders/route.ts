import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { tehranTodayIso } from "@/lib/jalali";
import { OWNER_ROLES } from "@/lib/roles";
import { LedgerError } from "@/lib/repo/ledgerCore";
import { addShareholderIn, shareholdersOf, sharesInForce } from "@/lib/repo/routeAdapters";

/** The company's shareholders and the shares in force today. Owner only: who owns what is the
 *  most private thing in the books. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const org = guard.session.organizationId;
  const today = tehranTodayIso();
  return NextResponse.json({ ok: true, shareholders: await shareholdersOf(org), shares: await sharesInForce(org, null, today) });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { name?: unknown; user_id?: unknown } | null;
  try {
    const id = await addShareholderIn({
      organizationId: guard.session.organizationId,
      name: typeof body?.name === "string" ? body.name : "",
      userId: Number.isInteger(body?.user_id) ? (body!.user_id as number) : null,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
