import { NextRequest, NextResponse } from "next/server";
import { deleteGroup, groupExists, groupMemberCount, updateGroup } from "@/lib/repo/groupsAdmin";
import { orgScopeId, requireRole } from "@/lib/session";
import { GROUP_PALETTE } from "../route";
import { OWNER_ROLES } from "@/lib/roles";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/groups/[id]">) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  // The group must belong to the caller's company: an id alone reaches every tenant's groups.
  const organizationId = orgScopeId(guard.session);
  if (!await groupExists(groupId, organizationId)) {
    return NextResponse.json({ ok: false, error: "گروه پیدا نشد" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as
    | { name?: string; color?: string; active?: boolean }
    | null;

  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ ok: false, error: "نام گروه الزامی است" }, { status: 400 });
    sets.push("name = ?");
    values.push(name);
  }
  if (body?.color !== undefined) {
    if (!GROUP_PALETTE.includes(body.color ?? "")) {
      return NextResponse.json({ ok: false, error: "رنگ نامعتبر است" }, { status: 400 });
    }
    sets.push("color = ?");
    values.push(body.color!);
  }
  if (body?.active !== undefined) {
    sets.push("active = ?");
    values.push(body.active ? 1 : 0);
  }
  if (sets.length === 0) {
    return NextResponse.json({ ok: false, error: "چیزی برای ذخیره نیست" }, { status: 400 });
  }

  try {
    await updateGroup(groupId, organizationId, sets, values);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: false, error: "گروهی با این نام از قبل وجود دارد" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/admin/groups/[id]">) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  // The group must belong to the caller's company: an id alone reaches every tenant's groups.
  const organizationId = orgScopeId(guard.session);
  if (!await groupExists(groupId, organizationId)) {
    return NextResponse.json({ ok: false, error: "گروه پیدا نشد" }, { status: 404 });
  }

  // Accounts first. Deleting a group out from under its members would leave each of them
  // with a group_id pointing at nothing -- scopeGroupIds would still return that id, so
  // every query would match zero rows and the account would silently see an empty app
  // rather than an error anyone could diagnose.
  const n = await groupMemberCount(groupId);
  if (n > 0) {
    return NextResponse.json(
      { ok: false, error: `این گروه ${n} کاربر دارد. اول آن‌ها را به گروه دیگری منتقل کنید.` },
      { status: 409 }
    );
  }

  const regrouped = await deleteGroup(groupId, organizationId);

  return NextResponse.json({ ok: true, regrouped });
}
