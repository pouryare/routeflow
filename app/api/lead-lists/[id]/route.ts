import { NextRequest, NextResponse } from "next/server";
import { deleteLeadList, findOwnList, renameLeadList, replaceLeadListItems } from "@/lib/repo/leadListsAdmin";
import { sanitiseIds } from "../route";
import { canReachGroup, groupFilter, orgScopeId, requireRole } from "@/lib/session";
import { PIN_POOL_ROLES } from "@/lib/roles";

interface PatchInput {
  name?: string;
  /** The whole ordered membership. Present means "replace with exactly this". */
  location_ids?: number[];
}

const MAX_NAME = 60;

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/lead-lists/[id]">) {
  const guard = await requireRole(req, PIN_POOL_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as PatchInput | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "بدنه درخواست نامعتبر است" }, { status: 400 });
  }

  // The company is part of the lookup: a list with no group is reachable by any owner, so the
  // group rule alone would let one company edit another's.
  const organizationId = orgScopeId(guard.session);
  const owning = await findOwnList(idNum, organizationId);
  if (!owning || !await canReachGroup(guard.session, owning.group_id)) {
    return NextResponse.json({ ok: false, error: "فهرست پیدا نشد" }, { status: 404 });
  }

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ ok: false, error: "نام فهرست نمی‌تواند خالی باشد" }, { status: 400 });
    }
    if (name.length > MAX_NAME) {
      return NextResponse.json({ ok: false, error: "نام فهرست بیش از حد بلند است" }, { status: 400 });
    }
    await renameLeadList(idNum, organizationId, name);
  }

  if (body.location_ids !== undefined) {
    const ids = sanitiseIds(body.location_ids);
    if (ids === null) {
      return NextResponse.json({ ok: false, error: "فهرست مکان‌ها نامعتبر است" }, { status: 400 });
    }
    await replaceLeadListItems(idNum, organizationId, ids, await groupFilter(guard.session));
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/lead-lists/[id]">) {
  const guard = await requireRole(req, PIN_POOL_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const row = await findOwnList(idNum, orgScopeId(guard.session));
  if (!row || !await canReachGroup(guard.session, row.group_id)) {
    return NextResponse.json({ ok: false, error: "فهرست پیدا نشد" }, { status: 404 });
  }

  const locationIds = await deleteLeadList(idNum, orgScopeId(guard.session));

  // Handed back so the delete can be undone from the toast, membership and all. Only the
  // list is deleted -- the locations themselves are untouched.
  return NextResponse.json({
    ok: true,
    deleted: { name: row.name, location_ids: locationIds },
  });
}
