import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { readFile } from "@/lib/storage/files";
import { cacheGet, cachePut } from "@/lib/storage/cache";
import { encodeThumb } from "@/lib/imagePipeline";
import { findContentImage } from "@/lib/repo/contentImages";
import { ROLES } from "@/lib/roles";

/** The picture itself, for anyone signed in to the company that owns it (lessons and products are read by
 *  every role). `?size=thumb` is a small WebP for lists, made the first time and kept in the file cache. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/content-images/[id]/file">) {
  const guard = await requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  const row = await findContentImage(guard.session.organizationId, id);
  if (!row) return NextResponse.json({ ok: false, error: "تصویر پیدا نشد" }, { status: 404 });

  const thumb = new URL(req.url).searchParams.get("size") === "thumb";
  let buffer: Buffer | null;
  if (thumb) {
    buffer = await cacheGet(row.file_stem, "th");
    if (!buffer) {
      const full = await readFile(row.file_stem, "webp", "photo");
      if (full) {
        buffer = await encodeThumb(full);
        await cachePut(row.file_stem, "th", buffer);
      }
    }
  } else {
    buffer = await readFile(row.file_stem, "webp", "photo");
  }
  if (!buffer) return NextResponse.json({ ok: false, error: "فایل تصویر پیدا نشد" }, { status: 404 });
  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
