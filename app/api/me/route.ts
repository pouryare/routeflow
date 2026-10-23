import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { isVanRole } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies(req.cookies.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    role: session.role,
    isManager: !isVanRole(session.role),
    userId: session.user.id,
    username: session.user.username,
    organizationId: session.organizationId,
  });
}
