import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { handOver, HandoverError, previewHandover } from "@/lib/repo/handover";

function failure(e: unknown) {
  if (e instanceof HandoverError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  throw e;
}

/** How much one person holds: `?from=<user id>`. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const from = Number(req.nextUrl.searchParams.get("from"));
  if (!Number.isInteger(from)) return NextResponse.json({ ok: false, error: "کاربر انتخاب نشده است" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await previewHandover(guard.session, from)) });
  } catch (e) {
    return failure(e);
  }
}

/** Hands all of one person's customers and open tasks to another: { from_user_id, to_user_id }. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { from_user_id?: unknown; to_user_id?: unknown } | null;
  if (!Number.isInteger(b?.from_user_id) || !Number.isInteger(b?.to_user_id)) return NextResponse.json({ ok: false, error: "فرستنده و گیرنده را انتخاب کنید" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await handOver(guard.session, b!.from_user_id as number, b!.to_user_id as number)) });
  } catch (e) {
    return failure(e);
  }
}
