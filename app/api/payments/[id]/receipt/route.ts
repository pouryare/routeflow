import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import crypto from "node:crypto";
import sharp from "sharp";
import { requireRole } from "@/lib/session";
import { getPayment, attachReceiptPhoto, PaymentError } from "@/lib/repo/payments";
import { discardFile, readFile, saveFile, storageRefusal } from "@/lib/storage/files";
import { MANAGE_ROLES } from "@/lib/roles";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/payments/[id]/receipt">) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const payment = await getPayment(guard.session.organizationId, Number(id));
  if (!payment || !payment.receipt_photo_stem) {
    return NextResponse.json({ ok: false, error: "رسیدی ثبت نشده است" }, { status: 404 });
  }
  const bytes = await readFile(payment.receipt_photo_stem, "webp", "receipt");
  if (!bytes) return NextResponse.json({ ok: false, error: "فایل رسید پیدا نشد" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=86400" },
  });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/payments/[id]/receipt">) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  if (!await getPayment(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const caption = (formData?.get("caption") as string | null) ?? null;
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "فایلی انتخاب نشده است" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "فقط فایل تصویر پذیرفته می‌شود" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "حجم فایل نباید بیش از ۲۰ مگابایت باشد" }, { status: 413 });
  }

  const stem = crypto.randomUUID();
  let webpBuffer: Buffer;
  try {
    webpBuffer = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    return NextResponse.json({ ok: false, error: "فایل تصویر قابل پردازش نیست" }, { status: 422 });
  }

  try {
    await saveFile(guard.session.organizationId, "receipt", stem, [{ ext: "webp", body: webpBuffer, contentType: "image/webp" }]);
  } catch (e) {
    const r = storageRefusal(e);
    if (r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    throw e;
  }

  try {
    await attachReceiptPhoto(guard.session.organizationId, Number(id), stem, caption);
  } catch (e) {
    await discardFile(stem);
    if (e instanceof PaymentError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true, file_stem: stem }, { status: 201 });
}
