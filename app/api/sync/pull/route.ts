import { promisify } from "node:util";
import { gzip } from "node:zlib";
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
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  if (!hasSyncClient(session.role)) {
    return NextResponse.json({ ok: false, error: "این حساب همگام‌سازی ندارد" }, { status: 403 });
  }

  const since = req.nextUrl.searchParams.get("since");
  const result = await pullSince(session, since && since.length > 0 ? since : null);
  const payload = JSON.stringify({ ok: true, ...result, server_time: new Date().toISOString() });
  /* A first pull is megabytes of JSON, and next start does not compress route-handler responses
     (measured: 2.1 MB sent for a driver, 120 KB gzipped), so it is compressed here. Behind a proxy
     that already compresses, Content-Encoding makes it pass the body through untouched. */
  if (/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) {
    return new Response(await promisify(gzip)(payload), {
      headers: { "content-type": "application/json", "content-encoding": "gzip", vary: "Accept-Encoding" },
    });
  }
  return new Response(payload, { headers: { "content-type": "application/json" } });
}
