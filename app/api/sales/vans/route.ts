import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { vansFor } from "@/lib/repo/vanPositions";

/** F6: the live dots of drivers whose run is in progress, for the owner and managers (their groups only). */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, vans: await vansFor(guard.session) });
}
