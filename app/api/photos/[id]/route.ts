import { NextRequest, NextResponse } from "next/server";
import { deletePhoto, findPhoto } from "@/lib/repo/photosAdmin";
import { trashFile } from "@/lib/storage/files";
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
  // To the 30-day trash, with what restoring needs to put the photo back (docs/storage.md, decision 12).
  await trashFile(row.file_stem, (row.entity_type as string) === "payment" ? "receipt" : "photo", guard.session.user.id, {
    table: "photos", entity_type: row.entity_type, entity_id: row.entity_id, caption: row.caption, taken_at: row.taken_at,
  });
  return NextResponse.json({ ok: true });
}
