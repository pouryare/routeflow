import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { hasSyncClient } from "@/lib/roles";
import { pullSince } from "@/lib/repo/syncPull";

/** Everything this session may see that changed since `?since=<iso>` (omit for a full
 *  snapshot), plus tombstones and the new watermark.
 *
 *  `hasSyncClient`, not a literal: see the constant for why the vendor is excluded and why
 *  that answer is stated once. The check stays HERE even though the shell no longer asks on
 *  the founder's behalf — this is the authoritative, DB-backed refusal, and the shell's
 *  gate is only a hint that saves the browser a pointless request. */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  if (!hasSyncClient(session.role)) {
    return NextResponse.json({ ok: false, error: "این حساب همگام‌سازی ندارد" }, { status: 403 });
  }

  const since = req.nextUrl.searchParams.get("since");
  const result = pullSince(session, since && since.length > 0 ? since : null);
  return NextResponse.json({ ok: true, ...result, server_time: new Date().toISOString() });
}
