import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  listNotificationGroups,
  unreadGroupCount,
  markGroupsRead,
} from "@/lib/repo/notifications";

const ROLES = ["owner", "group_manager", "rep_manager", "salesperson", "driver"] as const;

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const { organizationId, user } = guard.session;
  return NextResponse.json({
    ok: true,
    unread: unreadGroupCount(organizationId, user.id),
    groups: listNotificationGroups(organizationId, user.id, { limit: 50 }),
  });
}

export async function PATCH(req: NextRequest) {
  const guard = requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const { organizationId, user } = guard.session;
  const body = (await req.json().catch(() => null)) as { read?: unknown } | null;
  const read = body?.read;
  const ok = read === "all" || (Array.isArray(read) && read.every((x) => typeof x === "string"));
  if (!ok) return NextResponse.json({ ok: false, error: "پارامتر read نامعتبر است" }, { status: 400 });
  markGroupsRead(organizationId, user.id, read as string[] | "all");
  return NextResponse.json({ ok: true, unread: unreadGroupCount(organizationId, user.id) });
}
