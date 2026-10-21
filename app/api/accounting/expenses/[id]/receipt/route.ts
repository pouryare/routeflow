import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES, type Role } from "@/lib/roles";
import { encodeImage, PHOTO_MAX_EDGE } from "@/lib/imagePipeline";
import { ensurePhotosDir, photoFilePath } from "@/lib/photos";
import { isOwnExpense, receiptFor, saveReceipt } from "@/lib/repo/expenseReceipts";

/* The same people who may record an expense may attach and read its receipt. */
const ROLES: Role[] = [...OWNER_ROLES, "group_manager"];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: RouteContext<"/api/accounting/expenses/[id]/receipt">) {
  const guard = requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  const journalId = Number((await ctx.params).id);
  if (!Number.isInteger(journalId)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) return NextResponse.json({ ok: false, error: "فایلی انتخاب نشده است" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ ok: false, error: "فقط فایل تصویر پذیرفته می‌شود" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ ok: false, error: "حجم فایل نباید بیش از ۲۰ مگابایت باشد" }, { status: 413 });
  // Own expense or 404, before any file is written.
  if (!isOwnExpense(guard.session.organizationId, journalId)) {
    return NextResponse.json({ ok: false, error: "هزینه پیدا نشد" }, { status: 404 });
  }

  let encoded;
  try {
    encoded = await encodeImage(Buffer.from(await file.arrayBuffer()), PHOTO_MAX_EDGE);
  } catch {
    return NextResponse.json({ ok: false, error: "فایل تصویر قابل پردازش نیست" }, { status: 422 });
  }
  const stem = crypto.randomUUID();
  ensurePhotosDir();
  await fs.writeFile(photoFilePath(stem, "avif"), encoded.avif);
  await fs.writeFile(photoFilePath(stem, "webp"), encoded.webp);
  try {
    const { replaced } = saveReceipt(guard.session.organizationId, journalId, guard.session.user.id, stem);
    if (replaced) {
      await fs.rm(photoFilePath(replaced, "avif"), { force: true });
      await fs.rm(photoFilePath(replaced, "webp"), { force: true });
    }
  } catch {
    await fs.rm(photoFilePath(stem, "avif"), { force: true });
    await fs.rm(photoFilePath(stem, "webp"), { force: true });
    return NextResponse.json({ ok: false, error: "هزینه پیدا نشد" }, { status: 404 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/accounting/expenses/[id]/receipt">) {
  const guard = requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  const journalId = Number((await ctx.params).id);
  const r = Number.isInteger(journalId) ? receiptFor(guard.session.organizationId, journalId) : null;
  if (!r) return NextResponse.json({ ok: false, error: "رسیدی ثبت نشده است" }, { status: 404 });
  const format = req.nextUrl.searchParams.get("format") === "avif" ? "avif" : "webp";
  const bytes = await fs.readFile(photoFilePath(r.file_stem, format)).catch(() => null);
  if (!bytes) return NextResponse.json({ ok: false, error: "فایل رسید پیدا نشد" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": `image/${format}`, "Cache-Control": "private, max-age=3600" } });
}
