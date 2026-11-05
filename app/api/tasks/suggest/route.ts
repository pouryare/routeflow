import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ownTitles } from "@/lib/repo/tasks";
import { MANAGE_ROLES } from "@/lib/roles";

/** The caller's own past note or reminder wording, for finishing what they type. Same roles as creating one. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const kind = req.nextUrl.searchParams.get("kind") === "note" ? "note" : "reminder";
  return NextResponse.json({ ok: true, titles: await ownTitles(guard.session.organizationId, guard.session.user.id, kind) });
}
