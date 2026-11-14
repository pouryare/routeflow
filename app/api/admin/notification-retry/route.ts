import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { flushNotifications } from "@/lib/repo/notifications";

/** FB20: «تلاش دوباره»: send what is still waiting for phones right now, instead of at the next five-minute tick. Owner only. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const r = await flushNotifications(guard.session.organizationId);
  return NextResponse.json({ ok: true, sent: r.sent + r.edited, held: r.held });
}
