import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { getDb, Photo } from "@/lib/db";
import { photoFilePath } from "@/lib/photos";
import { canReachEntity, requireRole } from "@/lib/session";

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/photos/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const photoId = Number(id);
  if (!Number.isInteger(photoId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }
  const db = getDb();
  const row = db.prepare("SELECT * FROM photos WHERE id = ?").get(photoId) as Photo | undefined;
  if (row && !canReachEntity(guard.session, db, row.entity_type, row.entity_id)) {
    return NextResponse.json({ ok: false, error: "عکس پیدا نشد" }, { status: 404 });
  }
  if (!row) {
    return NextResponse.json({ ok: false, error: "عکس پیدا نشد" }, { status: 404 });
  }
  db.prepare("DELETE FROM photos WHERE id = ?").run(photoId);
  await Promise.all([
    fs.unlink(photoFilePath(row.file_stem, "avif")).catch(() => {}),
    fs.unlink(photoFilePath(row.file_stem, "webp")).catch(() => {}),
  ]);
  return NextResponse.json({ ok: true });
}
