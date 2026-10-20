import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { listAlerts, resolveAlert, AlertError } from "@/lib/repo/alerts";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const sp = req.nextUrl.searchParams;
  return NextResponse.json({
    ok: true,
    alerts: listAlerts(guard.session.organizationId, {
      open: sp.get("open") === "1",
      severity: sp.get("severity") ?? undefined,
    }),
  });
}

export async function PATCH(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { id?: number; resolve?: boolean } | null;
  if (!b?.id || !b.resolve) return NextResponse.json({ ok: false, error: "هشدار مشخص نشده است" }, { status: 400 });
  try {
    resolveAlert(guard.session.organizationId, Number(b.id), guard.session.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AlertError) return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    throw e;
  }
}
