import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { LeaveError, peopleOnLeave, setLeave } from "@/lib/repo/leave";

function failure(e: unknown) {
  if (e instanceof LeaveError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  throw e;
}

/** Who is away today, with what each still holds. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ ok: true, people: await peopleOnLeave(guard.session) });
  } catch (e) {
    return failure(e);
  }
}

/** { user_id, days, reason?, delegate_id? } sends a person on leave from today; { user_id, days: null } brings them back. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { user_id?: unknown; days?: unknown; reason?: unknown; delegate_id?: unknown } | null;
  if (!Number.isInteger(b?.user_id)) return NextResponse.json({ ok: false, error: "کاربر انتخاب نشده است" }, { status: 400 });
  if (b!.days !== null && !Number.isInteger(b!.days)) return NextResponse.json({ ok: false, error: "مدت مرخصی را انتخاب کنید" }, { status: 400 });
  try {
    await setLeave(guard.session, b!.user_id as number, b!.days as number | null, typeof b!.reason === "string" ? b!.reason : null, Number.isInteger(b?.delegate_id) ? (b!.delegate_id as number) : null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
