import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import sharp from "sharp";
import { getDb, Photo, EntityType, logActivity } from "@/lib/db";
import { getActorName } from "@/lib/auth";
import { ensurePhotosDir, photoFilePath } from "@/lib/photos";

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entity_type");
  const entityId = searchParams.get("entity_id");

  let rows: Photo[];
  if (entityType && entityId) {
    rows = db
      .prepare("SELECT * FROM photos WHERE entity_type = ? AND entity_id = ? ORDER BY taken_at DESC")
      .all(entityType, Number(entityId)) as unknown as Photo[];
  } else {
    rows = db.prepare("SELECT * FROM photos ORDER BY taken_at DESC LIMIT 500").all() as unknown as Photo[];
  }

  // enrich with a display label for the standalone /gallery browse view
  const customerIds = rows.filter((r) => r.entity_type === "customer").map((r) => r.entity_id);
  const districtIds = rows.filter((r) => r.entity_type === "district").map((r) => r.entity_id);
  const customerMap = new Map<number, string>();
  const districtMap = new Map<number, string>();
  if (customerIds.length) {
    const placeholders = customerIds.map(() => "?").join(",");
    (db.prepare(`SELECT id, business_name FROM customers WHERE id IN (${placeholders})`).all(...customerIds) as { id: number; business_name: string }[]).forEach(
      (r) => customerMap.set(r.id, r.business_name)
    );
  }
  if (districtIds.length) {
    const placeholders = districtIds.map(() => "?").join(",");
    (db.prepare(`SELECT id, name FROM districts WHERE id IN (${placeholders})`).all(...districtIds) as { id: number; name: string }[]).forEach(
      (r) => districtMap.set(r.id, r.name)
    );
  }

  const photos = rows.map((r) => ({
    ...r,
    label: r.entity_type === "customer" ? customerMap.get(r.entity_id) ?? "مشتری حذف‌شده" : districtMap.get(r.entity_id) ?? "منطقه حذف‌شده",
  }));

  return NextResponse.json({ ok: true, photos });
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB -- generous for a phone camera photo

export async function POST(req: NextRequest) {
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
    const pipeline = sharp(inputBuffer)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true });
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
  const db = getDb();
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
    changed_by: getActorName(req),
  });

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid), file_stem: stem });
}
