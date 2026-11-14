import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { ruleFirings } from "@/lib/repo/rules";

/** F130 firing log: ?code=… gives the last firings of one rule (owner only, like the rules page). */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const code = req.nextUrl.searchParams.get("code");
  if (!code || code.length > 80) return NextResponse.json({ ok: false, error: "قانون مشخص نشده است" }, { status: 400 });
  return NextResponse.json({ ok: true, firings: await ruleFirings(guard.session.organizationId, code) });
}
