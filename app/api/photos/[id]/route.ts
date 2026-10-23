import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { deletePhoto, findPhoto } from "@/lib/repo/photosAdmin";
import { photoFilePath } from "@/lib/photos";
import { canReachEntity, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/photos/[id]">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const photoId = Number(id);
  if (!Number.isInteger(photoId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }
  const row = await findPhoto(photoId);
  if (row && !await canReachEntity(guard.session, row.entity_type, row.entity_id)) {
    return NextResponse.json({ ok: false, error: "عکس پیدا نشد" }, { status: 404 });
  }
  if (!row) {
    return NextResponse.json({ ok: false, error: "عکس پیدا نشد" }, { status: 404 });
  }
  await deletePhoto(photoId);
  await Promise.all([
    fs.unlink(photoFilePath(row.file_stem, "avif")).catch(() => {}),
    fs.unlink(photoFilePath(row.file_stem, "webp")).catch(() => {}),
  ]);
  return NextResponse.json({ ok: true });
}
