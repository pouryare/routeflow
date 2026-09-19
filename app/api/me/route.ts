import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { getDb, type UserRow } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = getSessionFromCookies(req.cookies.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    role: session.role,
    isManager: session.role !== "driver",
    userId: session.user.id,
    username: session.user.username,
    organizationId: session.organizationId,
  });
}
