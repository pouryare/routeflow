import { NextResponse } from "next/server";
import { getDb } from "@/lib/database/connection";
import pkg from "@/package.json";

export const dynamic = "force-dynamic";

/** Liveness for an outside monitor and for `routeflow upgrade`: 200 when the app can reach its
 *  database, 503 when it cannot. Both carry the running version, so an upgrade can tell the new
 *  release from the old one and a bug report can say which release it saw. No session, no data. */
export async function GET() {
  try {
    await getDb().prepare("SELECT 1 AS ok").get();
    return NextResponse.json({ ok: true, version: pkg.version });
  } catch {
    return NextResponse.json({ ok: false, version: pkg.version }, { status: 503 });
  }
}
