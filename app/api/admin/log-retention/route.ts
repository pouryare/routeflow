import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { withDbScope } from "@/lib/database/scope";
import { setKeepDays } from "@/lib/repo/logRetention";
import { MAX_KEEP_DAYS, MIN_KEEP_DAYS } from "@/lib/logRetention";

/** How long each machine log is kept (FB41). One number per log for the whole server, so it is the platform
 *  owner's, like the history archive. PUT { id, days }. */
export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  if (!guard.session.hasRole("platform_owner")) {
    return NextResponse.json({ ok: false, error: "دسترسی لازم را ندارید" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { id?: unknown; days?: unknown } | null;
  const saved = typeof body?.id === "string" && (await withDbScope("system", () => setKeepDays(body.id as string, Number(body?.days))));
  if (!saved) {
    return NextResponse.json({ ok: false, error: `بین ${MIN_KEEP_DAYS.toLocaleString("fa-IR")} تا ${MAX_KEEP_DAYS.toLocaleString("fa-IR")} روز بنویسید` }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
