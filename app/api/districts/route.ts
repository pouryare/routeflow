import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { districtsSignature, insertCustomDistrict } from "@/lib/repo/districtsAdmin";
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

  const sig = districtsSignature();
  // Scope is part of the tag -- see the note in /api/customers.
  const tag = etagFor(`districts:${scope === "all" ? "all" : scope.join(",")}`, sig.c, sig.m);
  const cached = notModified(req, tag);
  if (cached) return cached;

  return etagJson(req, tag, { version: geometryVersion(), districts: readDistrictProperties(getDb(), scope) });
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

  try {
    // A custom district carries no organization_id (districts are shared geography); the group_id
    // is what scopes it for territory. See insertCustomDistrict for why parent_name is ''.
    const id = insertCustomDistrict(name.trim(), geometry, status, notes ?? null, guard.session.groupId);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: false, error: "منطقه‌ای با این نام از قبل وجود دارد" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
