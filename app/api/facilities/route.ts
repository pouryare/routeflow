import { NextRequest, NextResponse } from "next/server";
import { FACILITY_KINDS, FacilityKind, getDb } from "@/lib/db";
import { readFacilities } from "@/lib/facilities";
import { etagFor, etagJson, notModified } from "@/lib/httpCache";
import { isValidCoord } from "@/lib/geoLinks";

export async function GET(req: NextRequest) {
  const db = getDb();
  // COUNT + MAX(updated_at) is the same cheap signature the districts and locations
  // lists use. updated_at is what makes a pin move invalidate the tag -- without it a
  // repositioned site would keep serving its old coordinates behind a 304.
  const sig = db.prepare("SELECT COUNT(*) c, MAX(updated_at) m FROM facilities").get() as {
    c: number;
    m: string | null;
  };
  const tag = etagFor("facilities", sig.c, sig.m);
  const cached = notModified(req, tag);
  if (cached) return cached;

  return etagJson(req, tag, { facilities: readFacilities(db) });
}

interface NewFacilityInput {
  name?: string;
  kind?: string;
  lat?: number;
  lng?: number;
  address?: string | null;
  maps_url?: string | null;
  notes?: string | null;
}

export async function POST(req: NextRequest) {
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

  // Seeded rows carry meaningful slugs ("home-pardis") because the seed has to find them
  // again on every boot. A user-created site only needs a slug that is unique and stable,
  // and that can never collide with a slug a future seed might introduce -- hence the
  // reserved "site-" prefix rather than one derived from the name.
  const slug = `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  // A new site never takes the default origin. Moving it is an explicit choice the user
  // makes in the editor, not a side effect of adding a location.
  const result = getDb()
    .prepare(
      `INSERT INTO facilities (slug, kind, name, address, lat, lng, maps_url, notes, is_default_origin, owner_username, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`
    )
    .run(
      slug,
      body.kind as FacilityKind,
      name,
      body.address ?? null,
      body.lat,
      body.lng,
      body.maps_url ?? null,
      body.notes ?? null,
      now,
      now
    );

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}
