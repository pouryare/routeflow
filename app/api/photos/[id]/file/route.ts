import { NextRequest, NextResponse } from "next/server";
import { findPhoto } from "@/lib/repo/photosAdmin";
import { readFile } from "@/lib/storage/files";
import { cacheGet, cachePut } from "@/lib/storage/cache";
import { encodeThumb } from "@/lib/imagePipeline";
import { canReachEntity, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

// The image bytes themselves, so this needs the same check as the metadata route --
// otherwise another group's photo is one guessed id away.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/photos/[id]/file">) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "rep_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const photoId = Number(id);
  if (!Number.isInteger(photoId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "avif" ? "avif" : "webp";
  const thumb = sp.get("size") === "thumb";

  const row = await findPhoto(photoId);
  if (row && !await canReachEntity(guard.session, row.entity_type, row.entity_id)) {
    return NextResponse.json({ ok: false, error: "عکس پیدا نشد" }, { status: 404 });
  }
  if (!row) {
    return NextResponse.json({ ok: false, error: "عکس پیدا نشد" }, { status: 404 });
  }

  const kind = (row.entity_type as string) === "payment" ? "receipt" : "photo";
  let buffer: Buffer | null;
  if (thumb) {
    // ?size=thumb: a small WebP for grids, made from the stored photo the first time and kept in the
    // file cache after (works for photos taken before thumbnails existed, no backfill needed).
    buffer = await cacheGet(row.file_stem, "th");
    if (!buffer) {
      const full = await readFile(row.file_stem, "webp", kind);
      if (full) {
        buffer = await encodeThumb(full);
        await cachePut(row.file_stem, "th", buffer);
      }
    }
  } else {
    buffer = await readFile(row.file_stem, format, kind);
  }
  if (!buffer) return NextResponse.json({ ok: false, error: "فایل تصویر پیدا نشد" }, { status: 404 });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": format === "avif" && !thumb ? "image/avif" : "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
