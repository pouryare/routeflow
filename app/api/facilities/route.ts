import { NextRequest, NextResponse } from "next/server";
import { FACILITY_KINDS, FacilityKind, getDb } from "@/lib/db";
import { readFacilities } from "@/lib/facilities";
import { etagFor, etagJson, notModified } from "@/lib/httpCache";
import { isValidCoord } from "@/lib/geoLinks";
import { groupFilterWithShared, requireRole, scopeGroupIds } from "@/lib/session";

// facilities is option 1 (spec §2.3 / Task 8): a site a group adds belongs to that group.
// A site with no group is company-wide -- the seeded warehouse and home origin -- and stays
// readable by everyone, because every group plans its routes out of the same depot.
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  const scope = groupFilterWithShared(guard.session);
  const scopeIds = scopeGroupIds(guard.session);

  const db = getDb();
  // COUNT + MAX(updated_at) is the same cheap signature the districts and locations
  // lists use. updated_at is what makes a pin move invalidate the tag -- without it a
  // repositioned site would keep serving its old coordinates behind a 304.
  const sig = db.prepare("SELECT COUNT(*) c, MAX(updated_at) m FROM facilities").get() as {
    c: number;
    m: string | null;
  };
  const tag = etagFor(`facilities:${scopeIds === "all" ? "all" : scopeIds.join(",")}`, sig.c, sig.m);
  const cached = notModified(req, tag);
  if (cached) return cached;

  return etagJson(req, tag, { facilities: readFacilities(db, scope) });
}

interface NewFacilityInput {
  name?: string;
  kind?: string;
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
  const guard = requireRole(req, ["owner", "group_manager"]);
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

  const db = getDb();

  // Seeded rows carry meaningful slugs ("home-pardis") because the seed has to find them
  // again on every boot. A user-created site only needs a slug that is unique and stable,
  // and that can never collide with a slug a future seed might introduce -- hence the
  // reserved "site-" prefix rather than one derived from the name.
  const fresh = `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const restore = resolveRestore(db, body.restore);
  const slug = restore?.slug ?? fresh;
  const now = new Date().toISOString();

  // A new site never takes the default origin. Moving it is an explicit choice the user
  // makes in the editor, not a side effect of adding a location.
  const result = db
    .prepare(
      `INSERT INTO facilities (id, slug, kind, name, address, lat, lng, maps_url, notes, is_default_origin, owner_username, group_id, created_at, updated_at, organization_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`
    )
    .run(
      restore?.id ?? null, // NULL on an INTEGER PRIMARY KEY still autoincrements
      slug,
      body.kind as FacilityKind,
      name,
      body.address ?? null,
      body.lat,
      body.lng,
      body.maps_url ?? null,
      body.notes ?? null,
      // A site a manager adds is theirs. An owner adds one for the company, with no group.
      guard.session.groupId,
      now,
      now,
      guard.session.organizationId
    );

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid), restored: restore !== null });
}

/** Which parts of a requested restore are actually still available. Returns null when
 *  the id has since been taken -- an undo that quietly overwrote whatever now holds that
 *  id would be worse than an undo that lands on a new id. */
function resolveRestore(
  db: ReturnType<typeof getDb>,
  wanted: NewFacilityInput["restore"]
): { id: number; slug?: string } | null {
  if (!wanted || !Number.isInteger(wanted.id)) return null;
  const id = wanted.id as number;
  const taken = db.prepare("SELECT 1 FROM facilities WHERE id = ?").get(id);
  if (taken) return null;
  if (typeof wanted.slug === "string" && wanted.slug) {
    const slugTaken = db.prepare("SELECT 1 FROM facilities WHERE slug = ?").get(wanted.slug);
    if (!slugTaken) return { id, slug: wanted.slug };
  }
  return { id };
}
