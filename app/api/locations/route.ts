import { NextRequest, NextResponse } from "next/server";
import type { LocationResolution } from "@/lib/db";
import { addLocations, locationsSignature, searchLocations, type NewPin } from "@/lib/repo/locationsAdmin";
import { etagFor, etagJson, notModified } from "@/lib/httpCache";
import { groupFilter, orgScopeId, requireRole, scopeGroupIds } from "@/lib/session";
import { PIN_POOL_ROLES } from "@/lib/roles";

// saved_locations is option 1 (spec §2.3 / Task 8): a pin belongs outright to the group
// that dropped it, so the table carries its own group_id, stamped on insert.
export async function GET(req: NextRequest) {
  const guard = requireRole(req, PIN_POOL_ROLES);
  if (!guard.ok) return guard.response;
  const filter = groupFilter(guard.session);
  const scope = scopeGroupIds(guard.session);

  const organizationId = orgScopeId(guard.session);
  const q = req.nextUrl.searchParams.get("q")?.trim();

  const sig = locationsSignature(organizationId);
  // Scope belongs in the cache key -- see the note in /api/customers.
  const tag = etagFor(`saved_locations-${q ?? ""}-${scope === "all" ? "all" : scope.join(",")}`, sig.c, sig.m);
  const cached = notModified(req, tag);
  if (cached) return cached;

  const rows = searchLocations(q, filter, organizationId);

  return etagJson(req, tag, { locations: rows });
}

interface NewLocationInput {
  name?: string;
  mapsUrl?: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  resolution?: LocationResolution;
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, PIN_POOL_ROLES);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const items = (body as { items?: NewLocationInput[] } | null)?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ ok: false, error: "موردی برای افزودن ارسال نشده است" }, { status: 400 });
  }

  const VALID_RESOLUTIONS = new Set<LocationResolution>(["direct", "pluscode", "browser", "nominatim", "manual", "unresolved"]);

  const pins: NewPin[] = [];
  for (const it of items) {
    if (!it.name || !it.mapsUrl) continue;
    pins.push({
      name: it.name.trim(),
      mapsUrl: it.mapsUrl,
      address: it.address ?? null,
      lat: typeof it.lat === "number" ? it.lat : null,
      lng: typeof it.lng === "number" ? it.lng : null,
      resolution: it.resolution && VALID_RESOLUTIONS.has(it.resolution) ? it.resolution : "unresolved",
    });
  }

  let added: number;
  try {
    // An owner's pin is unowned until territory says otherwise; a manager's is theirs.
    added = addLocations(pins, guard.session.groupId, guard.session.organizationId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true, added, skipped: items.length - added });
}
