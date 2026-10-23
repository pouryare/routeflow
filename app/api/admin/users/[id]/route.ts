import { NextRequest, NextResponse } from "next/server";
import type { UserRow } from "@/lib/db";
import { deactivateUser, findUserInOrg, otherActiveOwners, updateUser } from "@/lib/repo/usersAdmin";
import { planUserPatch } from "@/lib/userPatchPlan";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";

/** Would this change leave this organisation with no active owner? (Another company's owners do not count.)
 *
 *  The only way back from that is scripts/create-user.mjs over SSH, so it is worth one
 *  extra query on every account edit. */
async function wouldStrandTheApp(target: UserRow, becomingNonOwner: boolean): Promise<boolean> {
  if (target.role !== "owner" || !target.active || !becomingNonOwner) return false;
  return await otherActiveOwners(target.id, target.organization_id) === 0;
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/users/[id]">) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  // Tenant-scoped: an owner administers their own organisation's staff and no one else's.
  // A cross-tenant id reads as "not found" rather than becoming an editable row.
  const target = await findUserInOrg(userId, guard.session.organizationId);
  if (!target) return NextResponse.json({ ok: false, error: "کاربر پیدا نشد" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const plan = await planUserPatch(body, target, guard.session.organizationId, guard.session.user.id);
  if (!plan.ok) return NextResponse.json({ ok: false, error: plan.error }, { status: plan.status });
  const { sets, values } = plan;

  try {
    await updateUser(userId, guard.session.organizationId, sets, values);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/admin/users/[id]">) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  // Same tenant scoping as PATCH -- deactivating is at least as consequential as editing.
  const target = await findUserInOrg(userId, guard.session.organizationId);
  if (!target) return NextResponse.json({ ok: false, error: "کاربر پیدا نشد" }, { status: 404 });

  if (await wouldStrandTheApp(target, true)) {
    return NextResponse.json(
      { ok: false, error: "این تنها مالک فعال است. اول یک مالک دیگر بسازید." },
      { status: 409 }
    );
  }

  // Deactivate, never delete; the token bump is what actually ends their session.
  await deactivateUser(userId, guard.session.organizationId);
  return NextResponse.json({ ok: true, deactivated: true });
}
