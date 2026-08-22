import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parsePastedChat } from "@/lib/pasteImport";
import { resolveMapsLinks } from "@/lib/resolveMapsLink";
import { placeNameFromAddress } from "@/lib/geoLinks";
import { distanceKm } from "@/lib/geo";

// Shown for a link that resolved to no address at all, so it still appears in the
// preview to be pinned and renamed by hand instead of vanishing from the import.
const UNNAMED_LOCATION = "مکان بدون نام";

// Within this radius, two pins are treated as "the same physical venue" regardless of
// name spelling -- generous enough to survive GPS/geocoding noise on a single building,
// tight enough that it never flags two different customers on the same street.
const DUPLICATE_RADIUS_KM = 0.15;

function normalizeName(s: string): string {
  return s.replace(/[\s‌‌]+/g, " ").trim().toLowerCase();
}

function namesLikelySame(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

interface DuplicateCandidate {
  name: string;
  lat: number | null;
  lng: number | null;
}

function findDuplicate(
  name: string,
  lat: number | null,
  lng: number | null,
  pools: { kind: "location" | "customer"; rows: DuplicateCandidate[] }[]
): { kind: "location" | "customer"; name: string } | null {
  for (const pool of pools) {
    for (const row of pool.rows) {
      if (namesLikelySame(name, row.name)) return { kind: pool.kind, name: row.name };
      if (lat !== null && lng !== null && row.lat !== null && row.lng !== null) {
        if (distanceKm({ lat, lng }, { lat: row.lat, lng: row.lng }) <= DUPLICATE_RADIUS_KM) {
          return { kind: pool.kind, name: row.name };
        }
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
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
  const existing = db.prepare("SELECT maps_url FROM saved_locations WHERE maps_url = ?");
  const savedLocationPool = db
    .prepare("SELECT name, lat, lng FROM saved_locations")
    .all() as unknown as DuplicateCandidate[];
  const customerPool = db
    .prepare("SELECT business_name AS name, lat, lng FROM customers")
    .all() as unknown as DuplicateCandidate[];

  const resolved = await resolveMapsLinks(
    items.map((it) => it.mapsUrl),
    items.map((it) => it.name)
  );

  const preview = items.map((it, i) => {
    const r = resolved[i];
    // A link pasted with no name of its own (a bare list of links, the shape a coworker's
    // "here are the venues" message usually arrives in) is named from the venue name Google
    // itself carries in the resolved place address.
    const name = it.name || (r.address ? placeNameFromAddress(r.address) : null) || UNNAMED_LOCATION;
    const alreadySaved = !!existing.get(it.mapsUrl);
    const duplicateOf = alreadySaved
      ? null
      : findDuplicate(name, r.lat, r.lng, [
          { kind: "location", rows: savedLocationPool },
          { kind: "customer", rows: customerPool },
        ]);
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
      duplicateOf,
    };
  });

  return NextResponse.json({ ok: true, items: preview });
}
