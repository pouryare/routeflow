import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { encodeImage, PHOTO_MAX_EDGE } from "@/lib/imagePipeline";
import { requireRole } from "@/lib/session";
import { saveFile, storageRefusal } from "@/lib/storage/files";
import { canAuthorLessons } from "@/lib/repo/academyLessons";
import { addContentImage } from "@/lib/repo/contentImages";
import { ROLES } from "@/lib/roles";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** A picture for a lesson or a product. Whoever may write lessons (owner, manager, trainer) may add one;
 *  the encoding and the company's storage are the same as for photos (app/api/photos). */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  if (!canAuthorLessons(guard.session)) return NextResponse.json({ ok: false, error: "اجازهٔ افزودن تصویر ندارید" }, { status: 403 });

  const file = (await req.formData().catch(() => null))?.get("file");
  if (!file || !(file instanceof File)) return NextResponse.json({ ok: false, error: "فایلی انتخاب نشده است" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ ok: false, error: "فقط فایل تصویر پذیرفته می‌شود" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ ok: false, error: "حجم فایل نباید بیش از ۲۰ مگابایت باشد" }, { status: 413 });

  let encoded: { avif: Buffer; webp: Buffer };
  try {
    encoded = await encodeImage(Buffer.from(await file.arrayBuffer()), PHOTO_MAX_EDGE);
  } catch {
    return NextResponse.json({ ok: false, error: "فایل تصویر قابل پردازش نیست" }, { status: 422 });
  }
  const stem = crypto.randomUUID();
  try {
    await saveFile(guard.session.organizationId, "photo", stem, [
      { ext: "avif", body: encoded.avif, contentType: "image/avif" },
      { ext: "webp", body: encoded.webp, contentType: "image/webp" },
    ]);
  } catch (e) {
    const r = storageRefusal(e);
    if (r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    throw e;
  }
  const id = await addContentImage(guard.session.organizationId, stem, guard.session.user.id);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
