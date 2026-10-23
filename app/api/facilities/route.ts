import { NextRequest, NextResponse } from "next/server";
import { FACILITY_KINDS, FACILITY_ICONS, defaultIconFor, FacilityKind } from "@/lib/db";
import { facilitiesSignature, insertFacility, resolveRestore } from "@/lib/repo/facilitiesAdmin";
import { facilitiesIn } from "@/lib/repo/routeAdapters";
import { etagFor, etagJson, notModified } from "@/lib/httpCache";
import { isValidCoord } from "@/lib/geoLinks";
import { groupFilterWithShared, orgScopeId, requireRole, scopeGroupIds } from "@/lib/session";
import { MANAGE_ROLES, PIN_POOL_ROLES } from "@/lib/roles";

// facilities is option 1 (spec §2.3 / Task 8): a site a group adds belongs to that group.
// A site with no group is company-wide -- the seeded warehouse and home origin -- and stays
// readable by everyone, because every group plans its routes out of the same depot.
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, PIN_POOL_ROLES);
  if (!guard.ok) return guard.response;
  const scope = await groupFilterWithShared(guard.session);
  const scopeIds = await scopeGroupIds(guard.session);

  // Signature of this company's sites; a pin move bumps updated_at and so invalidates the tag.
  const sig = await facilitiesSignature(orgScopeId(guard.session));
  const tag = etagFor(`facilities:${scopeIds === "all" ? "all" : scopeIds.join(",")}`, sig.c, sig.m);
  const cached = notModified(req, tag);
  if (cached) return cached;

  return etagJson(req, tag, { facilities: await facilitiesIn(scope) });
}

interface NewFacilityInput {
  name?: string;
  kind?: string;
  icon_key?: string | null;
  lat?: number;
  lng?: number;
  address?: string | null;
  maps_url?: string | null;
  notes?: string | null;
  /** Undo of a delete, not a normal add.
   *
   *  A site's id is referenced by the arrival log and by any facility stops on a plan.
   *  Re-adding under a fresh id would put the pin back on the map while silently
   *  orphaning every visit recorded there, which is not what "undo" claims to do -- so a
   *  restore reclaims the original id and slug. Refused if either is taken again, in
   *  which case the caller falls back to a plain add. */
  restore?: { id?: number; slug?: string };
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as NewFacilityInput | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "بدنه درخواست نامعتبر است" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, error: "نام مکان الزامی است" }, { status: 400 });
  }
  if (!FACILITY_KINDS.includes(body.kind as FacilityKind)) {
    return NextResponse.json({ ok: false, error: "نوع مکان نامعتبر است" }, { status: 400 });
  }
  if (typeof body.lat !== "number" || typeof body.lng !== "number" || !isValidCoord(body.lat, body.lng)) {
    return NextResponse.json({ ok: false, error: "مختصات نامعتبر است" }, { status: 400 });
  }

  // A slug must be unique, stable, and can never collide with one a future row might
  // introduce -- hence the reserved "site-" prefix rather than one derived from the name.
  // (Deriving it from the name is also what made Persian names a problem: they slugify badly
  // and nobody should be typing slugs.)
  const fresh = `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const restore = await resolveRestore(body.restore);
  const slug = restore?.slug ?? fresh;

  // Validated against the KIND's options rather than accepted as-is: the column names a
  // silhouette, and a typo would otherwise store a key no renderer can resolve. An
  // unrecognised key falls back to the kind's default rather than failing the add, because
  // the place itself is the thing the user asked for -- the shape is decoration.
  const kind = body.kind as FacilityKind;
  const iconKey =
    typeof body.icon_key === "string" && FACILITY_ICONS[kind]?.includes(body.icon_key)
      ? body.icon_key
      : defaultIconFor(kind);

  // A site a manager adds is theirs. An owner adds one for the company, with no group.
  const id = await insertFacility({
    restoreId: restore?.id ?? null, // NULL on an INTEGER PRIMARY KEY still autoincrements
    slug,
    kind,
    name,
    iconKey,
    address: body.address ?? null,
    lat: body.lat,
    lng: body.lng,
    mapsUrl: body.maps_url ?? null,
    notes: body.notes ?? null,
    groupId: guard.session.groupId,
    organizationId: guard.session.organizationId,
  });

  return NextResponse.json({ ok: true, id, restored: restore !== null });
}
