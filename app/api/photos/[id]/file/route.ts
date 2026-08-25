import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { getDb, Photo } from "@/lib/db";
import { photoFilePath } from "@/lib/photos";
import { canReachEntity, requireRole } from "@/lib/session";

// The image bytes themselves, so this needs the same check as the metadata route --
// otherwise another group's photo is one guessed id away.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/photos/[id]/file">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const photoId = Number(id);
  if (!Number.isInteger(photoId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }
  const format = new URL(req.url).searchParams.get("format") === "avif" ? "avif" : "webp";

  const db = getDb();
  const row = db.prepare("SELECT * FROM photos WHERE id = ?").get(photoId) as Photo | undefined;
  if (row && !canReachEntity(guard.session, db, row.entity_type, row.entity_id)) {
    return NextResponse.json({ ok: false, error: "عکس پیدا نشد" }, { status: 404 });
  }
  if (!row) {
    return NextResponse.json({ ok: false, error: "عکس پیدا نشد" }, { status: 404 });
  }

  try {
    const buffer = await fs.readFile(photoFilePath(row.file_stem, format));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": format === "avif" ? "image/avif" : "image/webp",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "فایل تصویر پیدا نشد" }, { status: 404 });
  }
}
