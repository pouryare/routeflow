import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { onlineUserIds } from "@/lib/repo/live";

export const dynamic = "force-dynamic";

/** Who in the caller's company has a screen open right now (issue #58, presence). The live
 *  stream's `presence` notices keep a screen up to date after this first read. */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  return NextResponse.json({ ok: true, online: await onlineUserIds(session.organizationId) });
}
