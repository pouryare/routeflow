import { NextRequest, NextResponse } from "next/server";
import { encodeImage, PHOTO_MAX_EDGE } from "@/lib/imagePipeline";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { getDb, Photo, EntityType, logActivity } from "@/lib/db";
import { withEntityLabels } from "@/lib/repo/entityLabels";
import { canReachEntity, entityGroupFilter, requireRole } from "@/lib/session";
import { ensurePhotosDir, photoFilePath } from "@/lib/photos";
import { MANAGE_ROLES } from "@/lib/roles";

// photos is option 2: a photo is *of* a customer, district or facility, so it inherits
// that row's group rather than carrying one of its own.
export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const f = entityGroupFilter(guard.session, "p");

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entity_type");
  const entityId = searchParams.get("entity_id");

  let rows: Photo[];
  if (entityType && entityId) {
    rows = db
      .prepare(
        `SELECT p.* FROM photos p${f.joins} WHERE p.entity_type = ? AND p.entity_id = ?${f.sql} ORDER BY p.taken_at DESC`
      )
      .all(entityType, Number(entityId), ...f.params) as unknown as Photo[];
  } else {
    rows = db
      .prepare(`SELECT p.* FROM photos p${f.joins} WHERE 1 = 1${f.sql} ORDER BY p.taken_at DESC LIMIT 500`)
      .all(...f.params) as unknown as Photo[];
  }

  // enrich with a display label for the standalone /gallery browse view
  const photos = withEntityLabels(db, rows);

  return NextResponse.json({ ok: true, photos });
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB -- generous for a phone camera photo

export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
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

  const now = new Date().toISOString();
  const db = getDb();
  if (!canReachEntity(guard.session, db, entityType, entityId)) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  const result = db
    .prepare(
      `INSERT INTO photos (entity_type, entity_id, file_stem, caption, taken_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(entityType, entityId, stem, caption, now, now);

  logActivity(db, {
    entity_type: entityType,
    entity_id: entityId,
    event_type: "note",
    old_value: null,
    new_value: null,
    note: "عکس جدید اضافه شد",
    changed_by: guard.session.user.display_name,
    changed_by_user_id: guard.session.user.id,
  });

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid), file_stem: stem });
}
