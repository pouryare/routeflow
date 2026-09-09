import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { getSession } from "@/lib/session";
import { photoFilePath } from "@/lib/photos";
import { canViewUserAvatar } from "@/lib/avatarAccess";
import { getUserAvatar, getUserOrgId } from "@/lib/repo/avatars";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/users/[id]/avatar/file">) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });

  const { id } = await ctx.params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }

  const targetOrgId = getUserOrgId(targetId);
  if (targetOrgId === undefined || !canViewUserAvatar(session, targetOrgId)) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  const row = getUserAvatar(targetId);
  if (!row) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });

  const format = new URL(req.url).searchParams.get("format") === "avif" ? "avif" : "webp";
  try {
    const buffer = await fs.readFile(photoFilePath(row.file_stem, format));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": format === "avif" ? "image/avif" : "image/webp",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "فایل تصویر پیدا نشد" }, { status: 404 });
  }
}
