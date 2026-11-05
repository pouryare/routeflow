import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { setTaskPushMinutes } from "@/lib/repo/taskPush";

/** S19: how many minutes before a timed task its assignee gets the push (1 to 120). */
export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { minutes?: unknown } | null;
  const minutes = Number(body?.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
    return NextResponse.json({ ok: false, error: "بین ۱ تا ۱۲۰ دقیقه بنویسید" }, { status: 400 });
  }
  await setTaskPushMinutes(guard.session.organizationId, minutes);
  return NextResponse.json({ ok: true });
}
