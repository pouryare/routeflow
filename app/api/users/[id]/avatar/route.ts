import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import sharp from "sharp";
import { getSession } from "@/lib/session";
import { ensurePhotosDir, photoFilePath } from "@/lib/photos";
import { deleteUserAvatar, replaceUserAvatar } from "@/lib/repo/avatars";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // a phone selfie, not a DSLR RAW

/** Self-only: no admin-uploads-for-others path in v1 (matches the workflow-template
 *  decision's "no admin CRUD" minimalism, spec §15 decision 6). */
function guardSelf(req: NextRequest, targetId: number) {
  const session = getSession(req);
  if (!session) return { ok: false as const, response: NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 }) };
  if (session.user.id !== targetId) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "فقط تصویر پروفایل خودتان" }, { status: 403 }) };
  }
  return { ok: true as const, session };
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/users/[id]/avatar">) {
  const { id } = await ctx.params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  const guard = guardSelf(req, targetId);
  if (!guard.ok) return guard.response;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "فایلی انتخاب نشده است" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "فقط فایل تصویر پذیرفته می‌شود" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "حجم فایل نباید بیش از ۸ مگابایت باشد" }, { status: 413 });
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());
  const stem = crypto.randomUUID();

  let avifBuffer: Buffer;
  let webpBuffer: Buffer;
  try {
    // "attention"-cropped to 512x512: an avatar is always shown square/circular, so
    // fit:"cover" (not the gallery pipeline's fit:"inside") -- and "attention" biases
    // the crop toward the most visually interesting region, which is usually a face.
    const pipeline = sharp(inputBuffer)
      .rotate()
      .resize({ width: 512, height: 512, fit: "cover", position: "attention" });
    [avifBuffer, webpBuffer] = await Promise.all([
      pipeline.clone().avif({ quality: 60 }).toBuffer(),
      pipeline.clone().webp({ quality: 78 }).toBuffer(),
    ]);
  } catch {
    return NextResponse.json({ ok: false, error: "فایل تصویر قابل پردازش نیست" }, { status: 422 });
  }

  ensurePhotosDir();
  await fs.writeFile(photoFilePath(stem, "avif"), avifBuffer);
  await fs.writeFile(photoFilePath(stem, "webp"), webpBuffer);

  const now = new Date().toISOString();
  const { id: insertedId, priorFileStem } = replaceUserAvatar(targetId, stem, now);

  // Best-effort cleanup of the file this row replaced -- never lets a storage-cleanup
  // failure fail the request that already succeeded in the database.
  if (priorFileStem) {
    await Promise.all([
      fs.unlink(photoFilePath(priorFileStem, "avif")).catch(() => {}),
      fs.unlink(photoFilePath(priorFileStem, "webp")).catch(() => {}),
    ]);
  }

  return NextResponse.json({ ok: true, id: insertedId, file_stem: stem });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/users/[id]/avatar">) {
  const { id } = await ctx.params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  const guard = guardSelf(req, targetId);
  if (!guard.ok) return guard.response;

  const row = deleteUserAvatar(targetId);
  if (!row) return NextResponse.json({ ok: true }); // nothing to delete -- harmless no-op

  await Promise.all([
    fs.unlink(photoFilePath(row.file_stem, "avif")).catch(() => {}),
    fs.unlink(photoFilePath(row.file_stem, "webp")).catch(() => {}),
  ]);
  return NextResponse.json({ ok: true });
}
