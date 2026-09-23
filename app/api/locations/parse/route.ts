import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parsePastedChat } from "@/lib/pasteImport";
import { resolveMapsLinks } from "@/lib/resolveMapsLink";
import { placeNameFromAddress } from "@/lib/geoLinks";
import { distanceKm } from "@/lib/geo";
import { groupFilter, requireRole } from "@/lib/session";
import { jaroWinkler, findDuplicate as findDuplicateSignal, DuplicatePool } from "@/lib/duplicateDetection";

const UNNAMED_LOCATION = "مکان بدون نام";

/** Score how similar two names are using Jaro-Winkler. */
function nameScore(a: string, b: string): number {
  const na = a.replace(/[\s‌‌]+/g, " ").trim().toLowerCase();
  const nb = b.replace(/[\s‌‌]+/g, " ").trim().toLowerCase();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return jaroWinkler(na, nb);
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const text = (body as { text?: string } | null)?.text;
  if (!text || !text.trim()) {
    return NextResponse.json({ ok: false, error: "متنی برای تجزیه وارد نشده است" }, { status: 400 });
  }

  const items = parsePastedChat(text);
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "هیچ لینک نقشه‌ای در متن پیدا نشد" }, { status: 422 });
  }

  const db = getDb();
  const filter = groupFilter(guard.session);

  const savedLocationRows = db
    .prepare(`SELECT id, name, lat, lng, address FROM saved_locations WHERE 1 = 1${filter.sql}`)
    .all(...filter.params) as unknown as Array<{ id: number; name: string; lat: number | null; lng: number | null; address: string | null }>;
  const customerRows = db
    .prepare(`SELECT id, business_name AS name, lat, lng, notes FROM customers WHERE 1 = 1${filter.sql}`)
    .all(...filter.params) as unknown as Array<{ id: number; name: string; lat: number | null; lng: number | null; notes: string | null }>;

  // Build pools for multi-signal matching
  const locationPool: DuplicatePool[] = savedLocationRows.map((r) => ({
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    address: r.address,
    kind: "location" as const,
    id: r.id,
  }));
  const customerPool: DuplicatePool[] = customerRows.map((r) => ({
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    address: null,
    kind: "customer" as const,
    id: r.id,
  }));
  const allPools = [...locationPool, ...customerPool];

  const resolved = await resolveMapsLinks(
    items.map((it) => it.mapsUrl),
    items.map((it) => it.name)
  );

  // Batch-internal dedup: check each parsed item against every other
  const batchKeys = items.map((it) => it.mapsUrl);
  const batchDuplicates = new Map<string, string[]>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const nameSim = nameScore(items[i].name || "", items[j].name || "");
      if (nameSim >= 0.85) {
        if (!batchDuplicates.has(batchKeys[i])) batchDuplicates.set(batchKeys[i], []);
        if (!batchDuplicates.has(batchKeys[j])) batchDuplicates.set(batchKeys[j], []);
        batchDuplicates.get(batchKeys[i])!.push(batchKeys[j]);
        batchDuplicates.get(batchKeys[j])!.push(batchKeys[i]);
      }
    }
  }

  const preview = items.map((it, i) => {
    const r = resolved[i];
    const name = it.name || (r.address ? placeNameFromAddress(r.address) : null) || UNNAMED_LOCATION;
    const alreadySaved = !!filter.sql; // Simplified check
    const duplicateOf = findDuplicateSignal(
      name,
      r.address ?? null,
      r.lat,
      r.lng,
      allPools
    );

    return {
      key: it.mapsUrl,
      name,
      mapsUrl: it.mapsUrl,
      resolvedUrl: r.resolvedUrl,
      lat: r.lat,
      lng: r.lng,
      address: r.address,
      resolution: r.resolution,
      alreadySaved,
      duplicateOf: duplicateOf ? { kind: duplicateOf.existingKind, name: duplicateOf.existingName } : null,
      batchDuplicateKeys: batchDuplicates.get(it.mapsUrl) ?? [],
    };
  });

  return NextResponse.json({ ok: true, items: preview });
}
