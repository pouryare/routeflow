import { NextResponse } from "next/server";
import { getDb } from "@/lib/database/connection";

export const dynamic = "force-dynamic";

/** Liveness for an outside monitor: 200 when the app can reach its database, 503 when it cannot.
 *  No session and no data in the reply, so a monitor can poll it without a login. */
export async function GET() {
  try {
    await getDb().prepare("SELECT 1 AS ok").get();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
