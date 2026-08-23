import { NextRequest, NextResponse } from "next/server";
import { getDb, LOCATION_STATUSES, LocationStatus } from "@/lib/db";
import { isValidCoord } from "@/lib/geoLinks";
import { LEAD_CRITERIA, LeadCriterion, columnFor, isValidStars } from "@/lib/leadScore";

interface PatchInput extends Partial<Record<LeadCriterion, number | null>> {
  lat?: number;
  lng?: number;
  status?: LocationStatus | null;
  notes?: string | null;
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/locations/[id]">) {
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as PatchInput | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "بدنه درخواست نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.lat !== undefined || body.lng !== undefined) {
    if (typeof body.lat !== "number" || typeof body.lng !== "number" || !isValidCoord(body.lat, body.lng)) {
      return NextResponse.json({ ok: false, error: "مختصات نامعتبر است" }, { status: 400 });
    }
    sets.push("lat = ?", "lng = ?", "resolution = 'manual'");
    values.push(body.lat, body.lng);
  }

  if (body.status !== undefined) {
    if (body.status !== null && !LOCATION_STATUSES.includes(body.status)) {
      return NextResponse.json({ ok: false, error: "وضعیت نامعتبر است" }, { status: 400 });
    }
    sets.push("status = ?");
    values.push(body.status);
  }

  if (body.notes !== undefined) {
    sets.push("notes = ?");
    values.push(body.notes);
  }

  // Scores arrive one criterion at a time -- a star is tapped, not a form submitted --
  // so each is independently optional and null clears it. Column names come from
  // columnFor rather than from the request, which is what keeps this an update of three
  // known columns instead of whatever the caller names.
  for (const criterion of LEAD_CRITERIA) {
    const value = body[criterion.key];
    if (value === undefined) continue;
    if (!isValidStars(value)) {
      return NextResponse.json({ ok: false, error: "امتیاز نامعتبر است" }, { status: 400 });
    }
    sets.push(`${columnFor(criterion.key)} = ?`);
    values.push(value);
  }

  if (sets.length === 0) {
    return NextResponse.json({ ok: false, error: "چیزی برای به‌روزرسانی ارسال نشده است" }, { status: 400 });
  }

  sets.push("updated_at = ?");
  values.push(new Date().toISOString());

  const result = db.prepare(`UPDATE saved_locations SET ${sets.join(", ")} WHERE id = ?`).run(...values, idNum);
  if (result.changes === 0) {
    return NextResponse.json({ ok: false, error: "مورد پیدا نشد" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/locations/[id]">) {
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare("DELETE FROM saved_locations WHERE id = ?").run(idNum);
  if (result.changes === 0) {
    return NextResponse.json({ ok: false, error: "مورد پیدا نشد" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
