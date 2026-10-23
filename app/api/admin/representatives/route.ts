import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  createRepresentative,
  listWithCustomer,
  listWholesaleCandidates,
} from "@/lib/repo/representatives";

/** The representative network for one organisation. owner and rep_manager only --
 *  group managers run territory, not the channel. `?candidates=1` returns the WHOLESALE
 *  customers eligible to become a representative. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, ["platform_owner", "owner", "rep_manager"]);
  if (!guard.ok) return guard.response;

  const org = guard.session.organizationId;
  if (req.nextUrl.searchParams.get("candidates") === "1") {
    return NextResponse.json({ ok: true, candidates: await listWholesaleCandidates(org) });
  }
  return NextResponse.json({ ok: true, representatives: await listWithCustomer(org) });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ["platform_owner", "owner", "rep_manager"]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    customer_id?: number;
    rep_code?: string;
    manager_user_id?: number | null;
  } | null;
  if (!body?.customer_id || !body?.rep_code?.trim()) {
    return NextResponse.json({ ok: false, error: "مشتری و کد نماینده لازم است" }, { status: 400 });
  }

  try {
    const id = await createRepresentative(guard.session.organizationId, {
      customer_id: Number(body.customer_id),
      rep_code: body.rep_code.trim(),
      manager_user_id: body.manager_user_id ?? null,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && /UNIQUE/.test(e.message)) {
      return NextResponse.json(
        { ok: false, error: "این مشتری قبلاً نماینده شده یا کد نماینده تکراری است" },
        { status: 409 }
      );
    }
    throw e;
  }
}
