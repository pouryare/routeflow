import { NextRequest, NextResponse } from "next/server";
import { getDb, LOCATION_STATUSES, LocationStatus } from "@/lib/db";
import { isValidCoord } from "@/lib/geoLinks";

interface PatchInput {
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
