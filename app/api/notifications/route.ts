import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  listNotificationGroups,
  unreadGroupCount,
  markGroupsRead,
} from "@/lib/repo/notifications";

const ROLES = ["platform_owner", "owner", "group_manager", "rep_manager", "phone_sales", "field_rep", "delivery_driver"] as const;

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const { organizationId, user } = guard.session;
  return NextResponse.json({
    ok: true,
    unread: await unreadGroupCount(organizationId, user.id),
    groups: await listNotificationGroups(organizationId, user.id, { limit: 50 }),
  });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const { organizationId, user } = guard.session;
  const body = (await req.json().catch(() => null)) as { read?: unknown } | null;
  const read = body?.read;
  const ok = read === "all" || (Array.isArray(read) && read.every((x) => typeof x === "string"));
  if (!ok) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  // Cap the array so a pathological payload can't blow SQLite's bound-variable limit
  // inside the `group_key IN (...)` clause.
  const keys = read === "all" ? "all" : (read as string[]).slice(0, 200);
  await markGroupsRead(organizationId, user.id, keys);
  return NextResponse.json({ ok: true, unread: await unreadGroupCount(organizationId, user.id) });
}
