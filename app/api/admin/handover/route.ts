import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { handOver, HandoverError, lend, openLoans, previewHandover, returnLoans } from "@/lib/repo/handover";

function failure(e: unknown) {
  if (e instanceof HandoverError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  throw e;
}

/** How much one person holds: `?from=<user id>`. With `?loans=1`: the customers lent out right now. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  if (req.nextUrl.searchParams.get("loans")) {
    try {
      return NextResponse.json({ ok: true, loans: await openLoans(guard.session) });
    } catch (e) {
      return failure(e);
    }
  }
  const from = Number(req.nextUrl.searchParams.get("from"));
  if (!Number.isInteger(from)) return NextResponse.json({ ok: false, error: "کاربر انتخاب نشده است" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await previewHandover(guard.session, from)) });
  } catch (e) {
    return failure(e);
  }
}

/** Hands all of one person's customers and open tasks to another: { from_user_id, to_user_id }.
 *  With `days` the customers are only lent for that many days (T13) and come back by themselves. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { from_user_id?: unknown; to_user_id?: unknown; days?: unknown } | null;
  if (!Number.isInteger(b?.from_user_id) || !Number.isInteger(b?.to_user_id)) return NextResponse.json({ ok: false, error: "فرستنده و گیرنده را انتخاب کنید" }, { status: 400 });
  try {
    if (b!.days !== undefined && b!.days !== null) return NextResponse.json({ ok: true, ...(await lend(guard.session, b!.from_user_id as number, b!.to_user_id as number, b!.days as number)) });
    return NextResponse.json({ ok: true, ...(await handOver(guard.session, b!.from_user_id as number, b!.to_user_id as number)) });
  } catch (e) {
    return failure(e);
  }
}

/** Gives lent customers back before their last day: { loan_ids: number[] }. */
export async function PATCH(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { loan_ids?: unknown } | null;
  const ids = Array.isArray(b?.loan_ids) ? b!.loan_ids.filter((x): x is number => Number.isInteger(x)) : [];
  if (!ids.length) return NextResponse.json({ ok: false, error: "قرضی انتخاب نشده است" }, { status: 400 });
  return NextResponse.json({ ok: true, returned: await returnLoans(guard.session.organizationId, ids, guard.session.user.id) });
}
