import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pullSince } from "@/lib/repo/syncPull";

/** Everything this session may see that changed since `?since=<iso>` (omit for a full
 *  snapshot), plus tombstones and the new watermark. */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  if (session.role === "platform_owner") {
    return NextResponse.json({ ok: false, error: "این حساب همگام‌سازی ندارد" }, { status: 403 });
  }

  const since = req.nextUrl.searchParams.get("since");
  const result = pullSince(session, since && since.length > 0 ? since : null);
  return NextResponse.json({ ok: true, ...result, server_time: new Date().toISOString() });
}
