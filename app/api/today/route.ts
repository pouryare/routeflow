import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { todayFor } from "@/lib/repo/briefing";

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  return NextResponse.json({ ok: true, ...todayFor(session) });
}
