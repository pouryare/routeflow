import { NextRequest, NextResponse } from "next/server";
import { deleteDistrict, findDistrict, updateDistrict } from "@/lib/repo/districtsAdmin";
import { canReachGroup, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

const VALID_STATUSES = ["visited", "needs_coverage", "not_allowed", "unknown"];

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/districts/[id]">) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const districtId = Number(id);
  if (!Number.isInteger(districtId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const { coverage_status, notes } = body ?? {};
  if (coverage_status !== undefined && !VALID_STATUSES.includes(coverage_status)) {
    return NextResponse.json({ ok: false, error: "وضعیت نامعتبر است" }, { status: 400 });
  }

  const existing = findDistrict(districtId);
  // 404 rather than 403 for a district in another group. A 403 would confirm the row
  // exists, which itself tells a manager how the province is carved up and who holds what.
  if (!existing || !canReachGroup(guard.session, existing.group_id)) {
    return NextResponse.json({ ok: false, error: "منطقه پیدا نشد" }, { status: 404 });
  }

  updateDistrict(existing, { coverage_status, notes }, { name: guard.session.user.display_name, id: guard.session.user.id });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/districts/[id]">) {
  // This route had no role check and no reach check: any signed-in caller could delete any
  // company's custom district. It now follows the PATCH rules.
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const districtId = Number(id);
  if (!Number.isInteger(districtId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }
  const row = findDistrict(districtId);
  if (!row || !canReachGroup(guard.session, row.group_id)) {
    return NextResponse.json({ ok: false, error: "منطقه پیدا نشد" }, { status: 404 });
  }
  if (!row.is_custom) {
    return NextResponse.json(
      { ok: false, error: "این منطقه از پیش‌فرض‌های نقشه است و قابل حذف نیست" },
      { status: 403 }
    );
  }
  deleteDistrict(districtId);
  return NextResponse.json({ ok: true });
}
