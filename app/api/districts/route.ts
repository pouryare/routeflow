import { NextRequest, NextResponse } from "next/server";
import { getDb, District } from "@/lib/db";
import { etagFor, etagJson, notModified } from "@/lib/httpCache";

export async function GET(req: NextRequest) {
  const db = getDb();
  const sig = db.prepare("SELECT COUNT(*) c, MAX(updated_at) m FROM districts").get() as {
    c: number;
    m: string | null;
  };
  const tag = etagFor("districts", sig.c, sig.m);
  const cached = notModified(req, tag);
  if (cached) return cached;

  const rows = db
    .prepare("SELECT * FROM districts ORDER BY level, parent_name, name")
    .all() as unknown as District[];

  const features = rows.map((r) => ({
    type: "Feature",
    id: r.id,
    geometry: JSON.parse(r.boundary_geojson),
    properties: {
      id: r.id,
      name: r.name,
      level: r.level,
      parent_name: r.parent_name,
      coverage_status: r.coverage_status,
      notes: r.notes,
      is_custom: !!r.is_custom,
      updated_at: r.updated_at,
      assigned_to: r.assigned_to,
    },
  }));

  return etagJson(tag, { type: "FeatureCollection", features });
}

const VALID_STATUSES = ["visited", "needs_coverage", "not_allowed", "unknown"];

export async function POST(req: NextRequest) {
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
        `INSERT INTO districts (name, level, parent_name, boundary_geojson, coverage_status, notes, is_custom, updated_at)
         VALUES (?, 'mahalle', NULL, ?, ?, ?, 1, ?)`
      )
      .run(name.trim(), JSON.stringify(geometry), status, notes ?? null, now);
    return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: false, error: "منطقه‌ای با این نام از قبل وجود دارد" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
