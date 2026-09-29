import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { etagFor, etagJson, notModified } from "@/lib/httpCache";
import { geometryVersion } from "@/lib/districtGeometry";
import { readDistrictProperties } from "@/lib/districts";
import { requireRole, scopeGroupIds } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

// Properties only -- no `boundary_geojson`. Geometry moved to the version-stamped,
// indefinitely-cached /api/districts/geometry, so this response stays around 50KB and
// a status edit no longer re-sends every polygon in the province.
export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const scope = scopeGroupIds(guard.session);

  const db = getDb();
  const sig = db.prepare("SELECT COUNT(*) c, MAX(updated_at) m FROM districts").get() as {
    c: number;
    m: string | null;
  };
  // Scope is part of the tag -- see the note in /api/customers.
  const tag = etagFor(`districts:${scope === "all" ? "all" : scope.join(",")}`, sig.c, sig.m);
  const cached = notModified(req, tag);
  if (cached) return cached;

  return etagJson(req, tag, { version: geometryVersion(), districts: readDistrictProperties(db, scope) });
}

const VALID_STATUSES = ["visited", "needs_coverage", "not_allowed", "unknown"];

export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const { name, geometry, coverage_status, notes } = body ?? {};

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ ok: false, error: "نام منطقه لازم است" }, { status: 400 });
  }
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
    return NextResponse.json({ ok: false, error: "شکل هندسی منطقه نامعتبر است" }, { status: 400 });
  }
  const status = VALID_STATUSES.includes(coverage_status) ? coverage_status : "unknown";

  const db = getDb();
  const now = new Date().toISOString();
  try {
    const result = db
      .prepare(
        `INSERT INTO districts (name, level, parent_name, boundary_geojson, coverage_status, notes, is_custom, group_id, updated_at)
         VALUES (?, 'mahalle', '', ?, ?, ?, 1, ?, ?)`
      )
      // A custom district belongs to nobody in the tenant sense: districts is shared
      // reference data, so a boundary an owner draws is visible to the whole install and
      // carries no organization_id. The group_id is what scopes it for territory -- an
      // owner's own group until territory is reassigned. parent_name is '' and not NULL
      // because UNIQUE(name, level, parent_name) treats every NULL as distinct from every
      // other NULL, so a NULL here would let a second identical draw through.
      .run(
        name.trim(),
        JSON.stringify(geometry),
        status,
        notes ?? null,
        guard.session.groupId,
        now
      );
    return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: false, error: "منطقه‌ای با این نام از قبل وجود دارد" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
