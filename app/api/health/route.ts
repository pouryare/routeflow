import { NextResponse } from "next/server";
import { dbAnswers } from "@/lib/database/connection";
import pkg from "@/package.json";
import { liveHub } from "@/lib/live/hub";

export const dynamic = "force-dynamic";

/** Liveness for an outside monitor and for `routeflow upgrade`: 200 when the app can reach its
 *  database, 503 when it cannot. Both carry the running version, so an upgrade can tell the new
 *  release from the old one and a bug report can say which release it saw. No session, no data.
 *  `live` counts this server's open live streams (issue #58): whether it is listening for events,
 *  how many streams and people, frames sent, and streams dropped for being too slow. */
export async function GET() {
  const ok = await dbAnswers();
  return NextResponse.json({ ok, version: pkg.version, live: liveHub.stats() }, { status: ok ? 200 : 503 });
}
