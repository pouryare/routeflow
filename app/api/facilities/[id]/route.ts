import { NextRequest, NextResponse } from "next/server";
import { FACILITY_KINDS, FACILITY_ICONS, defaultIconFor, FacilityKind } from "@/lib/db";
import { deleteFacility, findOwnFacility, updateFacility } from "@/lib/repo/facilitiesAdmin";
import { isValidCoord } from "@/lib/geoLinks";
import { canReachGroup, orgScopeId, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

interface PatchInput {
  name?: string;
  kind?: string;
  icon_key?: string | null;
  lat?: number;
  lng?: number;
  address?: string | null;
  notes?: string | null;
  is_default_origin?: boolean;
}

// Writes use canReachGroup, not the shared-aware read filter: a manager can *see* the
// company warehouse (group_id NULL) but must not be able to rename, move or delete it.
// Only an owner reaches an ungrouped row.
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/facilities/[id]">) {
  const guard = await requireRole(req, MANAGE_ROLES);
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

  // kind is read here, not just for the 404 check, because an icon_key PATCH has to be
  // validated against the kind the row will have AFTER this request. The company is part of
  // the lookup: an id alone reaches every tenant's sites.
  const organizationId = orgScopeId(guard.session);
  const exists = await findOwnFacility(idNum, organizationId) as
    | { id: number; group_id: number | null; kind: FacilityKind }
    | undefined;
  // 404 rather than 403 for another group's site, for the same reason as districts:
  // a 403 confirms it exists.
  if (!exists || !await canReachGroup(guard.session, exists.group_id)) {
    return NextResponse.json({ ok: false, error: "مکان پیدا نشد" }, { status: 404 });
  }

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ ok: false, error: "نام مکان نمی‌تواند خالی باشد" }, { status: 400 });
    }
    sets.push("name = ?");
    values.push(name);
  }

  if (body.kind !== undefined) {
    if (!FACILITY_KINDS.includes(body.kind as FacilityKind)) {
      return NextResponse.json({ ok: false, error: "نوع مکان نامعتبر است" }, { status: 400 });
    }
    sets.push("kind = ?");
    values.push(body.kind as FacilityKind);
  }

  if (body.icon_key !== undefined) {
    // Validated against the kind's options, so a kind change that leaves the stored icon
    // belonging to the old kind cannot strand the marker on a shape no renderer resolves.
    // Checked AFTER the kind above so a request carrying both is judged against the new one.
    // FACILITY_KINDS.includes() narrows or it does not: a cast would let an unknown kind
    // through and land in the map lookup below as a miss.
    const requested = body.kind ?? exists.kind;
    const kind = FACILITY_KINDS.includes(requested as FacilityKind)
      ? (requested as FacilityKind)
      : exists.kind;
    const wanted = body.icon_key;
    const next =
      typeof wanted === "string" && FACILITY_ICONS[kind]?.includes(wanted)
        ? wanted
        : defaultIconFor(kind);
    sets.push("icon_key = ?");
    values.push(next);
  }

  if (body.lat !== undefined || body.lng !== undefined) {
    if (typeof body.lat !== "number" || typeof body.lng !== "number" || !isValidCoord(body.lat, body.lng)) {
      return NextResponse.json({ ok: false, error: "مختصات نامعتبر است" }, { status: 400 });
    }
    sets.push("lat = ?", "lng = ?");
    values.push(body.lat, body.lng);
  }

  if (body.address !== undefined) {
    sets.push("address = ?");
    values.push(body.address);
  }

  if (body.notes !== undefined) {
    sets.push("notes = ?");
    values.push(body.notes);
  }

  // The default-origin flag moves by being set on another site, never by being cleared
  // here: clearing it would leave the app with no origin at all, which strands every
  // distance it computes. Enforced as a rejection rather than a silent no-op so the UI
  // can explain what to do instead.
  if (body.is_default_origin === false) {
    return NextResponse.json(
      { ok: false, error: "برای تغییر مبدأ، مکان دیگری را به‌عنوان مبدأ پیش‌فرض انتخاب کنید" },
      { status: 400 }
    );
  }

  if (sets.length === 0 && body.is_default_origin !== true) {
    return NextResponse.json({ ok: false, error: "چیزی برای به‌روزرسانی ارسال نشده است" }, { status: 400 });
  }

  // Column changes and the origin move run in one transaction (spec §1.1).
  try {
    await updateFacility(idNum, organizationId, sets, values, body.is_default_origin === true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا در به‌روزرسانی مکان";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/facilities/[id]">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  // Every distance in the app is measured from a site, so the last one cannot go; the whole row
  // comes back so the delete can be undone from the toast.
  let result;
  try {
    result = await deleteFacility(idNum, orgScopeId(guard.session), async (g) => await canReachGroup(guard.session, g));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا در حذف مکان";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
  if (!result.ok) {
    return result.reason === "last"
      ? NextResponse.json({ ok: false, error: "آخرین مکان را نمی‌توان حذف کرد" }, { status: 400 })
      : NextResponse.json({ ok: false, error: "مکان پیدا نشد" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: result.deleted });
}
