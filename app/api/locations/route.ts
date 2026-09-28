import { NextRequest, NextResponse } from "next/server";
import { getDb, LocationResolution, SavedLocationRow } from "@/lib/db";
import { etagFor, etagJson, notModified } from "@/lib/httpCache";
import { groupFilter, requireRole, scopeGroupIds } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

// saved_locations is option 1 (spec §2.3 / Task 8): a pin belongs outright to the group
// that dropped it, so the table carries its own group_id, stamped on insert.
export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const filter = groupFilter(guard.session);
  const scope = scopeGroupIds(guard.session);

  const db = getDb();
  const q = req.nextUrl.searchParams.get("q")?.trim();

  const sig = db.prepare("SELECT COUNT(*) c, MAX(updated_at) m FROM saved_locations").get() as {
    c: number;
    m: string | null;
  };
  // Scope belongs in the cache key -- see the note in /api/customers.
  const tag = etagFor(`saved_locations-${q ?? ""}-${scope === "all" ? "all" : scope.join(",")}`, sig.c, sig.m);
  const cached = notModified(req, tag);
  if (cached) return cached;

  const rows = q
    ? (db
        .prepare(
          `SELECT * FROM saved_locations WHERE (name LIKE ? OR address LIKE ?)${filter.sql} ORDER BY created_at DESC`
        )
        .all(`%${q}%`, `%${q}%`, ...filter.params) as unknown as SavedLocationRow[])
    : (db
        .prepare(`SELECT * FROM saved_locations WHERE 1 = 1${filter.sql} ORDER BY created_at DESC`)
        .all(...filter.params) as unknown as SavedLocationRow[]);

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
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const items = (body as { items?: NewLocationInput[] } | null)?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ ok: false, error: "موردی برای افزودن ارسال نشده است" }, { status: 400 });
  }

  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO saved_locations (name, maps_url, address, lat, lng, resolution, group_id, created_at, updated_at, organization_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(organization_id, maps_url) DO NOTHING
  `);

  const VALID_RESOLUTIONS = new Set<LocationResolution>(["direct", "pluscode", "browser", "nominatim", "manual", "unresolved"]);

  let added = 0;
  db.exec("BEGIN");
  try {
    for (const it of items) {
      if (!it.name || !it.mapsUrl) continue;
      const resolution: LocationResolution =
        it.resolution && VALID_RESOLUTIONS.has(it.resolution) ? it.resolution : "unresolved";
      const result = insert.run(
        it.name.trim(),
        it.mapsUrl,
        it.address ?? null,
        typeof it.lat === "number" ? it.lat : null,
        typeof it.lng === "number" ? it.lng : null,
        resolution,
        // An owner's pin is unowned until territory says otherwise; a manager's is theirs.
        guard.session.groupId,
        now,
        now,
        guard.session.organizationId
      );
      if (result.changes > 0) added++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    const msg = e instanceof Error ? e.message : "خطا";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true, added, skipped: items.length - added });
}
