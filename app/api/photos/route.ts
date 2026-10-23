import { NextRequest, NextResponse } from "next/server";
import { encodeImage, PHOTO_MAX_EDGE } from "@/lib/imagePipeline";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { EntityType } from "@/lib/db";
import { addPhoto, listPhotos } from "@/lib/repo/photosAdmin";
import { canReachEntity, entityGroupFilter, requireRole } from "@/lib/session";
import { ensurePhotosDir, photoFilePath } from "@/lib/photos";
import { MANAGE_ROLES } from "@/lib/roles";

// photos is option 2: a photo is *of* a customer, district or facility, so it inherits
// that row's group rather than carrying one of its own.
// Reading is scoped by entityGroupFilter below; uploading stays with managers.
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "rep_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;
  const f = await entityGroupFilter(guard.session, "p");

  const { searchParams } = new URL(req.url);
  const photos = await listPhotos(f, searchParams.get("entity_type"), searchParams.get("entity_id"));

  return NextResponse.json({ ok: true, photos });
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB -- generous for a phone camera photo

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const entityType = formData?.get("entity_type") as EntityType | null;
  const entityId = Number(formData?.get("entity_id"));
  const caption = (formData?.get("caption") as string | null) ?? null;

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "فایلی انتخاب نشده است" }, { status: 400 });
  }
  if (entityType !== "district" && entityType !== "customer") {
    return NextResponse.json({ ok: false, error: "نوع موجودیت نامعتبر است" }, { status: 400 });
  }
  if (!Number.isInteger(entityId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "فقط فایل تصویر پذیرفته می‌شود" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "حجم فایل نباید بیش از ۲۰ مگابایت باشد" }, { status: 413 });
  }

  // Checked before anything is encoded or written: a refused upload must not leave files behind.
  if (!await canReachEntity(guard.session, entityType, entityId)) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());
  const stem = crypto.randomUUID();

  let avifBuffer: Buffer;
  let webpBuffer: Buffer;
  try {
    // The encoding itself lives in lib/imagePipeline because avatars run through the
    // exact same treatment. One implementation, so the two cannot drift apart.
    ({ avif: avifBuffer, webp: webpBuffer } = await encodeImage(inputBuffer, PHOTO_MAX_EDGE));
  } catch {
    return NextResponse.json({ ok: false, error: "فایل تصویر قابل پردازش نیست" }, { status: 422 });
  }

  ensurePhotosDir();
  await fs.writeFile(photoFilePath(stem, "avif"), avifBuffer);
  await fs.writeFile(photoFilePath(stem, "webp"), webpBuffer);

  const id = await addPhoto(entityType, entityId, stem, caption, { name: guard.session.user.display_name, id: guard.session.user.id });

  return NextResponse.json({ ok: true, id, file_stem: stem });
}
