import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { getDb, Photo } from "@/lib/db";
import { photoFilePath } from "@/lib/photos";

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/photos/[id]">) {
  const { id } = await ctx.params;
  const photoId = Number(id);
  if (!Number.isInteger(photoId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }
  const db = getDb();
  const row = db.prepare("SELECT * FROM photos WHERE id = ?").get(photoId) as Photo | undefined;
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
