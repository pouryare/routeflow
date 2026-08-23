import { NextRequest, NextResponse } from "next/server";
import { FACILITY_KINDS, FacilityKind, getDb } from "@/lib/db";
import { isValidCoord } from "@/lib/geoLinks";

interface PatchInput {
  name?: string;
  kind?: string;
  lat?: number;
  lng?: number;
  address?: string | null;
  notes?: string | null;
  is_default_origin?: boolean;
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/facilities/[id]">) {
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
  const exists = db.prepare("SELECT id FROM facilities WHERE id = ?").get(idNum);
  if (!exists) {
    return NextResponse.json({ ok: false, error: "مکان پیدا نشد" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ ok: false, error: "نام مکان نمی‌تواند خالی باشد" }, { status: 400 });
    }
    sets.push("name = ?");
    values.push(name);
  }

  if (body.kind !== undefined) {
    if (!FACILITY_KINDS.includes(body.kind as FacilityKind)) {
      return NextResponse.json({ ok: false, error: "نوع مکان نامعتبر است" }, { status: 400 });
    }
    sets.push("kind = ?");
    values.push(body.kind as FacilityKind);
  }

  if (body.lat !== undefined || body.lng !== undefined) {
    if (typeof body.lat !== "number" || typeof body.lng !== "number" || !isValidCoord(body.lat, body.lng)) {
      return NextResponse.json({ ok: false, error: "مختصات نامعتبر است" }, { status: 400 });
    }
    sets.push("lat = ?", "lng = ?");
    values.push(body.lat, body.lng);
  }

  if (body.address !== undefined) {
    sets.push("address = ?");
    values.push(body.address);
  }

  if (body.notes !== undefined) {
    sets.push("notes = ?");
    values.push(body.notes);
  }

  // The default-origin flag moves by being set on another site, never by being cleared
  // here: clearing it would leave the app with no origin at all, which strands every
  // distance it computes. Enforced as a rejection rather than a silent no-op so the UI
  // can explain what to do instead.
  if (body.is_default_origin === false) {
    return NextResponse.json(
      { ok: false, error: "برای تغییر مبدأ، مکان دیگری را به‌عنوان مبدأ پیش‌فرض انتخاب کنید" },
      { status: 400 }
    );
  }

  if (sets.length === 0 && body.is_default_origin !== true) {
    return NextResponse.json({ ok: false, error: "چیزی برای به‌روزرسانی ارسال نشده است" }, { status: 400 });
  }

  // Both statements run inside one transaction so a failure between them cannot leave
  // the table with zero origins (or two). See spec §1.1 for why this is enforced in the
  // write path rather than by a partial unique index.
  db.exec("BEGIN");
  try {
    if (sets.length > 0) {
      sets.push("updated_at = ?");
      values.push(now);
      db.prepare(`UPDATE facilities SET ${sets.join(", ")} WHERE id = ?`).run(...values, idNum);
    }
    if (body.is_default_origin === true) {
      db.prepare("UPDATE facilities SET is_default_origin = 0, updated_at = ? WHERE is_default_origin = 1").run(now);
      db.prepare("UPDATE facilities SET is_default_origin = 1, updated_at = ? WHERE id = ?").run(now, idNum);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    const msg = e instanceof Error ? e.message : "خطا در به‌روزرسانی مکان";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/facilities/[id]">) {
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  const row = db.prepare("SELECT is_default_origin FROM facilities WHERE id = ?").get(idNum) as
    | { is_default_origin: number }
    | undefined;
  if (!row) {
    return NextResponse.json({ ok: false, error: "مکان پیدا نشد" }, { status: 404 });
  }

  // Every distance in the app is measured from a site. Deleting the last one would
  // leave nothing to measure from, so it is refused rather than handled downstream.
  const total = (db.prepare("SELECT COUNT(*) c FROM facilities").get() as { c: number }).c;
  if (total <= 1) {
    return NextResponse.json({ ok: false, error: "آخرین مکان را نمی‌توان حذف کرد" }, { status: 400 });
  }

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM facilities WHERE id = ?").run(idNum);
    // Deleting the origin promotes a replacement in the same transaction -- preferring a
    // home base, then the oldest remaining site -- so the app is never left without one.
    if (row.is_default_origin === 1) {
      db.prepare(
        `UPDATE facilities SET is_default_origin = 1, updated_at = ?
         WHERE id = (SELECT id FROM facilities ORDER BY CASE kind WHEN 'home_base' THEN 0 ELSE 1 END, id LIMIT 1)`
      ).run(now);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    const msg = e instanceof Error ? e.message : "خطا در حذف مکان";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
